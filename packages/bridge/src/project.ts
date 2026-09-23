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

export function readProjectSource(projectRoot: string, relativePath: string, maxBytes = 5_242_880): { path: string; text: string } {
  const cleaned = relativePath.replaceAll("\\", "/").replace(/^@/, "").replace(/^\.\//, "");
  if (!path.isAbsolute(cleaned)) {
    try {
      const filename = resolveInsideProject(projectRoot, cleaned);
      if (fs.existsSync(filename) && fs.statSync(filename).isFile()) {
        const stat = fs.statSync(filename);
        if (stat.size > maxBytes) throw new Error("project_file_too_large");
        return { path: cleaned, text: fs.readFileSync(filename, "utf8") };
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
  return { path: resolvedPath, text: fs.readFileSync(filename, "utf8") };
}

export function writeProjectText(projectRoot: string, relativePath: string, text: string, maxBytes = 5_242_880): void {
  const filename = resolveInsideProject(projectRoot, relativePath);
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("project_file_too_large");
  const exists = fs.existsSync(filename);
  if (exists && !fs.statSync(filename).isFile()) throw new Error("project_path_not_file");
  const mode = exists ? fs.statSync(filename).mode : 0o644;
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.tapmakerwork-${process.pid}.tmp`);
  try {
    fs.writeFileSync(temporary, text, { encoding: "utf8", mode });
    fs.renameSync(temporary, filename);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
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
