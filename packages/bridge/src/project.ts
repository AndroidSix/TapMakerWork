import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface ProjectBinding {
  root: string;
  name: string;
  makerBound: boolean;
}

export function isTapMakerProject(candidate: string): boolean {
  try {
    const projectFile = path.join(candidate, ".project", "project.json");
    if (!fs.statSync(projectFile).isFile()) return false;
    const metadata = JSON.parse(fs.readFileSync(projectFile, "utf8")) as Record<string, unknown>;
    const schema = typeof metadata.$schema === "string" ? metadata.$schema : "";
    return typeof metadata.project_id === "string"
      || typeof metadata.entry === "string"
      || /project\.schema\.json$/i.test(schema);
  } catch {
    return false;
  }
}

export function resolveProjectRoot(candidate: string): ProjectBinding {
  if (!path.isAbsolute(candidate)) throw new Error("project_path_must_be_absolute");
  const root = fs.realpathSync(candidate);
  if (!fs.statSync(root).isDirectory()) throw new Error("project_path_must_be_directory");
  if (!isTapMakerProject(root)) throw new Error("not_tapmaker_project");
  return {
    root,
    name: path.basename(root),
    makerBound: fs.existsSync(path.join(root, ".maker-mcp", "config.json"))
  };
}

export function resolveInsideProject(projectRoot: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error("invalid_relative_path");
  const realRoot = fs.realpathSync(projectRoot);
  const resolved = path.resolve(realRoot, relativePath);
  const lexicalRelative = path.relative(realRoot, resolved);
  if (lexicalRelative.startsWith("..") || path.isAbsolute(lexicalRelative)) throw new Error("path_outside_project");
  let existingAncestor = resolved;
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break;
    existingAncestor = parent;
  }
  const realAncestor = fs.realpathSync(existingAncestor);
  const realTarget = fs.existsSync(resolved)
    ? fs.realpathSync(resolved)
    : path.resolve(realAncestor, path.relative(existingAncestor, resolved));
  const realRelative = path.relative(realRoot, realTarget);
  if (realRelative === "" || (!realRelative.startsWith("..") && !path.isAbsolute(realRelative))) return fs.existsSync(resolved) ? realTarget : resolved;
  throw new Error("path_outside_project");
}

/** Expand runtime chunk names (`pool/ui/DrawUtil`, absolute paths, missing .lua) into project-relative files. */
export function candidateProjectSourcePaths(rawPath: string, projectRoot?: string): string[] {
  const cleaned = rawPath.replaceAll("\\", "/").replace(/^@/, "").replace(/^\.\//, "").trim();
  if (!cleaned || cleaned === "runtime") return [];
  const out: string[] = [];
  const push = (value: string) => {
    const next = value.replaceAll("\\", "/").replace(/^\.\//, "");
    if (!next || next === "runtime" || out.includes(next)) return;
    out.push(next);
  };

  if (path.isAbsolute(cleaned)) {
    if (projectRoot) {
      try {
        const realRoot = fs.realpathSync(projectRoot);
        const abs = fs.existsSync(cleaned) ? fs.realpathSync(cleaned) : cleaned;
        const relative = path.relative(realRoot, abs).split(path.sep).join("/");
        if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) push(relative);
      } catch {
        // Fall through to scripts/ suffix extraction.
      }
    }
    const scriptsMatch = cleaned.match(/(?:^|\/)(scripts\/.+)$/);
    if (scriptsMatch?.[1]) push(scriptsMatch[1]);
  } else {
    push(cleaned);
  }

  const seeds = [...out];
  for (const seed of seeds) {
    if (!seed.endsWith(".lua")) push(`${seed}.lua`);
    if (!seed.startsWith("scripts/")) {
      push(`scripts/${seed}`);
      if (!seed.endsWith(".lua")) push(`scripts/${seed}.lua`);
    }
    if (!seed.includes("/") && seed.includes(".") && !/\.lua$/i.test(seed)) {
      const asSlashes = seed.replaceAll(".", "/");
      push(asSlashes);
      push(`${asSlashes}.lua`);
      push(`scripts/${asSlashes}.lua`);
    }
  }
  return out;
}

export function resolveProjectSourcePath(projectRoot: string, rawPath: string): string {
  const candidates = candidateProjectSourcePaths(rawPath, projectRoot);
  for (const candidate of candidates) {
    try {
      const filename = resolveInsideProject(projectRoot, candidate);
      if (fs.existsSync(filename) && fs.statSync(filename).isFile()) {
        return candidate.replaceAll("\\", "/");
      }
    } catch {
      // try next candidate
    }
  }
  const fallback = candidates[0] || rawPath.replaceAll("\\", "/").replace(/^@/, "");
  throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${path.join(projectRoot, fallback)}'`), {
    code: "ENOENT"
  });
}

export function readProjectText(projectRoot: string, relativePath: string, maxBytes = 5_242_880): string {
  return readProjectSource(projectRoot, relativePath, maxBytes).text;
}

export interface ProjectSource {
  path: string;
  text: string;
  version: string;
  utf8: boolean;
}

function loadProjectSource(relative: string, filename: string): ProjectSource {
  const bytes = fs.readFileSync(filename);
  return { path: relative, text: bytes.toString("utf8"), version: contentVersion(bytes), utf8: isValidUtf8(bytes) };
}

export function readProjectSource(projectRoot: string, relativePath: string, maxBytes = 5_242_880): ProjectSource {
  const cleaned = relativePath.replaceAll("\\", "/").replace(/^@/, "").replace(/^\.\//, "");
  if (!path.isAbsolute(cleaned)) {
    try {
      const filename = resolveInsideProject(projectRoot, cleaned);
      if (fs.existsSync(filename) && fs.statSync(filename).isFile()) {
        const stat = fs.statSync(filename);
        if (stat.size > maxBytes) throw new Error("project_file_too_large");
        return loadProjectSource(cleaned, filename);
      }
    } catch (error) {
      // Keep boundary errors strict; only remap missing / absolute / module-style paths.
      if (error instanceof Error && error.message === "path_outside_project") throw error;
    }
  }

  const resolvedPath = resolveProjectSourcePath(projectRoot, relativePath);
  const filename = resolveInsideProject(projectRoot, resolvedPath);
  const stat = fs.statSync(filename);
  if (!stat.isFile()) throw new Error("project_path_not_file");
  if (stat.size > maxBytes) throw new Error("project_file_too_large");
  return loadProjectSource(resolvedPath, filename);
}

const UTF8_BOM = "\uFEFF";
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

export function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    strictUtf8.decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function contentVersion(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

/** Hash of the file as currently on disk; undefined when it does not exist yet. */
export function projectFileVersion(projectRoot: string, relativePath: string): string | undefined {
  const filename = resolveInsideProject(projectRoot, relativePath);
  if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) return undefined;
  return contentVersion(fs.readFileSync(filename));
}

const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/** Windows 上杀毒/编辑器短暂占用目标文件时 rename 会 EPERM/EBUSY，稍等重试即可。 */
export function renameWithRetry(from: string, to: string, attempts = 6): void {
  for (let attempt = 1; ; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (attempt >= attempts || !RETRYABLE_RENAME_CODES.has(code)) throw error;
      sleepSync(40 * attempt);
    }
  }
}

export function writeFileAtomic(filename: string, data: string | Uint8Array, mode = 0o644): void {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.tapmakerwork-${process.pid}-${randomBytes(4).toString("hex")}.tmp`);
  try {
    fs.writeFileSync(temporary, data, { mode });
    renameWithRetry(temporary, filename);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function writeProjectText(
  projectRoot: string,
  relativePath: string,
  text: string,
  maxBytes = 5_242_880,
  options: { baseVersion?: string | undefined } = {}
): void {
  const filename = resolveInsideProject(projectRoot, relativePath);
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("project_file_too_large");
  const exists = fs.existsSync(filename);
  if (exists && !fs.statSync(filename).isFile()) throw new Error("project_path_not_file");
  let nextText = text;
  if (exists) {
    const current = fs.readFileSync(filename);
    if (options.baseVersion && options.baseVersion !== contentVersion(current)) throw new Error("project_file_changed_externally");
    if (!isValidUtf8(current)) throw new Error("project_file_not_utf8");
    const hadBom = current[0] === 0xef && current[1] === 0xbb && current[2] === 0xbf;
    if (hadBom && !nextText.startsWith(UTF8_BOM)) nextText = UTF8_BOM + nextText;
  }
  writeFileAtomic(filename, Buffer.from(nextText, "utf8"), exists ? fs.statSync(filename).mode : 0o644);
}

export function listProjectEntries(projectRoot: string, relativePath = "."): Array<{
  name: string;
  path: string;
  kind: "file" | "directory";
}> {
  const directory = relativePath === "." ? projectRoot : resolveInsideProject(projectRoot, relativePath);
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => ![".git", "node_modules", ".tapmakerwork", ".DS_Store"].includes(entry.name))
    .slice(0, 250)
    .map((entry) => ({
      name: entry.name,
      path: path.relative(projectRoot, path.join(directory, entry.name)) || ".",
      kind: entry.isDirectory() ? "directory" as const : "file" as const
    }))
    .sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1);
}
