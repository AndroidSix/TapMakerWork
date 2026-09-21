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
  const orientation = file.orientation
    || (makerMeta?.orientation === "landscape" ? "landscape" as const : "portrait" as const);
  return {
    url: manualUrl,
    // A test_qrcode URL points to a PNG for phones to scan. It is evidence,
    // not a browser game stream, so never feed it into Web preview.
    urlSource: manualUrl ? "manual" : "none",
    orientation,
    autoRefreshIframe: file.autoRefreshIframe ?? true,
    autoRefreshMaker: file.autoRefreshMaker ?? false,
    transport: file.transport ?? "auto",
    lastRefreshedAt: file.lastRefreshedAt,
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

export function previewPanelFingerprint(panel: PreviewPanelState): string {
  return crypto.createHash("sha1").update(`${panel.url}|${panel.reloadToken}|${panel.orientation}`).digest("hex").slice(0, 8);
}
