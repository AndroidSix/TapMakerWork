import fs from "node:fs";
import path from "node:path";

export interface ProjectBinding {
  root: string;
  name: string;
  makerBound: boolean;
}

export function resolveProjectRoot(candidate: string): ProjectBinding {
  if (!path.isAbsolute(candidate)) throw new Error("project_path_must_be_absolute");
  const root = fs.realpathSync(candidate);
  if (!fs.statSync(root).isDirectory()) throw new Error("project_path_must_be_directory");
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

export function readProjectText(projectRoot: string, relativePath: string, maxBytes = 5_242_880): string {
  const filename = resolveInsideProject(projectRoot, relativePath);
  const stat = fs.statSync(filename);
  if (!stat.isFile()) throw new Error("project_path_not_file");
  if (stat.size > maxBytes) throw new Error("project_file_too_large");
  return fs.readFileSync(filename, "utf8");
}

export function listProjectEntries(projectRoot: string, relativePath = "."): Array<{
  name: string;
  path: string;
  kind: "file" | "directory";
}> {
  const directory = relativePath === "." ? projectRoot : resolveInsideProject(projectRoot, relativePath);
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => ![".git", "node_modules", ".tapmakerwork"].includes(entry.name))
    .slice(0, 250)
    .map((entry) => ({
      name: entry.name,
      path: path.relative(projectRoot, path.join(directory, entry.name)) || ".",
      kind: entry.isDirectory() ? "directory" as const : "file" as const
    }))
    .sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1);
}
