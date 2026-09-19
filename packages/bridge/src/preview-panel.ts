import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PreviewPanelState, PreviewTransport } from "@tapmakerwork/protocol";
import { resolveInsideProject } from "./project.js";

export interface PreviewPanelFile {
  url?: string | undefined;
  orientation?: "portrait" | "landscape" | undefined;
  autoRefreshIframe?: boolean | undefined;
  autoRefreshMaker?: boolean | undefined;
  transport?: PreviewTransport | undefined;
  lastRefreshedAt?: string | undefined;
  lastShotPath?: string | undefined;
  reloadToken?: number | undefined;
}

const RELATIVE_STATE_PATH = ".tapmakerwork/preview-panel.json";

function statePath(projectRoot: string): string {
  return resolveInsideProject(projectRoot, RELATIVE_STATE_PATH);
}

export function emptyPreviewPanel(): PreviewPanelState {
  return {
    url: "",
    urlSource: "none",
    orientation: "portrait",
    autoRefreshIframe: true,
    autoRefreshMaker: false,
    transport: "auto",
    reloadToken: 0
  };
}

export function loadPreviewPanelFile(projectRoot: string): PreviewPanelFile {
  try {
    const filename = statePath(projectRoot);
    if (!fs.existsSync(filename)) return {};
    return JSON.parse(fs.readFileSync(filename, "utf8")) as PreviewPanelFile;
  } catch {
    return {};
  }
}

export function savePreviewPanelFile(projectRoot: string, patch: PreviewPanelFile): void {
  const filename = statePath(projectRoot);
  const current = loadPreviewPanelFile(projectRoot);
  const next: PreviewPanelFile = {
    ...current,
    ...patch,
    ...(patch.url !== undefined ? { url: patch.url.trim() } : {})
  };
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export function resolvePreviewPanel(
  projectRoot: string,
  makerMeta?: {
    qrcodeUrl?: string | undefined;
    orientation?: string | undefined;
  }
): PreviewPanelState {
  const file = loadPreviewPanelFile(projectRoot);
  const manualUrl = file.url?.trim() || "";
  const qrcodeUrl = makerMeta?.qrcodeUrl?.trim() || "";
  const orientation = file.orientation
    || (makerMeta?.orientation === "landscape" ? "landscape" as const : "portrait" as const);
  const url = manualUrl || qrcodeUrl;
  return {
    url,
    urlSource: manualUrl ? "manual" : qrcodeUrl ? "qrcode" : "none",
    orientation,
    autoRefreshIframe: file.autoRefreshIframe ?? true,
    autoRefreshMaker: file.autoRefreshMaker ?? false,
    transport: file.transport ?? "auto",
    lastRefreshedAt: file.lastRefreshedAt,
    lastShotPath: file.lastShotPath,
    reloadToken: file.reloadToken ?? 0
  };
}

export function applyPreviewPanelPatch(
  projectRoot: string,
  patch: PreviewPanelFile,
  makerMeta?: { qrcodeUrl?: string | undefined; orientation?: string | undefined }
): PreviewPanelState {
  const cleaned: PreviewPanelFile = { ...patch };
  if (patch.url !== undefined) cleaned.url = patch.url.trim();
  savePreviewPanelFile(projectRoot, cleaned);
  return resolvePreviewPanel(projectRoot, makerMeta);
}

export function bumpPreviewReload(
  projectRoot: string,
  extra: PreviewPanelFile = {},
  makerMeta?: { qrcodeUrl?: string | undefined; orientation?: string | undefined }
): PreviewPanelState {
  const current = loadPreviewPanelFile(projectRoot);
  const nextToken = (current.reloadToken ?? 0) + 1;
  savePreviewPanelFile(projectRoot, {
    ...extra,
    reloadToken: nextToken,
    lastRefreshedAt: new Date().toISOString()
  });
  return resolvePreviewPanel(projectRoot, makerMeta);
}

export function shotsRoot(ideRoot: string): string {
  return path.join(ideRoot, "outputs", "preview-shots");
}

export function savePreviewShot(
  ideRoot: string,
  projectName: string,
  dataUrl: string,
  note?: string
): { path: string; bytes: number } {
  const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) throw new Error("preview_shot_data_url_invalid");
  const ext = match[1]!.toLowerCase().startsWith("jpe") ? "jpg" : match[1]!.toLowerCase();
  const buffer = Buffer.from(match[2]!, "base64");
  if (!buffer.length) throw new Error("preview_shot_empty");
  const safeProject = (projectName || "project").replace(/[^\w.-]+/g, "_").slice(0, 64) || "project";
  const directory = path.join(shotsRoot(ideRoot), safeProject);
  fs.mkdirSync(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = note ? `-${note.replace(/[^\w.-]+/g, "_").slice(0, 32)}` : "";
  const filename = path.join(directory, `${stamp}${suffix}.${ext}`);
  fs.writeFileSync(filename, buffer);
  return { path: filename, bytes: buffer.length };
}

export function listPreviewShots(ideRoot: string, projectName: string, limit = 12): Array<{ path: string; bytes: number; mtimeMs: number }> {
  const safeProject = (projectName || "project").replace(/[^\w.-]+/g, "_").slice(0, 64) || "project";
  const directory = path.join(shotsRoot(ideRoot), safeProject);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
    .map((name) => {
      const full = path.join(directory, name);
      const stat = fs.statSync(full);
      return { path: full, bytes: stat.size, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit);
}

export function previewPanelFingerprint(panel: PreviewPanelState): string {
  return crypto.createHash("sha1").update(`${panel.url}|${panel.reloadToken}|${panel.orientation}`).digest("hex").slice(0, 8);
}
