import http, { type IncomingMessage, type ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  type BridgeCapabilities,
  type BridgeEvent,
  type RuntimeCommand,
  type UiPatch
} from "@tapmakerwork/protocol";
import { discoverMakerRuntime, runMakerCommand, runMakerReadOnly } from "./maker.js";
import { listProjectEntries, readProjectText, resolveProjectRoot, type ProjectBinding } from "./project.js";
import { sandboxStatus } from "./sandbox.js";
import { EditorState } from "./state.js";
import { convertLuaUiFile, snapshotFromConversion } from "./lua-converter.js";

const host = "127.0.0.1";
const port = Number(process.env.TAPMAKERWORK_BRIDGE_PORT || 43121);
const makerRuntime = discoverMakerRuntime();
const sandbox = sandboxStatus();
let project: ProjectBinding | undefined;

if (process.env.TAPMAKERWORK_PROJECT) {
  try {
    project = resolveProjectRoot(process.env.TAPMAKERWORK_PROJECT);
  } catch (error) {
    process.stderr.write(`[TapMakerWork] Project binding failed: ${String(error)}\n`);
  }
}

const uiEntry = process.env.TAPMAKERWORK_UI_ENTRY || "scripts/ui/HomePage.lua";
let conversion = project && fs.existsSync(path.join(project.root, uiEntry))
  ? convertLuaUiFile(project.root, uiEntry)
  : undefined;
const editor = new EditorState(conversion ? snapshotFromConversion(conversion) : undefined);
const runtimeCommands: RuntimeCommand[] = [];
let nextRuntimeCommandId = 1;
let runtimeConnectedAt: string | undefined;
let runtimeSessionId: string | undefined;

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

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "http://127.0.0.1:4173"
  });
  response.end(JSON.stringify(body));
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
      sendJson(response, 403, { error: "invalid_origin" });
      return;
    }
    const url = new URL(request.url || "/", `http://${host}:${port}`);
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-origin": "http://127.0.0.1:4173",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type"
      });
      response.end();
    } else if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true, capabilities, makerVersion: makerRuntime?.version, sandbox, runtimeSessionId, runtimeConnectedAt });
    } else if (request.method === "GET" && url.pathname === "/api/project") {
      sendJson(response, 200, { project });
    } else if (request.method === "POST" && url.pathname === "/api/project/open") {
      const body = await readJson(request) as { path?: string };
      project = resolveProjectRoot(body.path || "");
      sendJson(response, 200, { project });
    } else if (request.method === "GET" && url.pathname === "/api/project/files") {
      if (!project) throw new Error("project_not_open");
      sendJson(response, 200, { entries: listProjectEntries(project.root, url.searchParams.get("path") || ".") });
    } else if (request.method === "GET" && url.pathname === "/api/project/file") {
      if (!project) throw new Error("project_not_open");
      const sourceFile = url.searchParams.get("path");
      if (!sourceFile) throw new Error("project_file_path_required");
      sendJson(response, 200, { path: sourceFile, text: readProjectText(project.root, sourceFile), readOnly: true });
    } else if (request.method === "GET" && url.pathname === "/api/ui/snapshot") {
      sendJson(response, 200, editor.getSnapshot());
    } else if (request.method === "GET" && url.pathname === "/api/ui/convert") {
      if (!project) throw new Error("project_not_open");
      const sourceFile = url.searchParams.get("path") || uiEntry;
      conversion = convertLuaUiFile(project.root, sourceFile);
      sendJson(response, 200, conversion);
    } else if (request.method === "POST" && url.pathname === "/api/ui/patch") {
      const patch = await readJson(request) as UiPatch;
      const snapshot = editor.apply(patch);
      enqueueRuntimeCommand({ type: "ui.patch", patch });
      const event: BridgeEvent = { type: "ui.patch.applied", requestId: patch.requestId, snapshot };
      broadcast(event);
      sendJson(response, 200, snapshot);
    } else if (request.method === "POST" && url.pathname === "/api/ui/undo") {
      const snapshot = editor.undo();
      enqueueRuntimeCommand({ type: "ui.replace", snapshot });
      broadcast({ type: "ui.snapshot", snapshot });
      sendJson(response, 200, snapshot);
    } else if (request.method === "POST" && url.pathname === "/api/ui/redo") {
      const snapshot = editor.redo();
      enqueueRuntimeCommand({ type: "ui.replace", snapshot });
      broadcast({ type: "ui.snapshot", snapshot });
      sendJson(response, 200, snapshot);
    } else if (request.method === "POST" && url.pathname === "/api/runtime/hello") {
      const body = await readJson(request) as { sessionId?: string; frames?: boolean };
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
    } else if (request.method === "GET" && url.pathname === "/api/maker/preview/status") {
      if (!project) throw new Error("project_not_open");
      if (!makerRuntime) throw new Error("maker_cli_not_found");
      sendJson(response, 200, await runMakerReadOnly(makerRuntime, project.root, "status"));
    } else if (request.method === "GET" && url.pathname === "/api/maker/preview/logs") {
      if (!project) throw new Error("project_not_open");
      if (!makerRuntime) throw new Error("maker_cli_not_found");
      sendJson(response, 200, await runMakerReadOnly(makerRuntime, project.root, "logs"));
    } else if (request.method === "POST" && ["start", "stop", "refresh"].some((command) => url.pathname === `/api/maker/preview/${command}`)) {
      if (!project) throw new Error("project_not_open");
      if (!makerRuntime) throw new Error("maker_cli_not_found");
      const command = url.pathname.split("/").at(-1) as "start" | "stop" | "refresh";
      broadcast({ type: "log.append", channel: "runtime", lines: [`Maker preview ${command}…`] });
      const result = await runMakerCommand(makerRuntime, project.root, command);
      broadcast({ type: "log.append", channel: "runtime", lines: [`Maker preview ${command} 完成。`] });
      sendJson(response, 200, result);
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
