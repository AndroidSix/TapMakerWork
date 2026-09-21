import http, { type IncomingMessage, type ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  applyUiTreeOp,
  findParentInfo,
  findUiNode,
  type BridgeCapabilities,
  type BridgeEvent,
  type RuntimeCommand,
  type SnapshotSource,
  type UiConversionDocument,
  type UiNode,
  type UiPatch,
  type UiSnapshot,
  type UiTreeOp
} from "@tapmakerwork/protocol";
import {
  checkNodeRuntimeUpdates,
  checkMakerRuntimeUpdates,
  compareMakerVersions,
  discoverNodeRuntime,
  discoverMakerRuntime,
  installMakerRuntimeVersion,
  listInstalledNodeRuntimes,
  listInstalledMakerRuntimes,
  readMakerProjectMeta,
  readMakerRuntimePreference,
  runMakerBuild,
  runMakerCommand,
  runMakerDoctor,
  runMakerQrcode,
  runMakerReadOnly,
  writeMakerRuntimePreference,
  type MakerRemoteVersions,
  type NodeRemoteVersion,
  type MakerRuntimeMode
} from "./maker.js";
import { scanUiScreens, uiNodeCount, type UiScreenSummary } from "./ui-screens.js";
import { listProjectEntries, readProjectText, resolveInsideProject, resolveProjectRoot, writeProjectText, type ProjectBinding } from "./project.js";
import { sandboxStatus } from "./sandbox.js";
import { EditorState } from "./state.js";
import { convertLuaUiFile, snapshotFromConversion } from "./lua-converter.js";
import { commitGitProject, listProjectAssets, projectHasRuntimeAdapter, pullGitProject, readGitStatus, readMakerPreviewLogs, searchProject } from "./ide-tools.js";
import { exportRuntimeAdapterPackage, installRuntimeAdapter } from "./adapter-pack.js";
import { findRuntimeFileStatus, normalizeUiTree, writeIdeCommandsFile } from "./runtime-file-channel.js";
import { findUiNodePath, readUiSidecar, sidecarExists, sidecarRelativePath, snapshotFromSidecar, uiNodeAtLine, writeUiSidecar } from "./ui-sidecar.js";
import {
  applyPreviewPanelPatch,
  bumpPreviewReload,
  listPreviewShots,
  resolvePreviewPanel,
  savePreviewShot,
  type PreviewPanelFile
} from "./preview-panel.js";
import { buildProjectWorkflowOverview, saveProjectWorkflow } from "./project-workflow.js";

let lastAppliedRuntimeRevision = -1;
let snapshotSource: SnapshotSource = "empty";
let runtimeFileSessionId: string | undefined;

function syncRuntimeFileChannel(): ReturnType<typeof findRuntimeFileStatus> {
  const status = findRuntimeFileStatus();
  if (!status) return undefined;
  if (status.sessionId) {
    if (runtimeFileSessionId && runtimeFileSessionId !== status.sessionId) {
      runtimeCommands.splice(0, runtimeCommands.length);
      nextRuntimeCommandId = Number(status.cursor || 0) + 1;
      lastAppliedRuntimeRevision = -1;
    } else if (!runtimeFileSessionId && runtimeCommands.length === 0) {
      // The Bridge dev process can restart while the Maker Runtime remains
      // alive. Continue after its acknowledged cursor instead of issuing IDs
      // that the adapter correctly treats as already applied.
      nextRuntimeCommandId = Math.max(nextRuntimeCommandId, Number(status.cursor || 0) + 1);
    }
    runtimeFileSessionId = status.sessionId;
    runtimeSessionId = status.sessionId;
    runtimeConnectedAt = new Date().toISOString();
  }
  const snap = status.snapshot as UiSnapshot | undefined;
  if (snap?.root) {
    const sceneText = JSON.stringify(snap.root).slice(0, 8000);
    if (/loadingScreen|bootProgress|overlayProgress|正在加载|渡劫准备|正在开辟|loading_keyart/i.test(sceneText)) {
      runtimeScene = "loading";
    } else if (/hud|MainShell|Button|Label/i.test(sceneText)) {
      if (runtimeScene === "loading") {
        broadcast({ type: "log.append", channel: "runtime", lines: ["真机已离开加载画面，正在同步活树…"] });
      }
      runtimeScene = "live";
    }
  }
  const revision = Number(status.revision || 0);
  // 加载页不覆盖编辑中的界面结构，避免「画布=MainShell / 真机=Loading」被错误合并
  const applyLoading = false;
  if (snap?.root && revision && revision !== lastAppliedRuntimeRevision) {
    const normalized = normalizeUiTree(snap.root) as UiNode;
    const runtimeText = JSON.stringify(normalized).slice(0, 8000);
    const looksLikeLoading = /loadingScreen|bootProgress|overlayProgress|正在加载|正在开辟|渡劫准备/.test(runtimeText);
    const current = editor.getSnapshot();
    const currentText = JSON.stringify(current.root || {}).slice(0, 8000);
    const currentConcrete = (currentText.match(/"type":"(Panel|Label|Button)"/g) || []).length;
    const runtimeConcrete = (JSON.stringify(normalized).match(/"type":"(Panel|Label|Button|ProgressBar)"/g) || []).length;
    const layoutScore = (function score(node: UiNode, depth = 0): number {
      if (!node || typeof node !== "object") return 0;
      const layout = node.props?.$layout as { w?: number; h?: number } | undefined;
      const usable = layout && ((Number(layout.w) || 0) > 0 || (Number(layout.h) || 0) > 0);
      const children = Array.isArray(node.children) ? node.children : [];
      return (usable ? 1 : 0) + (depth < 8 ? children.reduce((sum, child) => sum + score(child, depth + 1), 0) : 0);
    })(normalized);
    const shouldApply = looksLikeLoading
      ? applyLoading && runtimeConcrete > currentConcrete
      : layoutScore >= 1 || runtimeConcrete >= Math.max(3, currentConcrete) || !looksLikeLoading;
    if (shouldApply) {
      lastAppliedRuntimeRevision = revision;
      try {
        const next = editor.replaceFromRuntime({
          ...snap,
          root: normalized,
          revision: current.revision + 1
        });
        snapshotSource = "runtime";
        broadcast({ type: "ui.snapshot", snapshot: next, source: "runtime" });
      } catch {
        // ignore malformed runtime snapshot
      }
    }
  }
  const cursor = Number(status.cursor || 0);
  const pending = runtimeCommands.filter((command) => command.id > cursor);
  if (pending.length && status.sourcePath) {
    try {
      writeIdeCommandsFile(status, pending as unknown as Array<Record<string, unknown>>);
    } catch {
      // ignore write failures
    }
  }
  return status;
}

const host = "127.0.0.1";
const port = Number(process.env.TAPMAKERWORK_BRIDGE_PORT || 43121);
let makerRuntime = discoverMakerRuntime();
let makerRemoteVersions: MakerRemoteVersions | undefined;
let nodeRemoteVersion: NodeRemoteVersion | undefined;
const sandbox = sandboxStatus();
let project: ProjectBinding | undefined;

if (process.env.TAPMAKERWORK_PROJECT) {
  try {
    project = resolveProjectRoot(process.env.TAPMAKERWORK_PROJECT);
  } catch (error) {
    process.stderr.write(`[TapMakerWork] Project binding failed: ${String(error)}\n`);
  }
}

function pickInitialConversion(screens: ReturnType<typeof scanUiScreens>, fallback: string) {
  const preferred = ["scripts/ui/MainShell.lua", "scripts/ui/HomePage.lua", fallback];
  return preferred.map((p) => screens.documents.get(p)).find(Boolean)
    ?? [...screens.documents.values()].find((doc) => doc.confidence !== "module")
    ?? screens.documents.values().next().value;
}

const defaultUiEntry = process.env.TAPMAKERWORK_UI_ENTRY || "scripts/ui/HomePage.lua";
let activeUiEntry = defaultUiEntry;
let uiScreens = project ? scanUiScreens(project.root) : { summaries: [] as UiScreenSummary[], documents: new Map<string, UiConversionDocument>() };
let conversion = project ? pickInitialConversion(uiScreens, defaultUiEntry) : uiScreens.documents.get(activeUiEntry) ?? uiScreens.documents.values().next().value;
if (conversion) activeUiEntry = conversion.sourceFile;
const editor = new EditorState(conversion ? snapshotFromConversion(conversion) : undefined);
const runtimeCommands: RuntimeCommand[] = [];
let nextRuntimeCommandId = 1;
let runtimeConnectedAt: string | undefined;
let runtimeSessionId: string | undefined;
let runtimeScene: "idle" | "loading" | "live" = "idle";

type RuntimeCommandInput = RuntimeCommand extends infer Command
  ? Command extends { id: number } ? Omit<Command, "id"> : never
  : never;

function enqueueRuntimeCommand(command: RuntimeCommandInput): RuntimeCommand {
  const queued = { ...command, id: nextRuntimeCommandId++ } as RuntimeCommand;
  runtimeCommands.push(queued);
  if (runtimeCommands.length > 1_000) runtimeCommands.splice(0, runtimeCommands.length - 1_000);
  return queued;
}

const capabilities: BridgeCapabilities = {
  makerCli: Boolean(makerRuntime),
  runtimeFrames: false,
  uiBridge: true,
  shellSandbox: sandbox.available,
  luaRepl: false,
  platform: process.platform
};

function makerVersionsPayload() {
  const installed = listInstalledMakerRuntimes();
  const preference = readMakerRuntimePreference();
  const stableInstalled = installed.find((runtime) => !runtime.version.includes("-"));
  const betaInstalled = installed.find((runtime) => runtime.version.includes("-"));
  return {
    preference,
    active: makerRuntime,
    installed,
    channels: {
      stable: {
        installed: stableInstalled?.version,
        latest: makerRemoteVersions?.stable,
        updateAvailable: Boolean(makerRemoteVersions?.stable && (!stableInstalled || compareMakerVersions(makerRemoteVersions.stable, stableInstalled.version) > 0))
      },
      beta: {
        installed: betaInstalled?.version,
        latest: makerRemoteVersions?.beta,
        updateAvailable: Boolean(makerRemoteVersions?.beta && (!betaInstalled || compareMakerVersions(makerRemoteVersions.beta, betaInstalled.version) > 0))
      }
    },
    checkedAt: makerRemoteVersions?.checkedAt
  };
}

function nodeVersionsPayload() {
  const installed = listInstalledNodeRuntimes();
  const active = discoverNodeRuntime();
  const latest = nodeRemoteVersion?.stable;
  return {
    device: active.source === "device" ? active : null,
    embedded: { version: process.version.replace(/^v/, ""), executable: process.execPath },
    active,
    installed,
    stable: {
      installed: active.version,
      latest,
      updateAvailable: Boolean(latest && compareMakerVersions(latest, active.version) > 0)
    },
    checkedAt: nodeRemoteVersion?.checkedAt
  };
}

function refreshSelectedMakerRuntime(): void {
  makerRuntime = discoverMakerRuntime();
  capabilities.makerCli = Boolean(makerRuntime);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*"
  });
  response.end(JSON.stringify(body));
}

function sendProjectAsset(response: ServerResponse, filename: string): void {
  const extension = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml"
  };
  const mimeType = mimeTypes[extension];
  if (!mimeType) throw new Error("unsupported_asset_type");
  if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) throw new Error("asset_not_found");
  response.writeHead(200, {
    "content-type": mimeType,
    "cache-control": "no-store",
    "access-control-allow-origin": "*"
  });
  fs.createReadStream(filename).pipe(response);
}

function resolveProjectAsset(projectRoot: string, assetPath: string): string {
  const direct = resolveInsideProject(projectRoot, assetPath);
  if (fs.existsSync(direct)) return direct;
  return resolveInsideProject(projectRoot, path.join("assets", assetPath));
}

async function readJson(request: IncomingMessage, maxBytes = 1_048_576): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const data = Buffer.from(chunk);
    size += data.length;
    if (size > maxBytes) throw new Error("request_too_large");
    chunks.push(data);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function validOrigin(request: IncomingMessage): boolean {
  const hostHeader = request.headers.host;
  const origin = request.headers.origin;
  if (hostHeader !== `${host}:${port}`) return false;
  return !origin || origin === "http://127.0.0.1:4173" || origin.startsWith("file://");
}

const server = http.createServer(async (request, response) => {
  try {
    if (!validOrigin(request)) {
      process.stderr.write(`[TapMakerWork] reject origin host=${request.headers.host} origin=${request.headers.origin} url=${request.url}\n`);
      sendJson(response, 403, { error: "invalid_origin" });
      return;
    }
    const url = new URL(request.url || "/", `http://${host}:${port}`);
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type"
      });
      response.end();
    } else if (request.method === "GET" && url.pathname === "/api/health") {
      const fileStatus = syncRuntimeFileChannel();
      const adapter = project ? projectHasRuntimeAdapter(project.root) : { installed: false, paths: [] as string[] };
      sendJson(response, 200, {
        ok: true,
        capabilities: {
          ...capabilities,
          runtimeBridge: adapter.installed || Boolean(runtimeSessionId),
          makerBuild: Boolean(makerRuntime),
          makerQrcode: Boolean(makerRuntime)
        },
        makerVersion: makerRuntime?.version,
        makerProjectMeta: project ? readMakerProjectMeta(project.root) : null,
        sandbox,
        runtimeSessionId,
        runtimeConnectedAt,
        runtimeScene,
        snapshotSource,
        runtimeAdapter: adapter,
        runtimeTransport: fileStatus?.transport || (runtimeSessionId ? "http-or-file" : "none"),
        runtimeFileChannel: fileStatus ? {
          sessionId: fileStatus.sessionId,
          transport: fileStatus.transport,
          cursor: fileStatus.cursor,
          lastHttpError: fileStatus.lastHttpError,
          snapshotError: fileStatus.snapshotError,
          snapshotBytes: fileStatus.snapshotBytes,
          rootType: fileStatus.rootType,
          childCount: fileStatus.childCount,
          wroteSnapshot: fileStatus.snapshotBytes != null ? Number(fileStatus.snapshotBytes) > 0 : Boolean(fileStatus.snapshot),
          sourcePath: fileStatus.sourcePath,
          snapshotPath: fileStatus.snapshotPath
        } : null,
        protocolVersion: PROTOCOL_VERSION
      });
    } else if (request.method === "GET" && url.pathname === "/api/project/search") {
      if (!project) throw new Error("project_not_open");
      const query = url.searchParams.get("q") || "";
      sendJson(response, 200, { query, hits: searchProject(project.root, query, Number(url.searchParams.get("limit") || 50)) });
    } else if (request.method === "GET" && url.pathname === "/api/workflow/overview") {
      if (!project) throw new Error("project_not_open");
      let git;
      let gitError: string | undefined;
      try {
        git = await readGitStatus(project.root);
      } catch (error) {
        gitError = error instanceof Error ? error.message : String(error);
      }
      const makerMeta = readMakerProjectMeta(project.root);
      const panel = resolvePreviewPanel(project.root, makerMeta);
      const fileStatus = syncRuntimeFileChannel();
      const ideRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
      sendJson(response, 200, buildProjectWorkflowOverview({
        projectRoot: project.root,
        projectName: project.name,
        makerBound: project.makerBound,
        makerCli: Boolean(makerRuntime),
        makerVersion: makerRuntime?.version,
        uiScreenCount: uiScreens.summaries.length,
        runtimeSessionId,
        runtimeScene,
        runtimeSnapshotPath: fileStatus?.snapshotPath,
        previewPanel: panel,
        qrcodeUrl: makerMeta.qrcodeUrl,
        git,
        gitError,
        assets: listProjectAssets(project.root),
        shots: listPreviewShots(ideRoot, project.name)
      }));
    } else if (request.method === "POST" && url.pathname === "/api/workflow/state") {
      if (!project) throw new Error("project_not_open");
      const body = await readJson(request) as { objective?: string };
      const state = saveProjectWorkflow(project.root, body.objective !== undefined ? { objective: body.objective } : {});
      sendJson(response, 200, { ok: true, state });
    } else if (request.method === "GET" && url.pathname === "/api/project/assets") {
      if (!project) throw new Error("project_not_open");
      sendJson(response, 200, { assets: listProjectAssets(project.root) });
    } else if (request.method === "GET" && url.pathname === "/api/git/status") {
      if (!project) throw new Error("project_not_open");
      sendJson(response, 200, await readGitStatus(project.root));
    } else if (request.method === "POST" && url.pathname === "/api/git/pull") {
      if (!project) throw new Error("project_not_open");
      const result = await pullGitProject(project.root);
      broadcast({ type: "log.append", channel: "build", lines: [result.ok ? "Git 拉取完成。" : `Git 拉取停止：${result.error || "unknown"}`] });
      sendJson(response, result.ok ? 200 : 409, result);
    } else if (request.method === "POST" && url.pathname === "/api/git/commit") {
      if (!project) throw new Error("project_not_open");
      const body = await readJson(request) as { message?: string; push?: boolean; remoteBuild?: boolean };
      const result = await commitGitProject(project.root, body.message || "", Boolean(body.push));
      if (!result.ok) {
        broadcast({ type: "log.append", channel: "build", lines: [`Git 提交停止：${result.error || "unknown"}`] });
        sendJson(response, 409, result);
      } else if (body.remoteBuild) {
        if (!body.push) throw new Error("remote_build_requires_push");
        if (!makerRuntime) throw new Error("maker_cli_not_found");
        broadcast({ type: "log.append", channel: "build", lines: ["Git 已推送，开始调用 Maker MCP 远端构建并刷新预览…"] });
        try {
          const build = await runMakerBuild(makerRuntime, project.root);
          let previewRefresh: { ok: boolean; error?: string } = { ok: true };
          try {
            await runMakerCommand(makerRuntime, project.root, "refresh", 45_000);
          } catch (refreshError) {
            previewRefresh = { ok: false, error: refreshError instanceof Error ? refreshError.message : String(refreshError) };
          }
          const panel = bumpPreviewReload(project.root, {}, readMakerProjectMeta(project.root));
          broadcast({ type: "preview.panel", panel, reason: "git-remote-build" });
          broadcast({
            type: "log.append",
            channel: "build",
            lines: [
              "Maker MCP 远端构建完成。",
              previewRefresh.ok ? "Maker Runtime / Web 预览刷新完成。" : `构建成功，但 Runtime 刷新未完成：${previewRefresh.error}`,
              JSON.stringify(build).slice(0, 4000)
            ]
          });
          sendJson(response, 200, { ...result, remoteBuild: { ok: true, result: build, previewRefresh }, panel });
        } catch (buildError) {
          const message = buildError instanceof Error ? buildError.message : String(buildError);
          broadcast({ type: "log.append", channel: "build", lines: [`Git 已推送，但 Maker MCP 远端构建失败：${message}`] });
          sendJson(response, 502, { ...result, remoteBuild: { ok: false, error: message } });
        }
      } else {
        broadcast({ type: "log.append", channel: "build", lines: [body.push ? "Git 提交并推送完成。" : "Git 本地提交完成。"] });
        sendJson(response, 200, result);
      }
    } else if (request.method === "GET" && url.pathname === "/api/maker/qrcode/image") {
      if (!project) throw new Error("project_not_open");
      const qrcodeUrl = readMakerProjectMeta(project.root).qrcodeUrl;
      if (!qrcodeUrl || !/^https:\/\//i.test(qrcodeUrl)) throw new Error("qrcode_url_not_found");
      const remote = await fetch(qrcodeUrl, { signal: AbortSignal.timeout(15_000) });
      if (!remote.ok) throw new Error(`qrcode_image_${remote.status}`);
      const contentType = remote.headers.get("content-type") || "image/png";
      if (!contentType.startsWith("image/")) throw new Error("qrcode_response_not_image");
      const bytes = Buffer.from(await remote.arrayBuffer());
      response.writeHead(200, {
        "content-type": contentType,
        "content-length": bytes.length,
        "cache-control": "no-store",
        "access-control-allow-origin": "*"
      });
      response.end(bytes);
    } else if (request.method === "GET" && url.pathname === "/api/runtime/adapter") {
      const adapter = project ? projectHasRuntimeAdapter(project.root) : { installed: false, paths: [] as string[] };
      sendJson(response, 200, adapter);
    } else if (request.method === "POST" && url.pathname === "/api/runtime/adapter/export") {
      const body = await readJson(request) as { projectName?: string };
      const projectName = body.projectName || project?.name || "your-maker-project";
      const result = exportRuntimeAdapterPackage({
        bridgePackageRoot: fileURLToPath(new URL(".", import.meta.url)),
        projectName,
        projectRoot: project?.root
      });
      sendJson(response, 200, result);
    } else if (request.method === "POST" && url.pathname === "/api/runtime/adapter/install") {
      if (!project) throw new Error("project_not_open");
      const result = installRuntimeAdapter({
        bridgePackageRoot: fileURLToPath(new URL(".", import.meta.url)),
        projectRoot: project.root
      });
      sendJson(response, 200, result);
    } else if (request.method === "GET" && url.pathname === "/api/system/info") {
      sendJson(response, 200, {
        platform: process.platform,
        node: process.version,
        bridgePort: port,
        makerVersion: makerRuntime?.version,
        makerEntry: makerRuntime?.entry,
        project: project ? { root: project.root, name: project.name, makerBound: project.makerBound } : null,
        activeUiEntry,
        runtimeSessionId,
        runtimeConnectedAt,
        capabilities
      });
    } else if (request.method === "GET" && url.pathname === "/api/project") {
      sendJson(response, 200, { project, activeUiEntry });
    } else if (request.method === "POST" && url.pathname === "/api/project/open") {
      const body = await readJson(request) as { path?: string };
      project = resolveProjectRoot(body.path || "");
      uiScreens = scanUiScreens(project.root);
      conversion = pickInitialConversion(uiScreens, defaultUiEntry);
      activeUiEntry = conversion?.sourceFile ?? defaultUiEntry;
      const sidecar = conversion ? readUiSidecar(project.root, conversion.sourceFile) : undefined;
      const baseSnapshot = sidecar
        ? snapshotFromSidecar(sidecar, 1)
        : conversion
          ? snapshotFromConversion(conversion)
          : new EditorState().getSnapshot();
      const snapshot = editor.reset(baseSnapshot);
      broadcast({ type: "ui.snapshot", snapshot });
      sendJson(response, 200, {
        project,
        snapshot,
        activeUiEntry,
        sidecar: conversion ? {
          path: sidecarRelativePath(conversion.sourceFile),
          exists: sidecarExists(project.root, conversion.sourceFile)
        } : undefined
      });
    } else if (request.method === "GET" && url.pathname === "/api/project/files") {
      if (!project) throw new Error("project_not_open");
      sendJson(response, 200, { entries: listProjectEntries(project.root, url.searchParams.get("path") || ".") });
    } else if (request.method === "GET" && url.pathname === "/api/project/file") {
      if (!project) throw new Error("project_not_open");
      const sourceFile = url.searchParams.get("path");
      if (!sourceFile) throw new Error("project_file_path_required");
      sendJson(response, 200, { path: sourceFile, text: readProjectText(project.root, sourceFile), readOnly: false });
    } else if (request.method === "POST" && url.pathname === "/api/project/file") {
      if (!project) throw new Error("project_not_open");
      const body = await readJson(request, 5_500_000) as { path?: string; text?: string };
      if (!body.path || typeof body.text !== "string") throw new Error("project_file_content_required");
      writeProjectText(project.root, body.path, body.text);
      let snapshot;
      if (body.path.endsWith(".lua")) {
        uiScreens = scanUiScreens(project.root);
        const conversion = convertLuaUiFile(project.root, activeUiEntry);
        if (conversion) {
          uiScreens.documents.set(activeUiEntry, conversion);
          snapshot = editor.reset(snapshotFromConversion(conversion));
          broadcast({ type: "ui.snapshot", snapshot });
        }
      }
      sendJson(response, 200, { ok: true, path: body.path, snapshot });
    } else if (request.method === "GET" && url.pathname === "/api/project/asset") {
      if (!project) throw new Error("project_not_open");
      const assetPath = url.searchParams.get("path");
      if (!assetPath) throw new Error("project_asset_path_required");
      sendProjectAsset(response, resolveProjectAsset(project.root, assetPath));
    } else if (request.method === "GET" && url.pathname === "/api/ui/snapshot") {
      sendJson(response, 200, editor.getSnapshot());
    } else if (request.method === "POST" && url.pathname === "/api/ui/screens/rescan") {
      if (!project) throw new Error("project_not_open");
      uiScreens = scanUiScreens(project.root);
      if (!uiScreens.documents.has(activeUiEntry)) {
        conversion = pickInitialConversion(uiScreens, defaultUiEntry);
        if (conversion) activeUiEntry = conversion.sourceFile;
      }
      sendJson(response, 200, { screens: uiScreens.summaries, activePath: activeUiEntry });
    } else if (request.method === "GET" && url.pathname === "/api/ui/screens") {
      if (!project) throw new Error("project_not_open");
      sendJson(response, 200, { screens: uiScreens.summaries, activePath: activeUiEntry });
    } else if (request.method === "POST" && url.pathname === "/api/ui/open") {
      if (!project) throw new Error("project_not_open");
      const body = await readJson(request) as { path?: string };
      if (!body.path) throw new Error("ui_screen_path_required");
      conversion = uiScreens.documents.get(body.path);
      try {
        conversion = convertLuaUiFile(project.root, body.path);
        uiScreens.documents.set(body.path, conversion);
        const summaryIndex = uiScreens.summaries.findIndex((item) => item.path === body.path);
        if (summaryIndex >= 0 && uiScreens.summaries[summaryIndex]) {
          const prev = uiScreens.summaries[summaryIndex];
          const nextSummary: UiScreenSummary = {
            path: prev.path,
            name: prev.name,
            confidence: conversion.confidence,
            nodeCount: uiNodeCount(conversion.root),
            ...(conversion.confidence === "module" ? { error: "module_only" as const } : {})
          };
          uiScreens.summaries[summaryIndex] = nextSummary;
        }
      } catch (error) {
        if (!conversion) {
          sendJson(response, 400, { error: error instanceof Error ? error.message : "ui_screen_not_convertible" });
          return;
        }
      }
      if (!conversion) throw new Error("ui_screen_not_convertible");
      activeUiEntry = body.path;
      const sidecar = project ? readUiSidecar(project.root, body.path) : undefined;
      const convertedSnapshot = snapshotFromConversion(conversion);
      const countNodes = (node: UiNode): number => {
        const children = Array.isArray(node.children) ? node.children : [];
        return 1 + children.reduce((sum, child) => sum + countNodes(child), 0);
      };
      const sidecarSnapshot = sidecar
        ? snapshotFromSidecar(sidecar, editor.getSnapshot().revision + 1)
        : undefined;
      // 旁路过旧/过稀时优先静态转换结果，避免画布被空树覆盖
      const useSidecar = Boolean(sidecarSnapshot && countNodes(sidecarSnapshot.root) >= countNodes(convertedSnapshot.root) + 5);
      const baseSnapshot = useSidecar ? sidecarSnapshot! : convertedSnapshot;
      snapshotSource = useSidecar ? "sidecar" : "conversion";
      const snapshot = editor.reset(baseSnapshot);
      // 打开界面时，若真机已是 live 活树，则优先用真机结构，保证「预览=运行」
      const fileStatus = findRuntimeFileStatus();
      const runtimeSnap = fileStatus?.snapshot as UiSnapshot | undefined;
      const runtimeText = runtimeSnap?.root ? JSON.stringify(runtimeSnap.root) : "";
      const runtimeLooksLive = Boolean(runtimeSnap?.root)
        && !/loadingScreen|bootProgress|正在加载|正在开辟|渡劫准备/i.test(runtimeText)
        && /Button|Label|hud|MainShell/i.test(runtimeText);
      if (runtimeSessionId && runtimeLooksLive && runtimeSnap?.root) {
        try {
          const next = editor.replaceFromRuntime({
            ...runtimeSnap,
            revision: snapshot.revision + 1
          });
          snapshotSource = "runtime";
          broadcast({ type: "ui.snapshot", snapshot: next, source: "runtime" });
          sendJson(response, 200, {
            path: activeUiEntry,
            snapshot: next,
            conversion,
            snapshotSource: "runtime" as SnapshotSource,
            note: "canvas_from_runtime",
            sidecar: project ? {
              path: sidecarRelativePath(body.path),
              exists: Boolean(sidecar),
              savedAt: sidecar?.savedAt,
              confidence: sidecar?.confidence
            } : undefined
          });
          return;
        } catch {
          // fall through to file-based snapshot
        }
      }
      broadcast({ type: "ui.snapshot", snapshot, source: snapshotSource });
      sendJson(response, 200, {
        path: activeUiEntry,
        snapshot,
        conversion,
        snapshotSource,
        note: runtimeSessionId && runtimeScene === "loading"
          ? "runtime_is_loading_screen"
          : runtimeSessionId
            ? "canvas_from_file_structure"
            : undefined,
        sidecar: project ? {
          path: sidecarRelativePath(body.path),
          exists: Boolean(sidecar),
          savedAt: sidecar?.savedAt,
          confidence: sidecar?.confidence
        } : undefined
      });
    } else if (request.method === "GET" && url.pathname === "/api/ui/sidecar") {
      if (!project) throw new Error("project_not_open");
      const sourceFile = url.searchParams.get("path") || activeUiEntry;
      const sidecar = readUiSidecar(project.root, sourceFile);
      sendJson(response, 200, {
        sourceFile,
        path: sidecarRelativePath(sourceFile),
        exists: Boolean(sidecar),
        sidecar: sidecar ?? null
      });
    } else if (request.method === "POST" && url.pathname === "/api/ui/sidecar") {
      if (!project) throw new Error("project_not_open");
      const body = await readJson(request, 5_500_000) as { path?: string; snapshot?: UiSnapshot };
      const sourceFile = body.path || activeUiEntry;
      if (!body.snapshot?.root) throw new Error("ui_sidecar_snapshot_required");
      const written = writeUiSidecar(project.root, sourceFile, body.snapshot);
      const makerMeta = readMakerProjectMeta(project.root);
      const panelState = resolvePreviewPanel(project.root, makerMeta);
      if (panelState.autoRefreshIframe) {
        const bumped = bumpPreviewReload(project.root, {}, makerMeta);
        broadcast({ type: "preview.panel", panel: bumped, reason: "sidecar-saved" });
      }
      let makerRefresh: { requested: boolean; error?: string } = { requested: false };
      if (panelState.autoRefreshMaker && makerRuntime) {
        try {
          await runMakerCommand(makerRuntime, project.root, "refresh", 45_000);
          makerRefresh = { requested: true };
          broadcast({ type: "log.append", channel: "runtime", lines: ["live-edit 已触发 Maker preview refresh"] });
        } catch (error) {
          makerRefresh = { requested: true, error: error instanceof Error ? error.message : String(error) };
          broadcast({ type: "log.append", channel: "runtime", lines: [`live-edit 自动刷新失败：${makerRefresh.error}`] });
        }
      }
      sendJson(response, 200, {
        ok: true,
        sourceFile,
        path: written.path,
        savedAt: written.document.savedAt,
        selectedId: written.document.selectedId,
        preview: {
          reloadToken: resolvePreviewPanel(project.root, makerMeta).reloadToken,
          autoRefreshIframe: panelState.autoRefreshIframe,
          autoRefreshMaker: panelState.autoRefreshMaker,
          makerRefresh
        }
      });
    } else if (request.method === "GET" && url.pathname === "/api/ui/source-locate") {
      if (!project) throw new Error("project_not_open");
      const file = url.searchParams.get("file") || activeUiEntry;
      const line = Number(url.searchParams.get("line") || 0);
      const snapshot = editor.getSnapshot();
      const node = line > 0 ? uiNodeAtLine(snapshot.root, line) : undefined;
      sendJson(response, 200, {
        file,
        line,
        nodeId: node?.id ?? null,
        nodeName: node?.name ?? null,
        path: node ? findUiNodePath(snapshot.root, node.id) : null
      });
    } else if (request.method === "GET" && url.pathname === "/api/ui/convert") {
      if (!project) throw new Error("project_not_open");
      const sourceFile = url.searchParams.get("path") || activeUiEntry;
      conversion = convertLuaUiFile(project.root, sourceFile);
      sendJson(response, 200, conversion);
    } else if (request.method === "POST" && url.pathname === "/api/ui/tree-op") {
      const body = await readJson(request) as { op?: UiTreeOp };
      if (!body.op) throw new Error("tree_op_required");
      const snapshot = editor.applyTreeOp(body.op);
      if (body.op.type === "toggle-visible") {
        enqueueRuntimeCommand({
          type: "ui.patch",
          patch: {
            requestId: crypto.randomUUID(),
            baseRevision: snapshot.revision - 1,
            nodeId: body.op.nodeId,
            props: { visible: findUiNode(snapshot.root, body.op.nodeId)?.props.visible },
            source: findUiNode(snapshot.root, body.op.nodeId)?.source
          }
        });
      } else if (body.op.type === "delete") {
        enqueueRuntimeCommand({
          type: "ui.tree",
          mutation: { action: "delete", nodeId: body.op.nodeId }
        });
      } else if (body.op.type === "rename") {
        enqueueRuntimeCommand({
          type: "ui.patch",
          patch: {
            requestId: crypto.randomUUID(),
            baseRevision: snapshot.revision - 1,
            nodeId: body.op.nodeId,
            props: { id: body.op.name },
            source: findUiNode(snapshot.root, body.op.nodeId)?.source
          }
        });
      } else if (body.op.type === "insert-child" || body.op.type === "insert-sibling" || body.op.type === "duplicate") {
        const node = snapshot.selectedId ? findUiNode(snapshot.root, snapshot.selectedId) : undefined;
        const parent = node ? findParentInfo(snapshot.root, node.id) : null;
        if (node && parent) {
          enqueueRuntimeCommand({
            type: "ui.tree",
            mutation: { action: "create", parentId: parent.parentId, index: parent.index, node }
          });
        }
      } else if (body.op.type === "move" || body.op.type === "relocate") {
        const parent = findParentInfo(snapshot.root, body.op.nodeId);
        if (parent) {
          enqueueRuntimeCommand({
            type: "ui.tree",
            mutation: { action: "move", nodeId: body.op.nodeId, parentId: parent.parentId, index: parent.index }
          });
        }
      }
      broadcast({ type: "ui.snapshot", snapshot });
      syncRuntimeFileChannel();
      sendJson(response, 200, snapshot);
    } else if (request.method === "POST" && url.pathname === "/api/ui/patch") {
      const requestedPatch = await readJson(request) as UiPatch;
      const current = editor.getSnapshot();
      // Runtime keeps publishing layout snapshots while the editor deliberately
      // freezes the visible frame for stable manipulation. Rebase a property
      // edit onto the newest live revision; node identity is the conflict unit,
      // so an unrelated runtime tick must not reject the user's drag or input.
      const patch = snapshotSource === "runtime" && requestedPatch.baseRevision !== current.revision
        ? { ...requestedPatch, baseRevision: current.revision }
        : requestedPatch;
      const snapshot = editor.apply(patch);
      const node = findUiNode(snapshot.root, patch.nodeId);
      enqueueRuntimeCommand({
        type: "ui.patch",
        patch: {
          ...patch,
          source: node?.source
        }
      });
      const event: BridgeEvent = { type: "ui.patch.applied", requestId: patch.requestId, snapshot };
      broadcast(event);
      // 立刻把命令写入文件通道，缩短真机反馈延迟
      syncRuntimeFileChannel();
      sendJson(response, 200, snapshot);
    } else if (request.method === "POST" && url.pathname === "/api/ui/undo") {
      const snapshot = editor.undo();
      enqueueRuntimeCommand({ type: "ui.replace", snapshot });
      broadcast({ type: "ui.snapshot", snapshot });
      syncRuntimeFileChannel();
      sendJson(response, 200, snapshot);
    } else if (request.method === "POST" && url.pathname === "/api/ui/redo") {
      const snapshot = editor.redo();
      enqueueRuntimeCommand({ type: "ui.replace", snapshot });
      broadcast({ type: "ui.snapshot", snapshot });
      syncRuntimeFileChannel();
      sendJson(response, 200, snapshot);
    } else if (request.method === "POST" && url.pathname === "/api/runtime/hello") {
      const body = await readJson(request) as { sessionId?: string; frames?: boolean };
      process.stderr.write(`[TapMakerWork] runtime hello session=${body.sessionId} host=${request.headers.host}\n`);
      runtimeSessionId = body.sessionId || crypto.randomUUID();
      runtimeConnectedAt = new Date().toISOString();
      capabilities.runtimeFrames = body.frames === true;
      sendJson(response, 200, { ok: true, protocolVersion: PROTOCOL_VERSION, sessionId: runtimeSessionId });
    } else if (request.method === "POST" && url.pathname === "/api/runtime/snapshot") {
      const body = await readJson(request, 10_485_760) as { snapshot?: import("@tapmakerwork/protocol").UiSnapshot };
      if (!body.snapshot) throw new Error("runtime_snapshot_required");
      runtimeConnectedAt = new Date().toISOString();
      const snapshot = editor.replaceFromRuntime(body.snapshot);
      broadcast({ type: "ui.snapshot", snapshot });
      sendJson(response, 200, { ok: true, revision: snapshot.revision });
    } else if (request.method === "GET" && url.pathname === "/api/runtime/commands") {
      syncRuntimeFileChannel();
      const cursor = Number(url.searchParams.get("cursor") || 0);
      const commands = runtimeCommands.filter((command) => command.id > cursor).slice(0, 100);
      sendJson(response, 200, { commands, cursor: commands.at(-1)?.id ?? cursor });
    } else if (request.method === "POST" && url.pathname === "/api/runtime/event") {
      const body = await readJson(request) as { channel?: import("@tapmakerwork/protocol").LogChannel; lines?: string[] };
      runtimeConnectedAt = new Date().toISOString();
      const channel = body.channel || "runtime";
      const lines = Array.isArray(body.lines) ? body.lines.map(String).slice(0, 500) : [];
      if (lines.length) broadcast({ type: "log.append", channel, lines });
      sendJson(response, 200, { ok: true });
    } else if (request.method === "GET" && url.pathname === "/api/maker/versions") {
      if (url.searchParams.get("refresh") === "1") makerRemoteVersions = await checkMakerRuntimeUpdates();
      sendJson(response, 200, makerVersionsPayload());
    } else if (request.method === "GET" && url.pathname === "/api/node/versions") {
      if (url.searchParams.get("refresh") === "1") nodeRemoteVersion = await checkNodeRuntimeUpdates();
      sendJson(response, 200, nodeVersionsPayload());
    } else if (request.method === "POST" && url.pathname === "/api/maker/version/select") {
      const body = await readJson(request) as { mode?: MakerRuntimeMode; version?: string };
      if (!body.mode || !["device", "stable", "beta", "version"].includes(body.mode)) throw new Error("invalid_maker_runtime_mode");
      const installed = listInstalledMakerRuntimes();
      if (body.mode === "version" && !installed.some((runtime) => runtime.version === body.version)) throw new Error("maker_version_not_installed");
      if (body.mode === "stable" && !installed.some((runtime) => !runtime.version.includes("-"))) throw new Error("maker_stable_not_installed");
      if (body.mode === "beta" && !installed.some((runtime) => runtime.version.includes("-"))) throw new Error("maker_beta_not_installed");
      writeMakerRuntimePreference({ mode: body.mode, version: body.mode === "version" ? body.version : undefined });
      refreshSelectedMakerRuntime();
      broadcast({ type: "log.append", channel: "agent", lines: [`Maker MCP 已切换为 ${body.mode === "device" ? "设备自动" : makerRuntime?.version ?? body.mode}`] });
      sendJson(response, 200, { ok: true, ...makerVersionsPayload() });
    } else if (request.method === "POST" && url.pathname === "/api/maker/version/install") {
      const body = await readJson(request) as { channel?: "stable" | "beta" };
      if (body.channel !== "stable" && body.channel !== "beta") throw new Error("invalid_maker_update_channel");
      makerRemoteVersions = await checkMakerRuntimeUpdates();
      const target = makerRemoteVersions[body.channel];
      if (!target) throw new Error(`maker_${body.channel}_version_unavailable`);
      broadcast({ type: "log.append", channel: "build", lines: [`正在安装 Maker MCP ${target}（${body.channel === "stable" ? "稳定版" : "Beta"}）…`] });
      const result = await installMakerRuntimeVersion(target);
      if (!listInstalledMakerRuntimes().some((runtime) => runtime.version === target)) throw new Error("maker_install_not_found_after_upgrade");
      writeMakerRuntimePreference({ mode: body.channel });
      refreshSelectedMakerRuntime();
      broadcast({ type: "log.append", channel: "build", lines: [`Maker MCP ${target} 安装完成，TapMakerWork 已切换。其他 AI 客户端可能需要重新连接 MCP。`] });
      sendJson(response, 200, { ok: true, result, ...makerVersionsPayload() });
    } else if (request.method === "POST" && url.pathname === "/api/node/version/sync") {
      refreshSelectedMakerRuntime();
      const node = discoverNodeRuntime();
      broadcast({ type: "log.append", channel: "build", lines: [`已重新同步系统 Node.js：${node.version}（${node.executable}）`] });
      sendJson(response, 200, { ok: true, ...nodeVersionsPayload(), maker: makerVersionsPayload() });
    } else if (request.method === "GET" && url.pathname === "/api/maker/project-meta") {
      if (!project) throw new Error("project_not_open");
      sendJson(response, 200, {
        project: { root: project.root, name: project.name },
        makerVersion: makerRuntime?.version,
        meta: readMakerProjectMeta(project.root)
      });
    } else if (request.method === "GET" && url.pathname === "/api/maker/doctor") {
      if (!project) throw new Error("project_not_open");
      if (!makerRuntime) throw new Error("maker_cli_not_found");
      broadcast({ type: "log.append", channel: "build", lines: ["Maker doctor…"] });
      try {
        const result = await runMakerDoctor(makerRuntime, project.root);
        broadcast({ type: "log.append", channel: "build", lines: [JSON.stringify(result).slice(0, 4000)] });
        sendJson(response, 200, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        broadcast({ type: "log.append", channel: "build", lines: [`doctor 失败：${message}`] });
        sendJson(response, 400, { error: message });
      }
    } else if (request.method === "POST" && url.pathname === "/api/maker/build") {
      if (!project) throw new Error("project_not_open");
      if (!makerRuntime) throw new Error("maker_cli_not_found");
      broadcast({ type: "log.append", channel: "build", lines: [`开始官方 Maker 构建（${makerRuntime.version}）…`, `项目：${project.root}`] });
      try {
        const result = await runMakerBuild(makerRuntime, project.root);
        // 按约定：构建成功后不自动打开预览网址，结果写入构建终端
        broadcast({ type: "log.append", channel: "build", lines: ["构建完成。可到 TapTap/Maker 后台查看预览。", JSON.stringify(result).slice(0, 4000)] });
        sendJson(response, 200, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        broadcast({ type: "log.append", channel: "build", lines: [`构建失败：${message}`] });
        sendJson(response, 400, { error: message });
      }
    } else if (request.method === "POST" && url.pathname === "/api/maker/qrcode") {
      if (!project) throw new Error("project_not_open");
      if (!makerRuntime) throw new Error("maker_cli_not_found");
      const body = await readJson(request) as { confirmedScreenOrientation?: "portrait" | "landscape" };
      const meta = readMakerProjectMeta(project.root);
      const orientation = body.confirmedScreenOrientation
        || (meta.orientation === "portrait" || meta.orientation === "landscape" ? meta.orientation : undefined);
      broadcast({ type: "log.append", channel: "qrcode", lines: [`生成测试二维码…${orientation ? ` orientation=${orientation}` : ""}`] });
      try {
        const result = await runMakerQrcode(makerRuntime, project.root, orientation);
        broadcast({ type: "log.append", channel: "qrcode", lines: [JSON.stringify(result).slice(0, 4000)] });
        sendJson(response, 200, { result, meta: readMakerProjectMeta(project.root) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        broadcast({ type: "log.append", channel: "qrcode", lines: [`二维码生成失败：${message}`] });
        sendJson(response, 400, { error: message, meta: readMakerProjectMeta(project.root) });
      }
    } else if (request.method === "GET" && url.pathname === "/api/maker/preview/status") {
      if (!project) throw new Error("project_not_open");
      if (!makerRuntime) throw new Error("maker_cli_not_found");
      sendJson(response, 200, await runMakerReadOnly(makerRuntime, project.root, "status"));
    } else if (request.method === "GET" && url.pathname === "/api/maker/preview/logs") {
      if (!project) throw new Error("project_not_open");
      if (!makerRuntime) throw new Error("maker_cli_not_found");
      let supervisorLogPath: string | undefined;
      try {
        const status = await runMakerReadOnly(makerRuntime, project.root, "status") as { supervisor_log_path?: string };
        supervisorLogPath = status?.supervisor_log_path;
      } catch {
        // status may fail when preview never started
      }
      const logs = readMakerPreviewLogs(project.root, supervisorLogPath);
      sendJson(response, 200, { ...logs, supervisorLogPath });
    } else if (request.method === "POST" && ["start", "stop", "refresh"].some((command) => url.pathname === `/api/maker/preview/${command}`)) {
      if (!project) throw new Error("project_not_open");
      if (!makerRuntime) throw new Error("maker_cli_not_found");
      const command = url.pathname.split("/").at(-1) as "start" | "stop" | "refresh";
      broadcast({ type: "log.append", channel: "runtime", lines: [`Maker preview ${command}…`] });
      const result = await runMakerCommand(makerRuntime, project.root, command);
      broadcast({ type: "log.append", channel: "runtime", lines: [`Maker preview ${command} 完成。`] });
      sendJson(response, 200, result);
    } else if (request.method === "GET" && url.pathname === "/api/preview/panel") {
      if (!project) throw new Error("project_not_open");
      sendJson(response, 200, {
        panel: resolvePreviewPanel(project.root, readMakerProjectMeta(project.root)),
        project: { root: project.root, name: project.name }
      });
    } else if (request.method === "POST" && url.pathname === "/api/preview/panel") {
      if (!project) throw new Error("project_not_open");
      const body = await readJson(request) as PreviewPanelFile;
      const panel = applyPreviewPanelPatch(project.root, body, readMakerProjectMeta(project.root));
      broadcast({ type: "preview.panel", panel, reason: "settings" });
      sendJson(response, 200, { panel });
    } else if (request.method === "POST" && url.pathname === "/api/preview/panel/refresh") {
      if (!project) throw new Error("project_not_open");
      const body = await readJson(request) as { maker?: boolean };
      const makerMeta = readMakerProjectMeta(project.root);
      const panel = bumpPreviewReload(project.root, {}, makerMeta);
      let makerRefresh: { requested: boolean; error?: string } = { requested: false };
      if (body.maker && makerRuntime) {
        try {
          await runMakerCommand(makerRuntime, project.root, "refresh", 45_000);
          makerRefresh = { requested: true };
          broadcast({ type: "log.append", channel: "runtime", lines: ["预览面板请求 Maker refresh 完成"] });
        } catch (error) {
          makerRefresh = { requested: true, error: error instanceof Error ? error.message : String(error) };
          broadcast({ type: "log.append", channel: "runtime", lines: [`预览面板 Maker refresh 失败：${makerRefresh.error}`] });
        }
      }
      broadcast({ type: "preview.panel", panel, reason: "refresh" });
      sendJson(response, 200, { panel, makerRefresh });
    } else if (request.method === "POST" && url.pathname === "/api/preview/panel/shot") {
      if (!project) throw new Error("project_not_open");
      const body = await readJson(request, 20_000_000) as { dataUrl?: string; note?: string };
      const ideRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
      if (!body.dataUrl) {
        sendJson(response, 200, {
          ok: false,
          error: "preview_shot_requires_desktop_capture",
          hint: "浏览器模式无法截取跨域 iframe；请使用 Electron 桌面端截取，或先打开外部预览。"
        });
        return;
      }
      const saved = savePreviewShot(ideRoot, project.name, body.dataUrl, body.note);
      const panel = applyPreviewPanelPatch(project.root, { lastShotPath: saved.path }, readMakerProjectMeta(project.root));
      broadcast({ type: "preview.panel", panel, reason: "shot" });
      sendJson(response, 200, { ok: true, ...saved, panel });
    } else if (request.method === "GET" && url.pathname === "/api/preview/panel/shots") {
      if (!project) throw new Error("project_not_open");
      const ideRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
      sendJson(response, 200, { shots: listPreviewShots(ideRoot, project.name) });
    } else if (request.method === "POST" && url.pathname === "/api/shell/execute") {
      sendJson(response, 423, { error: "sandbox_unavailable", detail: sandbox.reason });
    } else {
      sendJson(response, 404, { error: "not_found" });
    }
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

const sockets = new Set<WebSocket>();
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (request, socket, head) => {
  if (!validOrigin(request) || request.url !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
});

function broadcast(event: BridgeEvent): void {
  const payload = JSON.stringify(event);
  for (const socket of sockets) if (socket.readyState === WebSocket.OPEN) socket.send(payload);
}

wss.on("connection", (socket) => {
  sockets.add(socket);
  const hello: BridgeEvent = { type: "session.hello", protocolVersion: PROTOCOL_VERSION, capabilities };
  socket.send(JSON.stringify(hello));
  socket.send(JSON.stringify({ type: "ui.snapshot", snapshot: editor.getSnapshot() } satisfies BridgeEvent));
  socket.on("close", () => sockets.delete(socket));
});

server.listen(port, host, () => {
  process.stdout.write(`[TapMakerWork] Bridge listening on http://${host}:${port}\n`);
});

function shutdown(): void {
  for (const socket of sockets) socket.close();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
