import fs from "node:fs";
import path from "node:path";
import type { UiValue } from "@tapmakerwork/protocol";
import { readProjectText, writeProjectText } from "./project.js";

/** One widget's live edits that could not be written into game Lua. */
export interface UiInstanceOverride {
  path: string;
  props: Record<string, UiValue>;
}

export interface UiInstanceUpdate {
  path: string;
  props: Record<string, UiValue>;
  removeKeys: string[];
}

export interface WritebackInstanceSource {
  instancePath?: string | undefined;
  nodeId?: string | undefined;
  applied: string[];
  skipped: Array<{ key: string; reason: string }>;
  revert?: Record<string, UiValue | null> | undefined;
}

export const UI_OVERRIDES_RELATIVE = "scripts/tapmakerwork/UiOverrides.lua";

function escapeLuaString(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\"", "\\\"")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r");
}

function luaString(value: string): string {
  return `"${escapeLuaString(value)}"`;
}

function luaValue(value: UiValue, depth: number): string | undefined {
  if (value === null) return undefined;
  if (typeof value === "string") return luaString(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (depth > 6) return undefined;
  if (Array.isArray(value)) {
    const items = value.map((item) => luaValue(item, depth + 1)).filter((item): item is string => Boolean(item));
    return `{ ${items.join(", ")} }`;
  }
  const parts = Object.entries(value)
    .filter(([key]) => !key.startsWith("$"))
    .map(([key, item]) => {
      const rendered = luaValue(item, depth + 1);
      if (!rendered) return undefined;
      const keyText = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : `[${luaString(key)}]`;
      return `${keyText} = ${rendered}`;
    })
    .filter((item): item is string => Boolean(item));
  return `{ ${parts.join(", ")} }`;
}

export function parseInstanceOverrides(value: unknown): UiInstanceOverride[] {
  if (!Array.isArray(value)) return [];
  const parsed: UiInstanceOverride[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as { path?: unknown; props?: unknown };
    if (typeof record.path !== "string" || record.path === "") continue;
    if (!record.props || typeof record.props !== "object" || Array.isArray(record.props)) continue;
    parsed.push({ path: record.path, props: { ...(record.props as Record<string, UiValue>) } });
  }
  return parsed;
}

/**
 * Game `Refresh` / `SetText` puts live stats back over a written literal.
 * Those keys stay in the replay module so restart matches the edit.
 */
const REPLAY_EVEN_IF_WRITTEN = new Set(["text", "title"]);

/** Drop keys that landed in Lua; keep keys that only exist as a per-widget replay. */
export function mergeInstanceOverrides(existing: UiInstanceOverride[], updates: UiInstanceUpdate[]): UiInstanceOverride[] {
  const merged = new Map(existing.map((item) => [item.path, { ...item.props }]));
  for (const update of updates) {
    if (!update.path) continue;
    const props = { ...(merged.get(update.path) ?? {}) };
    Object.assign(props, update.props);
    for (const key of update.removeKeys) delete props[key];
    if (Object.keys(props).length) merged.set(update.path, props);
    else merged.delete(update.path);
  }
  return [...merged.entries()].map(([instancePath, props]) => ({ path: instancePath, props }));
}

/**
 * Each `$path` keeps the props the user actually set.
 * Keys that landed in Lua are removed from the replay module.
 * Keys with no path stay on `revert` so the preview cannot drift from a restart.
 */
export function planInstancePersistence<T extends WritebackInstanceSource>(
  details: T[],
  pending: Array<{ path: string; props: Record<string, UiValue> }>
): { updates: UiInstanceUpdate[]; revertDetails: T[] } {
  const removeByPath = new Map<string, Set<string>>();
  const pendingByPath = new Map(pending.map((item) => [item.path, item.props]));
  const revertDetails: T[] = [];
  for (const detail of details) {
    const instancePath = detail.instancePath || "";
    if (instancePath) {
      const remove = removeByPath.get(instancePath) ?? new Set<string>();
      for (const key of detail.applied) {
        if (!REPLAY_EVEN_IF_WRITTEN.has(key)) remove.add(key);
      }
      for (const item of detail.skipped) {
        if (item.reason === "unchanged") remove.add(item.key);
      }
      removeByPath.set(instancePath, remove);
    }
    if (!detail.revert) continue;
    const pendingProps = instancePath ? pendingByPath.get(instancePath) : undefined;
    const revert = Object.fromEntries(Object.entries(detail.revert).filter(([key]) => (
      !pendingProps || pendingProps[key] === undefined
    )));
    if (Object.keys(revert).length) revertDetails.push({ ...detail, revert });
  }
  const updates = pending
    .filter((item) => item.path !== "")
    .map((item) => ({
      path: item.path,
      props: item.props,
      removeKeys: [...(removeByPath.get(item.path) ?? [])]
    }));
  return { updates, revertDetails };
}

/** Paths in `authoritative` replace the same path from other sidecars. `dropMissingPaths` removes a path that this save cleared. */
export function combineInstanceOverrides(
  base: UiInstanceOverride[],
  authoritative: UiInstanceOverride[],
  dropMissingPaths: string[] = []
): UiInstanceOverride[] {
  const merged = new Map(base.map((item) => [item.path, { ...item.props }]));
  const authoritativePaths = new Set(authoritative.map((item) => item.path));
  for (const item of authoritative) merged.set(item.path, { ...item.props });
  for (const instancePath of dropMissingPaths) {
    if (!authoritativePaths.has(instancePath)) merged.delete(instancePath);
  }
  return [...merged.entries()]
    .filter(([, props]) => Object.keys(props).length > 0)
    .sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0)
    .map(([instancePath, props]) => ({ path: instancePath, props }));
}

export function renderUiOverridesModule(instances: UiInstanceOverride[]): string {
  const combined = combineInstanceOverrides([], instances);
  const lines = combined.map((item) => {
    const rendered = luaValue(item.props, 0) ?? "{}";
    return `    [${luaString(item.path)}] = ${rendered},`;
  });
  return `-- Generated by TapMakerWork. Do not edit.
-- Live edits that cannot be written into game Lua. Preview, restart, and published builds apply the same SetStyle values.
return {
  version = 1,
  overrides = {
${lines.join("\n")}
  }
}
`;
}

export const UI_OVERRIDES_STUB = renderUiOverridesModule([]);

function walkSidecars(projectRoot: string, visit: (relative: string, text: string) => void): void {
  const scripts = path.join(projectRoot, "scripts");
  if (!fs.existsSync(scripts)) return;
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "urhox-libs" || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ui.json")) continue;
      const relative = path.relative(projectRoot, full).replaceAll("\\", "/");
      try {
        visit(relative, fs.readFileSync(full, "utf8"));
      } catch {
        // unreadable sidecar is skipped; the next save rewrites the module
      }
    }
  };
  walk(scripts);
}

export function loadInstanceOverridesExcept(projectRoot: string, excludeRelative: string): UiInstanceOverride[] {
  const excluded = excludeRelative.replaceAll("\\", "/");
  const loaded: UiInstanceOverride[] = [];
  walkSidecars(projectRoot, (relative, text) => {
    if (relative === excluded) return;
    try {
      const parsed = JSON.parse(text) as { instances?: unknown };
      loaded.push(...parseInstanceOverrides(parsed.instances));
    } catch {
      // ignore malformed sidecar
    }
  });
  return loaded;
}

export function writeUiOverridesModule(projectRoot: string, instances: UiInstanceOverride[]): string {
  const next = renderUiOverridesModule(instances);
  try {
    if (readProjectText(projectRoot, UI_OVERRIDES_RELATIVE).replace(/\r\n/g, "\n") === next) return UI_OVERRIDES_RELATIVE;
  } catch {
    // missing file is written below
  }
  writeProjectText(projectRoot, UI_OVERRIDES_RELATIVE, next);
  return UI_OVERRIDES_RELATIVE;
}
