import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listAccountHomes } from "./maker-accounts.js";

export interface RuntimeFileStatus {
  kind?: string;
  sessionId?: string;
  cursor?: number;
  revision?: number;
  transport?: string;
  url?: string;
  lastHttpError?: string;
  lastCommandError?: string;
  lastCommandResult?: string;
  snapshotError?: string;
  snapshotBytes?: number;
  rootType?: string;
  childCount?: number;
  hasRootProvider?: boolean;
  projectName?: string;
  backend?: string;
  updatedAt?: number;
  snapshot?: unknown;
  sourcePath?: string;
  snapshotPath?: string;
}

export interface FindRuntimeFileStatusOptions {
  projectRoot?: string;
  projectName?: string;
  /** Test seam: preview hash dir → project_realpath. Defaults to reading Maker preview session.json files. */
  previewProjects?: Map<string, string>;
}

function previewRoot(): string {
  return path.join(os.homedir(), ".taptap-maker", "preview");
}

const SKIP_DIRS = new Set(["assets", "node_modules", "shadercache_runtime", "Cache", "GPUCache", "Code Cache"]);

export function runtimeFileSearchRoots(): string[] {
  const roots = [previewRoot(), ...listAccountHomes().map((home) => path.join(home, "preview"))];
  try {
    const temp = os.tmpdir();
    for (const name of fs.readdirSync(temp)) {
      if (name.startsWith("maker-cache")) roots.push(path.join(temp, name));
    }
  } catch {
    // Temp may be unreadable; preview root still works on macOS.
  }
  return roots;
}

function walkStatusFiles(dir: string, found: string[] = [], depth = 0): string[] {
  if (depth > 8 || found.length > 50) return found;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkStatusFiles(full, found, depth + 1);
      continue;
    }
    const flatStatus = entry.name === "tapmakerwork-runtime-status.json";
    const nestedStatus = entry.name === "runtime-status.json" && full.includes(`${path.sep}tapmakerwork${path.sep}`);
    if (flatStatus || nestedStatus) found.push(full);
  }
  return found;
}

function parseFirstJsonObject(text: string): RuntimeFileStatus | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as RuntimeFileStatus;
  } catch {
    // Maker File write may append; parse the first balanced JSON object.
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = -1;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (inString) {
      if (escape) escape = false;
      else if (char === "\\") escape = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          return JSON.parse(trimmed.slice(start, index + 1)) as RuntimeFileStatus;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

export function normalizeUiTree(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => normalizeUiTree(item));
  }
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = { ...record };
  const children = record.children;
  if (children == null) {
    out.children = [];
  } else if (Array.isArray(children)) {
    out.children = children.map((child) => normalizeUiTree(child));
  } else if (typeof children === "object") {
    // Lua/cjson encodes empty tables as {}
    const nested = Object.values(children as Record<string, unknown>);
    out.children = nested.length ? nested.map((child) => normalizeUiTree(child)) : [];
  } else {
    out.children = [];
  }
  return out;
}

export function normalizeRuntimeSnapshot(snapshot: unknown): unknown {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  const record = snapshot as Record<string, unknown>;
  return {
    ...record,
    root: normalizeUiTree(record.root)
  };
}

function snapshotStem(statusPath: string): string {
  return path.basename(statusPath).startsWith("tapmakerwork-")
    ? "tapmakerwork-runtime-snapshot.json"
    : "runtime-snapshot.json";
}

export const MAX_SNAPSHOT_PARTS = 256;
export const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;

function readSiblingSnapshot(statusPath: string): unknown {
  const dir = path.dirname(statusPath);
  const stem = snapshotStem(statusPath);
  const metaPath = path.join(dir, `${stem}.meta.json`);
  const singlePath = path.join(dir, stem);
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8").split("\0")[0] || "{}") as { parts?: number; total?: number };
      const parts = Number(meta.parts || 0);
      if (!Number.isInteger(parts) || parts > MAX_SNAPSHOT_PARTS) return undefined;
      if (parts > 0) {
        let text = "";
        let totalBytes = 0;
        for (let index = 1; index <= parts; index += 1) {
          const partPath = path.join(dir, `${stem}.part${String(index).padStart(2, "0")}`);
          if (!fs.existsSync(partPath)) return undefined;
          totalBytes += fs.statSync(partPath).size;
          if (totalBytes > MAX_SNAPSHOT_BYTES) return undefined;
          // Maker File 分片可能在中间插入 \0，必须全部去掉再拼接
          text += fs.readFileSync(partPath, "utf8").replace(/\0+/g, "");
        }
        return normalizeRuntimeSnapshot(parseFirstJsonObject(text));
      }
    } catch {
      // fall through
    }
  }
  if (!fs.existsSync(singlePath)) return undefined;
  try {
    if (fs.statSync(singlePath).size > MAX_SNAPSHOT_BYTES) return undefined;
    return normalizeRuntimeSnapshot(parseFirstJsonObject(fs.readFileSync(singlePath, "utf8")));
  } catch {
    return undefined;
  }
}

function projectMatchHints(options?: FindRuntimeFileStatusOptions): string[] {
  const hints = new Set<string>();
  if (options?.projectName?.trim()) hints.add(options.projectName.trim());
  if (options?.projectRoot) {
    hints.add(path.basename(options.projectRoot));
    try {
      hints.add(fs.realpathSync(options.projectRoot));
    } catch {
      hints.add(path.resolve(options.projectRoot));
    }
    try {
      const config = fs.readFileSync(path.join(options.projectRoot, "scripts", "Config.lua"), "utf8");
      for (const match of config.matchAll(/Config\.(TITLE|Name|APP_NAME|PRODUCT_NAME)\s*=\s*["']([^"']+)/g)) {
        if (match[2]) hints.add(match[2]);
      }
    } catch {
      // Config.lua is optional.
    }
    try {
      const metadata = JSON.parse(fs.readFileSync(path.join(options.projectRoot, ".project", "project.json"), "utf8")) as {
        name?: unknown;
        taptap_publish?: { title?: unknown };
      };
      if (typeof metadata.taptap_publish?.title === "string") hints.add(metadata.taptap_publish.title);
      if (typeof metadata.name === "string") hints.add(metadata.name);
    } catch {
      // project.json is optional for matching.
    }
  }
  return [...hints].filter(Boolean);
}

function previewSessionProjectPaths(previewDir: string): Map<string, string> {
  const mapping = new Map<string, string>();
  if (!fs.existsSync(previewDir)) return mapping;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(previewDir, { withFileTypes: true });
  } catch {
    return mapping;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sessionPath = path.join(previewDir, entry.name, "session.json");
    try {
      const session = JSON.parse(fs.readFileSync(sessionPath, "utf8")) as { project_realpath?: string };
      if (typeof session.project_realpath === "string" && session.project_realpath) {
        mapping.set(path.join(previewDir, entry.name), session.project_realpath);
      }
    } catch {
      // ignore malformed sessions
    }
  }
  return mapping;
}

function allPreviewSessionProjectPaths(): Map<string, string> {
  const merged = new Map<string, string>();
  for (const root of runtimeFileSearchRoots().filter((candidate) => path.basename(candidate) === "preview")) {
    for (const [previewDir, projectRealpath] of previewSessionProjectPaths(root)) merged.set(previewDir, projectRealpath);
  }
  return merged;
}

type ProjectMatch = "match" | "mismatch" | "unknown";

function normalizeIdentity(value: string): string {
  const trimmed = value.trim().replace(/[\\/]+$/, "");
  return process.platform === "win32" ? trimmed.replace(/\\/g, "/").toLowerCase() : trimmed;
}

function isInsideDirectory(filePath: string, directory: string): boolean {
  const relative = path.relative(directory, filePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function statusProjectIdentities(status: RuntimeFileStatus, previewProjects: Map<string, string>): string[] {
  const identities: string[] = [];
  if (status.projectName?.trim()) identities.push(status.projectName);
  if (status.sourcePath) {
    for (const [previewDir, projectRealpath] of previewProjects) {
      if (isInsideDirectory(status.sourcePath, previewDir)) identities.push(projectRealpath, path.basename(projectRealpath));
    }
  }
  return identities;
}

function classifyStatusProject(
  status: RuntimeFileStatus,
  hints: string[],
  previewProjects: Map<string, string>
): ProjectMatch {
  const identities = statusProjectIdentities(status, previewProjects).map(normalizeIdentity);
  if (!identities.length) return "unknown";
  const normalizedHints = new Set(hints.map(normalizeIdentity));
  return identities.some((identity) => normalizedHints.has(identity)) ? "match" : "mismatch";
}

export function findRuntimeFileStatus(
  roots = runtimeFileSearchRoots(),
  options?: FindRuntimeFileStatusOptions
): RuntimeFileStatus | undefined {
  const candidates: string[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    walkStatusFiles(root, candidates);
  }
  if (!candidates.length) return undefined;
  const hints = projectMatchHints(options);
  const previewProjects = options?.previewProjects ?? allPreviewSessionProjectPaths();
  const newest: Record<ProjectMatch, { status?: RuntimeFileStatus; mtime: number }> = {
    match: { mtime: 0 },
    unknown: { mtime: 0 },
    mismatch: { mtime: 0 }
  };
  for (const file of candidates) {
    try {
      const stat = fs.statSync(file);
      const parsed = parseFirstJsonObject(fs.readFileSync(file, "utf8"));
      if (!parsed || typeof parsed !== "object" || !parsed.sessionId) continue;
      const current: RuntimeFileStatus = { ...parsed, sourcePath: file };
      const bucket = newest[hints.length ? classifyStatusProject(current, hints, previewProjects) : "match"];
      if (stat.mtimeMs >= bucket.mtime) {
        bucket.status = current;
        bucket.mtime = stat.mtimeMs;
      }
    } catch {
      // ignore unreadable status
    }
  }
  // 明确属于其它项目的状态绝不回退使用，避免把 A 项目的 UI 树当成当前项目
  const chosen = newest.match.status ?? newest.unknown.status;
  return chosen ? withSiblingSnapshot(chosen) : undefined;
}

function withSiblingSnapshot(status: RuntimeFileStatus): RuntimeFileStatus {
  const file = status.sourcePath!;
  const stem = snapshotStem(file);
  const metaPath = path.join(path.dirname(file), `${stem}.meta.json`);
  const singlePath = path.join(path.dirname(file), stem);
  const snapshotPath = fs.existsSync(metaPath) ? metaPath : (fs.existsSync(singlePath) ? singlePath : undefined);
  return { ...status, ...(snapshotPath ? { snapshotPath } : {}), snapshot: readSiblingSnapshot(file) };
}

export function writeIdeCommandsFile(status: RuntimeFileStatus, commands: Array<Record<string, unknown>>): string | undefined {
  const sourcePath = status.sourcePath;
  if (!sourcePath) return undefined;
  const commandsName = path.basename(sourcePath).startsWith("tapmakerwork-")
    ? "tapmakerwork-ide-commands.json"
    : "ide-commands.json";
  const commandsPath = path.join(path.dirname(sourcePath), commandsName);
  const payload = {
    kind: "tapmakerwork.ide.commands",
    sessionId: status.sessionId,
    cursor: status.cursor ?? 0,
    updatedAt: Date.now(),
    commands
  };
  fs.writeFileSync(commandsPath, JSON.stringify(payload), "utf8");
  return commandsPath;
}
