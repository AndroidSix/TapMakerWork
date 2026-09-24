import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { UiNode, UiSnapshot, UiValue } from "@tapmakerwork/protocol";
import { readProjectText, resolveInsideProject, writeProjectText } from "./project.js";
import { parseInstanceOverrides, type UiInstanceOverride } from "./ui-overrides.js";

export const UI_SIDECAR_FORMAT_VERSION = 2 as const;

export interface UiSidecarOverrideSelector {
  sourceFile: string;
  line: number;
  type: string;
}

export interface UiSidecarOverride {
  selector: UiSidecarOverrideSelector;
  scope: "template";
  props: Record<string, UiValue>;
  /** Runtime label used to find UiStyle.* call sites after opts_passthrough. */
  identityText?: string;
}

export interface UiSidecarDocument {
  formatVersion: typeof UI_SIDECAR_FORMAT_VERSION;
  sourceFile: string;
  sourceHash: string;
  savedAt: string;
  confidence: "static" | "hybrid" | "runtime" | "module" | "sidecar";
  root: UiNode;
  overrides: UiSidecarOverride[];
  /** Per-widget props replayed by scripts/tapmakerwork/UiOverrides.lua on every run. */
  instances: UiInstanceOverride[];
  selectedId?: string | undefined;
}

function normalizeSourceFile(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function sourceFileMatches(left: string, right: string): boolean {
  const a = normalizeSourceFile(left);
  const b = normalizeSourceFile(right);
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

export function overrideSelectorForNode(node: UiNode): UiSidecarOverrideSelector | undefined {
  const sourceFile = node.source?.file ? normalizeSourceFile(node.source.file) : "";
  const line = Number(node.source?.line || 0);
  if (sourceFile && sourceFile !== "runtime" && Number.isInteger(line) && line > 0) {
    return { sourceFile, line, type: node.type };
  }
  // Conversion / sidecar node ids embed `file:line:type:…` even when runtime
  // source tracking was off (UI_INSPECTOR_ENABLED unset).
  return selectorFromNodeId(node.id, node.type);
}

export function selectorFromNodeId(nodeId: string, fallbackType?: string): UiSidecarOverrideSelector | undefined {
  const match = /^(.*?\.lua):(\d+):([A-Za-z_][A-Za-z0-9_]*):/i.exec(nodeId);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  const line = Number(match[2]);
  if (!Number.isInteger(line) || line <= 0) return undefined;
  const leaf = match[3];
  const type = fallbackType && fallbackType !== "Widget"
    ? fallbackType
    : /button/i.test(leaf) ? "Button"
      : /label|text/i.test(leaf) ? "Label"
        : /image|sprite|icon/i.test(leaf) ? "Image"
          : /panel|container|view|card|chip|dialog|bar/i.test(leaf) ? "Panel"
            : `${leaf.charAt(0).toUpperCase()}${leaf.slice(1)}`;
  return { sourceFile: normalizeSourceFile(match[1]), line, type };
}

function selectorKey(selector: UiSidecarOverrideSelector): string {
  return `${normalizeSourceFile(selector.sourceFile)}:${selector.line}:${selector.type}`;
}

export function mergeUiSidecarOverrides(base: UiSidecarOverride[], additions: UiSidecarOverride[]): UiSidecarOverride[] {
  const merged = base.map((item) => ({ ...item, selector: { ...item.selector }, props: { ...item.props } }));
  for (const addition of additions) {
    const key = selectorKey(addition.selector);
    const index = merged.findIndex((item) => selectorKey(item.selector) === key);
    if (index < 0) merged.push({ ...addition, selector: { ...addition.selector }, props: { ...addition.props } });
    else merged[index] = { ...merged[index]!, props: { ...merged[index]!.props, ...addition.props } };
  }
  return merged;
}

export function mergeUiSidecarOverride(
  overrides: UiSidecarOverride[],
  node: UiNode,
  patch: Record<string, UiValue | undefined>,
  options: { dynamicTemplate?: boolean } = {}
): { overrides: UiSidecarOverride[]; persisted: boolean; ignoredProps: number } {
  const selector = overrideSelectorForNode(node);
  if (!selector) return { overrides, persisted: false, ignoredProps: Object.keys(patch).length };
  const dynamicDataProps = new Set(["id", "text", "value", "checked", "selected", "progress", "items", "data"]);
  const entries = Object.entries(patch);
  const props = Object.fromEntries(entries
    .filter(([key, value]) => !key.startsWith("$")
      && value !== undefined
      && (!options.dynamicTemplate || !dynamicDataProps.has(key)))) as Record<string, UiValue>;
  const ignoredProps = entries.length - Object.keys(props).length;
  if (!Object.keys(props).length) return { overrides, persisted: false, ignoredProps };
  const key = selectorKey(selector);
  const index = overrides.findIndex((item) => selectorKey(item.selector) === key);
  if (index < 0) return { overrides: [...overrides, { selector, scope: "template", props }], persisted: true, ignoredProps };
  return {
    overrides: overrides.map((item, itemIndex) => itemIndex === index
      ? { ...item, props: { ...item.props, ...props } }
      : item),
    persisted: true,
    ignoredProps
  };
}

export function nodeMatchesUiOverride(node: UiNode, override: UiSidecarOverride): boolean {
  const source = node.source;
  return Boolean(source?.file)
    && sourceFileMatches(source!.file, override.selector.sourceFile)
    && Number(source?.line || 0) === override.selector.line
    && node.type === override.selector.type;
}

export function applyUiSidecarOverrides(root: UiNode, overrides: UiSidecarOverride[]): UiNode {
  const matching = overrides.filter((override) => nodeMatchesUiOverride(root, override));
  const props = matching.reduce<Record<string, UiValue>>((all, override) => ({ ...all, ...override.props }), root.props);
  return {
    ...root,
    props,
    children: root.children.map((child) => applyUiSidecarOverrides(child, overrides))
  };
}

export function sidecarRelativePath(sourceFile: string): string {
  return sourceFile.replace(/\.lua$/i, ".ui.json");
}

export function readUiSidecar(projectRoot: string, sourceFile: string): UiSidecarDocument | undefined {
  const relative = sidecarRelativePath(sourceFile);
  try {
    const text = readProjectText(projectRoot, relative);
    const parsed = JSON.parse(text) as Partial<UiSidecarDocument>;
    if (!parsed || typeof parsed !== "object" || !parsed.root) return undefined;
    return {
      ...parsed,
      formatVersion: UI_SIDECAR_FORMAT_VERSION,
      sourceFile: parsed.sourceFile || sourceFile,
      confidence: parsed.confidence || "sidecar",
      root: parsed.root,
      overrides: Array.isArray(parsed.overrides) ? parsed.overrides : [],
      instances: parseInstanceOverrides(parsed.instances),
      ...(parsed.selectedId ? { selectedId: parsed.selectedId } : {})
    } as UiSidecarDocument;
  } catch {
    return undefined;
  }
}

export function sidecarExists(projectRoot: string, sourceFile: string): boolean {
  try {
    const filename = resolveInsideProject(projectRoot, sidecarRelativePath(sourceFile));
    return fs.existsSync(filename) && fs.statSync(filename).isFile();
  } catch {
    return false;
  }
}

export function writeUiSidecar(
  projectRoot: string,
  sourceFile: string,
  snapshot: UiSnapshot,
  confidence: UiSidecarDocument["confidence"] = "sidecar",
  overrides: UiSidecarOverride[] = [],
  instances: UiInstanceOverride[] = []
): { path: string; document: UiSidecarDocument } {
  const relative = sidecarRelativePath(sourceFile);
  let sourceHash = "";
  try {
    const luaSource = readProjectText(projectRoot, sourceFile);
    sourceHash = crypto.createHash("sha256").update(luaSource).digest("hex");
  } catch {
    sourceHash = "";
  }
  const document: UiSidecarDocument = {
    formatVersion: UI_SIDECAR_FORMAT_VERSION,
    sourceFile,
    sourceHash,
    savedAt: new Date().toISOString(),
    confidence,
    root: snapshot.root,
    overrides,
    instances,
    ...(snapshot.selectedId ? { selectedId: snapshot.selectedId } : {})
  };
  writeProjectText(projectRoot, relative, `${JSON.stringify(document, null, 2)}\n`);
  return { path: relative, document };
}

export function snapshotFromSidecar(sidecar: UiSidecarDocument, revision: number): UiSnapshot {
  return {
    revision,
    root: applyUiSidecarOverrides(sidecar.root, sidecar.overrides),
    ...(sidecar.selectedId ? { selectedId: sidecar.selectedId } : {})
  };
}

export function findUiNodePath(root: UiNode, nodeId: string, trail: string[] = []): string[] | undefined {
  const next = [...trail, root.id];
  if (root.id === nodeId) return next;
  for (const child of root.children) {
    const found = findUiNodePath(child, nodeId, next);
    if (found) return found;
  }
  return undefined;
}

export function uiNodeAtLine(root: UiNode, line: number): UiNode | undefined {
  if (root.source?.line === line) return root;
  for (const child of root.children) {
    const found = uiNodeAtLine(child, line);
    if (found) return found;
  }
  return undefined;
}

export function sidecarLabel(projectRoot: string, sourceFile: string): { relative: string; exists: boolean } {
  const relative = sidecarRelativePath(sourceFile);
  return { relative, exists: sidecarExists(projectRoot, sourceFile) };
}

export function ensureParentDir(projectRoot: string, relativeFile: string): void {
  const filename = resolveInsideProject(projectRoot, relativeFile);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
}
