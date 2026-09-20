import fs from "node:fs";
import path from "node:path";
import type { UiConversionDocument, UiNode } from "@tapmakerwork/protocol";
import { convertLuaUiFile, loadProjectPreviewConstants } from "./lua-converter.js";

export interface UiScreenSummary {
  path: string;
  name: string;
  confidence?: UiConversionDocument["confidence"];
  nodeCount?: number;
  error?: string;
}

export function uiNodeCount(node: UiNode): number {
  return 1 + node.children.reduce((total, child) => total + uiNodeCount(child), 0);
}

export function isUiScreenCandidate(relativePath: string, source: string): boolean {
  if (/^scripts\/ui\//i.test(relativePath)) return true;
  // Maker projects often build overlays and dialogs from gameplay/network modules.
  // Scan those real widget constructors without treating every Lua utility as a UI.
  return /\bUI\.(?:Panel|Label|Button|Image|Text|TextField|ScrollView|Modal|Container|View|Card|Chip|Dialog|Bar|Sprite|Icon)\s*\{/i.test(source);
}

export function scanUiScreens(projectRoot: string): { summaries: UiScreenSummary[]; documents: Map<string, UiConversionDocument> } {
  const scriptsRoot = path.join(projectRoot, "scripts");
  const documents = new Map<string, UiConversionDocument>();
  const summaries: UiScreenSummary[] = [];
  if (!fs.existsSync(scriptsRoot)) return { summaries, documents };
  const constants = loadProjectPreviewConstants(projectRoot);
  const pending = [scriptsRoot];
  while (pending.length) {
    const directory = pending.pop()!;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) { pending.push(filename); continue; }
      if (!entry.isFile() || !entry.name.endsWith(".lua")) continue;
      const relativePath = path.relative(projectRoot, filename).split(path.sep).join("/");
      const source = fs.readFileSync(filename, "utf8");
      if (!isUiScreenCandidate(relativePath, source)) continue;
      try {
        const document = convertLuaUiFile(projectRoot, relativePath, constants);
        // scripts/ui is an explicit UI catalog and keeps its helper/theme modules.
        // Outside that directory, only surface files that produced a real tree.
        if (!/^scripts\/ui\//i.test(relativePath) && document.confidence === "module") continue;
        documents.set(relativePath, document);
        summaries.push({
          path: relativePath,
          name: path.basename(entry.name, ".lua"),
          confidence: document.confidence,
          nodeCount: uiNodeCount(document.root),
          ...(document.confidence === "module" ? { error: "module_only" as const } : {})
        });
      } catch (error) {
        summaries.push({ path: relativePath, name: path.basename(entry.name, ".lua"), error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  summaries.sort((left, right) => left.path.localeCompare(right.path));
  return { summaries, documents };
}
