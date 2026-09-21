import fs from "node:fs";
import path from "node:path";
import type { ServerResponse } from "node:http";
import { resolveInsideProject } from "./project.js";

const ASSET_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml"
};

export function assetMimeType(extension: string): string | undefined {
  return ASSET_MIME_TYPES[extension.toLowerCase()];
}

// 把项目内的实际文件复制到 `<projectRoot>/assets/_external/<basename>`，
// 仅在 Windows 上且 rawAssetPath 形如 Windows 绝对路径时触发。
// 返回目标绝对路径；非 Windows / 非绝对路径直接返回 undefined。
export function adoptWindowsMimeForFile(projectRoot: string, rawAssetPath: string): string | undefined {
  if (process.platform !== "win32") return undefined;
  let stripped = rawAssetPath.trim();
  if (/^@image:/i.test(stripped)) stripped = stripped.replace(/^@image:/i, "").trim();
  // Windows 盘符路径: C:\... 或 C:/...; UNC 路径 \\host\share\... 也接受
  const isWindowsAbsolute = /^[a-zA-Z]:[\\/]/.test(stripped) || /^\\\\/.test(stripped);
  if (!isWindowsAbsolute) return undefined;
  if (!fs.existsSync(stripped)) throw new Error("project_asset_not_found:" + stripped);
  if (!fs.statSync(stripped).isFile()) throw new Error("project_asset_not_a_file:" + stripped);
  const externalDir = path.join(projectRoot, "assets", "_external");
  fs.mkdirSync(externalDir, { recursive: true });
  const target = path.join(externalDir, path.basename(stripped));
  if (path.resolve(stripped) !== path.resolve(target)) {
    try {
      fs.copyFileSync(stripped, target);
    } catch {
      return undefined;
    }
  }
  return target;
}

export function resolveProjectAsset(projectRoot: string, assetPath: string): string {
  const adopted = adoptWindowsMimeForFile(projectRoot, assetPath);
  if (adopted) return adopted;
  const direct = resolveInsideProject(projectRoot, assetPath);
  if (fs.existsSync(direct)) return direct;
  return resolveInsideProject(projectRoot, path.join("assets", assetPath));
}

// 把 filename 写到响应里。已经被 adoptWindowsMimeForFile 接管的文件会附带
// x-adopted-path 头，让调用方拿到权威的相对路径（避免本地 basename 反推）。
export function sendProjectAsset(response: ServerResponse, filename: string, projectRoot: string): void {
  const mimeType = assetMimeType(path.extname(filename));
  if (!mimeType) throw new Error("unsupported_asset_type");
  if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) throw new Error("asset_not_found");
  const headers: Record<string, string> = {
    "content-type": mimeType,
    "cache-control": "no-store",
    "access-control-allow-origin": "*"
  };
  try {
    const relative = path.relative(projectRoot, filename).split(path.sep).join("/");
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      headers["x-adopted-path"] = relative;
    }
  } catch {
    // 写头失败不影响主流程
  }
  response.writeHead(200, headers);
  fs.createReadStream(filename).pipe(response);
}