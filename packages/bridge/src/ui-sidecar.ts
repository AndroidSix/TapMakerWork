import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { UiNode, UiSnapshot } from "@tapmakerwork/protocol";
import { readProjectText, resolveInsideProject, writeProjectText } from "./project.js";

export const UI_SIDECAR_FORMAT_VERSION = 1 as const;

export interface UiSidecarDocument {
  formatVersion: typeof UI_SIDECAR_FORMAT_VERSION;
  sourceFile: string;
  sourceHash: string;
  savedAt: string;
  confidence: "static" | "hybrid" | "runtime" | "module" | "sidecar";
  root: UiNode;
  selectedId?: string | undefined;
}

export function sidecarRelativePath(sourceFile: string): string {
  return sourceFile.replace(/\.lua$/i, ".ui.json");
}

export function readUiSidecar(projectRoot: string, sourceFile: string): UiSidecarDocument | undefined {
  const relative = sidecarRelativePath(sourceFile);
  try {
    const text = readProjectText(projectRoot, relative);
    const parsed = JSON.parse(text) as UiSidecarDocument;
    if (!parsed || typeof parsed !== "object" || !parsed.root) return undefined;
    return {
      ...parsed,
      formatVersion: UI_SIDECAR_FORMAT_VERSION,
      sourceFile: parsed.sourceFile || sourceFile,
      confidence: "sidecar",
      root: parsed.root,
      ...(parsed.selectedId ? { selectedId: parsed.selectedId } : {})
    };
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
  confidence: UiSidecarDocument["confidence"] = "sidecar"
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
    ...(snapshot.selectedId ? { selectedId: snapshot.selectedId } : {})
  };
  writeProjectText(projectRoot, relative, `${JSON.stringify(document, null, 2)}\n`);
  return { path: relative, document };
}

export function snapshotFromSidecar(sidecar: UiSidecarDocument, revision: number): UiSnapshot {
  return {
    revision,
    root: sidecar.root,
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
