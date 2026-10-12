import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AssetKind, AssetSizeReport, TrashedAsset } from "@tapmakerwork/protocol";
import type { AssetEntry } from "./ide-tools.js";
import { renameWithRetry, resolveInsideProject, writeFileAtomic } from "./project.js";

const TRASH_RELATIVE_DIR = ".tapmakerwork/trash";
const LARGEST_ASSET_COUNT = 12;
const COMPRESS_CANDIDATE_MIN_BYTES = 50 * 1024;
const COMPRESSIBLE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const ASSET_KINDS: AssetKind[] = ["image", "audio", "video", "model", "font", "other"];

interface TrashManifest {
  entries: TrashedAsset[];
}

export interface TrashMoveResult {
  moved: TrashedAsset[];
  skipped: Array<{ path: string; reason: "not_unreferenced" | "missing" }>;
}

export interface TrashRestoreResult {
  restored: TrashedAsset[];
  skipped: Array<{ id: string; reason: "unknown_id" | "target_exists" | "missing" }>;
}

function trashDirectory(projectRoot: string): string {
  return path.join(projectRoot, TRASH_RELATIVE_DIR);
}

function manifestPath(projectRoot: string): string {
  return path.join(trashDirectory(projectRoot), "manifest.json");
}

function storedFilePath(projectRoot: string, entry: TrashedAsset): string {
  return path.join(trashDirectory(projectRoot), "files", entry.id, path.basename(entry.originalPath));
}

function readManifest(projectRoot: string): TrashManifest {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath(projectRoot), "utf8")) as Partial<TrashManifest>;
    return { entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch {
    return { entries: [] };
  }
}

function writeManifest(projectRoot: string, manifest: TrashManifest): void {
  writeFileAtomic(manifestPath(projectRoot), `${JSON.stringify(manifest, null, 2)}\n`);
}

function newTrashId(): string {
  return `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export function listTrashedAssets(projectRoot: string): TrashedAsset[] {
  return readManifest(projectRoot).entries;
}

export function moveUnreferencedAssetsToTrash(projectRoot: string, assets: AssetEntry[], requestedPaths: string[]): TrashMoveResult {
  const unreferenced = new Set(assets.filter((asset) => asset.status === "unreferenced").map((asset) => asset.path));
  const manifest = readManifest(projectRoot);
  const result: TrashMoveResult = { moved: [], skipped: [] };
  for (const relativePath of new Set(requestedPaths)) {
    if (!unreferenced.has(relativePath)) {
      result.skipped.push({ path: relativePath, reason: "not_unreferenced" });
      continue;
    }
    const source = resolveInsideProject(projectRoot, relativePath);
    if (!fs.existsSync(source)) {
      result.skipped.push({ path: relativePath, reason: "missing" });
      continue;
    }
    const entry: TrashedAsset = {
      id: newTrashId(),
      originalPath: relativePath,
      bytes: fs.statSync(source).size,
      trashedAt: new Date().toISOString()
    };
    const target = storedFilePath(projectRoot, entry);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    renameWithRetry(source, target);
    manifest.entries.push(entry);
    result.moved.push(entry);
  }
  if (result.moved.length) writeManifest(projectRoot, manifest);
  return result;
}

export function restoreTrashedAssets(projectRoot: string, ids: string[]): TrashRestoreResult {
  const manifest = readManifest(projectRoot);
  const result: TrashRestoreResult = { restored: [], skipped: [] };
  for (const id of new Set(ids)) {
    const entry = manifest.entries.find((candidate) => candidate.id === id);
    if (!entry) {
      result.skipped.push({ id, reason: "unknown_id" });
      continue;
    }
    const stored = storedFilePath(projectRoot, entry);
    const target = resolveInsideProject(projectRoot, entry.originalPath);
    if (!fs.existsSync(stored)) {
      result.skipped.push({ id, reason: "missing" });
      continue;
    }
    if (fs.existsSync(target)) {
      result.skipped.push({ id, reason: "target_exists" });
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    renameWithRetry(stored, target);
    fs.rmSync(path.dirname(stored), { recursive: true, force: true });
    result.restored.push(entry);
  }
  if (result.restored.length) {
    const restoredIds = new Set(result.restored.map((entry) => entry.id));
    writeManifest(projectRoot, { entries: manifest.entries.filter((entry) => !restoredIds.has(entry.id)) });
  }
  return result;
}

export function purgeTrashedAssets(projectRoot: string, ids: string[]): TrashedAsset[] {
  const manifest = readManifest(projectRoot);
  const purgeIds = new Set(ids);
  const purged = manifest.entries.filter((entry) => purgeIds.has(entry.id));
  for (const entry of purged) fs.rmSync(path.dirname(storedFilePath(projectRoot, entry)), { recursive: true, force: true });
  if (purged.length) writeManifest(projectRoot, { entries: manifest.entries.filter((entry) => !purgeIds.has(entry.id)) });
  return purged;
}

function isCompressCandidate(asset: AssetEntry): boolean {
  return COMPRESSIBLE_EXTENSIONS.has(asset.extension) && asset.bytes >= COMPRESS_CANDIDATE_MIN_BYTES;
}

export function buildAssetSizeReport(
  assets: AssetEntry[],
  trashed: TrashedAsset[],
  isAlreadyCompressed: (asset: AssetEntry) => boolean = () => false
): AssetSizeReport {
  const byKind = Object.fromEntries(ASSET_KINDS.map((kind) => [kind, { count: 0, bytes: 0 }])) as AssetSizeReport["byKind"];
  const report: AssetSizeReport = {
    totalBytes: 0,
    byKind,
    largest: [],
    unreferenced: { count: 0, bytes: 0 },
    compressCandidates: { count: 0, bytes: 0 },
    trash: { count: trashed.length, bytes: trashed.reduce((sum, entry) => sum + entry.bytes, 0) }
  };
  for (const asset of assets) {
    report.totalBytes += asset.bytes;
    byKind[asset.kind].count += 1;
    byKind[asset.kind].bytes += asset.bytes;
    if (asset.status === "unreferenced") {
      report.unreferenced.count += 1;
      report.unreferenced.bytes += asset.bytes;
    }
    if (isCompressCandidate(asset) && !isAlreadyCompressed(asset)) {
      report.compressCandidates.count += 1;
      report.compressCandidates.bytes += asset.bytes;
    }
  }
  report.largest = [...assets]
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, LARGEST_ASSET_COUNT)
    .map((asset) => ({ path: asset.path, bytes: asset.bytes, kind: asset.kind, referenced: asset.status !== "unreferenced" }));
  return report;
}
