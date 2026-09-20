import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveInsideProject } from "./project.js";

export interface SearchHit {
  path: string;
  line: number;
  preview: string;
}

export interface GitStatus {
  branch: string;
  upstream?: string | undefined;
  ahead: number;
  behind: number;
  dirty: boolean;
  changes: Array<{ path: string; status: string }>;
}

export interface AssetEntry {
  name: string;
  path: string;
  bytes: number;
  extension: string;
  kind: "image" | "audio" | "video" | "model" | "font" | "other";
  referencedBy: string[];
  status: "referenced" | "unreferenced";
}

const SKIP_DIRS = new Set([".git", "node_modules", "dist", ".emmylua", ".tmp", ".tapmakerwork", ".maker"]);

export function searchProject(projectRoot: string, query: string, limit = 50): SearchHit[] {
  const needle = query.trim();
  if (!needle) return [];
  const hits: SearchHit[] = [];
  const pending = [projectRoot];
  while (pending.length && hits.length < limit) {
    const directory = pending.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (hits.length >= limit) break;
      if (entry.name.startsWith(".") && entry.name !== ".project") continue;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) pending.push(path.join(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(lua|json|md|ts|js|txt|yaml|yml)$/i.test(entry.name)) continue;
      const filename = path.join(directory, entry.name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filename);
      } catch {
        continue;
      }
      if (stat.size > 1_500_000) continue;
      let content: string;
      try {
        content = fs.readFileSync(filename, "utf8");
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        if (!line.includes(needle)) continue;
        hits.push({
          path: path.relative(projectRoot, filename).split(path.sep).join("/"),
          line: index + 1,
          preview: line.trim().slice(0, 200)
        });
        if (hits.length >= limit) break;
      }
    }
  }
  return hits;
}

function assetKind(extension: string): AssetEntry["kind"] {
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp"].includes(extension)) return "image";
  if ([".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"].includes(extension)) return "audio";
  if ([".mp4", ".webm", ".mov", ".m4v"].includes(extension)) return "video";
  if ([".glb", ".gltf", ".fbx", ".obj", ".mtl"].includes(extension)) return "model";
  if ([".ttf", ".otf", ".woff", ".woff2"].includes(extension)) return "font";
  return "other";
}

function collectReferenceDocuments(projectRoot: string): Array<{ path: string; text: string }> {
  const documents: Array<{ path: string; text: string }> = [];
  const pending = [projectRoot];
  while (pending.length && documents.length < 1_000) {
    const directory = pending.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".project") continue;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !["assets", "images", "image", "textures", "resources"].includes(entry.name)) pending.push(filename);
        continue;
      }
      if (!entry.isFile() || !/\.(lua|json|md|ts|tsx|js|jsx|yaml|yml)$/i.test(entry.name)) continue;
      try {
        const stat = fs.statSync(filename);
        if (stat.size > 1_500_000) continue;
        documents.push({
          path: path.relative(projectRoot, filename).split(path.sep).join("/"),
          text: fs.readFileSync(filename, "utf8")
        });
      } catch {
        // Ignore unreadable source documents.
      }
    }
  }
  return documents;
}

export function listProjectAssets(projectRoot: string, limit = 500): AssetEntry[] {
  const roots = ["assets", "images", "image", "textures", "resources"].map((name) => path.join(projectRoot, name)).filter((candidate) => fs.existsSync(candidate));
  if (!roots.length && fs.existsSync(path.join(projectRoot, "assets"))) roots.push(path.join(projectRoot, "assets"));
  const candidates: Array<Omit<AssetEntry, "referencedBy" | "status">> = [];
  const pending = [...roots];
  while (pending.length && candidates.length < limit) {
    const directory = pending.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (candidates.length >= limit) break;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) pending.push(filename);
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (assetKind(extension) === "other") continue;
      try {
        const stat = fs.statSync(filename);
        candidates.push({
          name: entry.name,
          path: path.relative(projectRoot, filename).split(path.sep).join("/"),
          bytes: stat.size,
          extension,
          kind: assetKind(extension)
        });
      } catch {
        // ignore unreadable assets
      }
    }
  }
  const documents = collectReferenceDocuments(projectRoot);
  const assets: AssetEntry[] = candidates.map((asset) => {
    const withoutAssets = asset.path.replace(/^(assets|images|image|textures|resources)\//i, "");
    const referenceKeys = [asset.path, withoutAssets, asset.name].filter((value, index, list) => value.length > 2 && list.indexOf(value) === index);
    const referencedBy = documents
      .filter((document) => referenceKeys.some((key) => document.text.includes(key)))
      .map((document) => document.path)
      .slice(0, 8);
    return {
      ...asset,
      referencedBy,
      status: referencedBy.length ? "referenced" as const : "unreferenced" as const
    };
  });
  assets.sort((a, b) => a.path.localeCompare(b.path));
  return assets;
}

function run(command: string, args: string[], cwd: string, timeoutMs = 8_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (value: string) => { stdout += value; });
    child.stderr.on("data", (value: string) => { stderr += value; });
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `exit_${code}`));
        return;
      }
      resolve(stdout);
    });
  });
}

export async function readGitStatus(projectRoot: string): Promise<GitStatus> {
  const [branchOut, statusOut] = await Promise.all([
    run("git", ["rev-parse", "--abbrev-ref", "HEAD"], projectRoot),
    run("git", ["status", "--porcelain=v1", "-b"], projectRoot)
  ]);
  const lines = statusOut.split(/\r?\n/).filter(Boolean);
  const header = lines[0] || "";
  const branch = branchOut.trim() || header.replace(/^## /, "").split("...")[0] || "unknown";
  const upstreamMatch = header.match(/\.\.\.(\S+)/);
  const aheadMatch = header.match(/ahead (\d+)/);
  const behindMatch = header.match(/behind (\d+)/);
  const changes = lines.slice(1).map((line) => ({
    status: line.slice(0, 2).trim() || "?",
    path: line.slice(3).trim()
  })).filter((item) => item.path);
  return {
    branch,
    upstream: upstreamMatch?.[1],
    ahead: Number(aheadMatch?.[1] || 0),
    behind: Number(behindMatch?.[1] || 0),
    dirty: changes.length > 0,
    changes: changes.slice(0, 100)
  };
}

export function readMakerPreviewLogs(projectRoot: string, supervisorLogPath?: string, maxLines = 200): { lines: string[]; source?: string } {
  const candidates: string[] = [];
  if (supervisorLogPath) candidates.push(supervisorLogPath);
  const previewRoot = path.join(process.env.HOME || "", ".taptap-maker", "preview");
  if (fs.existsSync(previewRoot)) {
    try {
      const sessions = fs.readdirSync(previewRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(previewRoot, entry.name))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
        .slice(0, 5);
      for (const session of sessions) {
        candidates.push(path.join(session, "supervisor.log"));
        const sessionDir = path.join(session, "sessions");
        if (fs.existsSync(sessionDir)) {
          try {
            const ids = fs.readdirSync(sessionDir).sort().reverse().slice(0, 3);
            for (const id of ids) {
              candidates.push(path.join(sessionDir, id, "0", "prepare.log"));
              candidates.push(path.join(sessionDir, id, "runtime.log"));
              candidates.push(path.join(sessionDir, id, "0", "runtime.log"));
            }
          } catch {
            // ignore session scan errors
          }
        }
      }
    } catch {
      // ignore preview scan errors
    }
  }
  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    try {
      const content = fs.readFileSync(candidate, "utf8");
      const lines = content.split(/\r?\n/).filter(Boolean).slice(-maxLines);
      if (lines.length) return { lines, source: candidate };
    } catch {
      // try next candidate
    }
  }
  try {
    const relativeHint = resolveInsideProject(projectRoot, "docs");
    void relativeHint;
  } catch {
    // ignore
  }
  return { lines: ["暂无 Runtime 日志。请先启动预览，或确认 Maker supervisor 日志路径。"] };
}

export function projectHasRuntimeAdapter(projectRoot: string): { installed: boolean; paths: string[] } {
  const candidates = [
    "scripts/tapmakerwork/TapMakerWorkBridge.lua",
    "scripts/TapMakerWorkBridge.lua",
    "scripts/ui/TapMakerWorkBridge.lua",
    "scripts/core/TapMakerWorkBridge.lua",
    "runtime/lua/TapMakerWorkBridge.lua"
  ];
  const paths = candidates.filter((relative) => fs.existsSync(path.join(projectRoot, relative)));
  return { installed: paths.length > 0, paths };
}
