import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { UiConversionDocument, UiNode } from "@tapmakerwork/protocol";
import { convertLuaUiFile, loadProjectPreviewConstants } from "./lua-converter.js";
import { scoreUiBackendMarkers } from "./ui-backend.js";

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

export function isNanoVgScreenSource(source: string): boolean {
  const score = scoreUiBackendMarkers(source);
  return score.nanovg > 0 && score.yoga === 0;
}

export function isUiScreenCandidate(relativePath: string, source: string): boolean {
  if (/^scripts\/ui\//i.test(relativePath)) return true;
  // Maker projects often build overlays and dialogs from gameplay/network modules.
  // Scan those real widget constructors without treating every Lua utility as a UI.
  if (/\bUI\.(?:Panel|Label|Button|Image|Text|TextField|ScrollView|Modal|Container|View|Card|Chip|Dialog|Bar|Sprite|Icon)\s*\{/i.test(source)) {
    return true;
  }
  // Raw NanoVG screens: treat modules that own begin/end frame or primary text/rect draws as UI surfaces.
  return /\bnvg(?:BeginFrame|EndFrame)\b/.test(source)
    || (/\bnvgText(?:Box)?\b/.test(source) && /\bnvg(?:Rect|RoundedRect|Fill|Stroke)\b/.test(source));
}

function nanovgRuntimeStub(relativePath: string, source: string): UiConversionDocument {
  return {
    formatVersion: 1,
    sourceFile: relativePath,
    sourceHash: crypto.createHash("sha256").update(source).digest("hex"),
    confidence: "runtime",
    root: {
      id: "nanovg-root",
      type: "NanoVG",
      name: path.basename(relativePath, ".lua"),
      props: { ["$backend"]: "nanovg" },
      source: { file: relativePath, line: 1 },
      children: []
    },
    diagnostics: [{
      severity: "info",
      message: "NanoVG 界面由 Runtime 绘制代理捕获；静态转换不可用。"
    }]
  };
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
        let document = convertLuaUiFile(projectRoot, relativePath, constants);
        const nanovgOnly = isNanoVgScreenSource(source);
        // scripts/ui is an explicit UI catalog and keeps its helper/theme modules.
        // Outside that directory, only surface files that produced a real tree —
        // except NanoVG draw screens, which are edited from Runtime snapshots.
        if (!/^scripts\/ui\//i.test(relativePath) && document.confidence === "module") {
          if (!nanovgOnly) continue;
          document = nanovgRuntimeStub(relativePath, source);
        } else if (nanovgOnly && document.confidence === "module") {
          document = nanovgRuntimeStub(relativePath, source);
        }
        documents.set(relativePath, document);
        summaries.push({
          path: relativePath,
          name: path.basename(entry.name, ".lua"),
          confidence: document.confidence,
          nodeCount: uiNodeCount(document.root),
          ...(document.confidence === "module" ? { error: "module_only" as const } : {})
        });
      } catch (error) {
        if (isNanoVgScreenSource(source)) {
          const document = nanovgRuntimeStub(relativePath, source);
          documents.set(relativePath, document);
          summaries.push({
            path: relativePath,
            name: path.basename(entry.name, ".lua"),
            confidence: document.confidence,
            nodeCount: uiNodeCount(document.root)
          });
          continue;
        }
        summaries.push({ path: relativePath, name: path.basename(entry.name, ".lua"), error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  summaries.sort((left, right) => left.path.localeCompare(right.path));
  return { summaries, documents };
}
