import fs from "node:fs";
import path from "node:path";
import type { LogChannel, UiSnapshot, UiValue } from "@tapmakerwork/protocol";
import { resolveInsideProject } from "./project.js";

export const AGENT_AI_RELATIVE_DIR = ".tapmakerwork/ai";
const AGENTS_MARKER_BEGIN = "<!-- tapmakerwork-ai-begin -->";
const AGENTS_MARKER_END = "<!-- tapmakerwork-ai-end -->";
const MAX_ERRORS = 40;

export const AGENT_FILE_ACTIONS = [
  "publish_now",
  "ui_apply_patch",
  "ui_undo",
  "ui_redo",
  "maker_preview_start",
  "maker_preview_stop",
  "maker_preview_refresh",
  "maker_preview_status",
  "maker_preview_logs",
  "maker_build",
  "maker_doctor",
  "maker_qrcode",
  "maker_console_open",
  "save_ui_sidecar",
  "sync_runtime",
  "open_ui",
  "open_terminal",
  "focus_ide",
  "capture_frame",
  "project_search",
  "read_project_file",
  "convert_lua_ui",
  "workflow_set_objective",
  "git_status"
] as const;

export type AgentFileAction = (typeof AGENT_FILE_ACTIONS)[number];

export interface AgentFileRequest {
  id: string;
  action: AgentFileAction;
  nodeId?: string;
  props?: Record<string, UiValue>;
  path?: string;
  query?: string;
  limit?: number;
  channel?: LogChannel;
  objective?: string;
  orientation?: "portrait" | "landscape";
  createdAt?: string;
}

export interface AgentFileResponse {
  id: string;
  ok: boolean;
  action: string;
  error?: string;
  result?: unknown;
  finishedAt: string;
}

export interface AgentErrorEntry {
  at: string;
  channel: string;
  message: string;
}

export interface AgentRuntimeStatusFile {
  updatedAt: string;
  alive: boolean;
  bridgeUrl: string;
  httpApi: string;
  projectRoot: string;
  projectName: string;
  activeUiEntry?: string;
  runtimeSessionId?: string;
  runtimeScene: "idle" | "loading" | "live";
  snapshotSource: string;
  snapshotRevision: number;
  previewPng: boolean;
  errorCount: number;
  note: string;
}

export interface PublishAgentContextInput {
  projectRoot: string;
  projectName: string;
  bridgeUrl: string;
  snapshot: UiSnapshot;
  snapshotSource: string;
  runtimeSessionId?: string | undefined;
  runtimeScene: "idle" | "loading" | "live";
  alive?: boolean;
  activeUiEntry?: string | undefined;
  errors?: AgentErrorEntry[];
  recentLogs?: Partial<Record<LogChannel, string[]>>;
}

function aiDir(projectRoot: string): string {
  return resolveInsideProject(projectRoot, AGENT_AI_RELATIVE_DIR);
}

function writeJson(filename: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function agentPreviewPngPath(projectRoot: string): string {
  return path.join(aiDir(projectRoot), "preview.png");
}

export function previewPngExists(projectRoot: string): boolean {
  try {
    return fs.existsSync(agentPreviewPngPath(projectRoot));
  } catch {
    return false;
  }
}

/** Accept data URL or raw base64 PNG/JPEG and write `.tapmakerwork/ai/preview.png`. */
export function writeAgentPreviewFrame(projectRoot: string, dataUrlOrBase64: string): { bytes: number; path: string } {
  const raw = dataUrlOrBase64.trim();
  const match = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(raw);
  const base64 = match?.[2] || raw.replace(/\s+/g, "");
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length < 32) throw new Error("preview_frame_too_small");
  const filename = agentPreviewPngPath(projectRoot);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, buffer);
  return { bytes: buffer.length, path: path.relative(projectRoot, filename).replaceAll("\\", "/") };
}

export function renderStatusMarkdown(input: PublishAgentContextInput & { previewPng: boolean; errorCount: number }): string {
  const alive = input.alive !== false;
  return `# TapMakerWork STATUS

更新于 ${new Date().toISOString()}
状态：${alive ? "在线" : "离线"}

| 项 | 值 |
|----|----|
| 项目 | ${input.projectName} |
| Bridge / HTTP | \`${input.bridgeUrl}\` |
| Runtime | \`${input.runtimeScene}\` |
| Snapshot | \`${input.snapshotSource}\` rev ${input.snapshot.revision} |
| 当前 UI | \`${input.activeUiEntry || "-"}\` |
| 截图 | ${input.previewPng ? "\`.tapmakerwork/ai/preview.png\`" : "暂无（需 Runtime 可见）"} |
| 错误条数 | ${input.errorCount} |

## Agent 硬约定（改完必须再读）

1. 每次改动后重新读：\`STATUS.md\`、\`ui-snapshot.json\`、\`errors.json\`（有 \`preview.png\` 时一并看）。
2. 写命令到 \`inbox/<id>.json\`，等 \`outbox/<id>.json\`，再读快照。
3. 也可用 HTTP：\`GET ${input.bridgeUrl}/api/agent/status\`、\`POST ${input.bridgeUrl}/api/agent/command\`。

详见 \`CONTEXT.md\`。
`;
}

export function renderAgentContextMarkdown(input: PublishAgentContextInput & { previewPng: boolean }): string {
  const status = input.alive === false ? "离线（TapMakerWork 未打开或已关闭项目）" : "在线";
  const actions = AGENT_FILE_ACTIONS.join("、");
  return `# TapMakerWork AI 上下文（文件通道 + HTTP）

创建于 ${new Date().toISOString()}
状态：**${status}**

## 给所有 AI（Cursor / Trae / WorkBuddy / Codex / Claude…）

1. 打开**本 Maker 游戏项目目录**，并保持 TapMakerWork 绑定本项目。
2. **先读** \`.tapmakerwork/ai/STATUS.md\`，再读 snapshot / errors / preview。
3. **改完必再读** STATUS + ui-snapshot + errors（闭环，类似控本地软件）。
4. 控制方式二选一：
   - 文件：\`inbox/<id>.json\` → \`outbox/<id>.json\`
   - HTTP：\`POST ${input.bridgeUrl}/api/agent/command\`（body 同 inbox JSON）

## 当前项目

- 名称：${input.projectName}
- 路径：\`${input.projectRoot}\`
- Bridge：\`${input.bridgeUrl}\`
- Runtime：\`${input.runtimeScene}\` · Snapshot：\`${input.snapshotSource}\` · rev \`${input.snapshot.revision}\`
- 当前 UI：\`${input.activeUiEntry || "-"}\`
- 截图：${input.previewPng ? "有 \`.tapmakerwork/ai/preview.png\`" : "暂无"}
${input.runtimeSessionId ? `- Runtime session：\`${input.runtimeSessionId}\`` : ""}

## 文件一览

| 文件 | 用途 |
|------|------|
| STATUS.md | 短状态 + 硬约定 |
| CONTEXT.md | 本说明 |
| ui-snapshot.json | UI 活树 |
| runtime-status.json | 机器可读状态 |
| errors.json | 最近失败 |
| logs-summary.json | 各通道最近日志 |
| preview.png | Runtime 画面（多模态） |
| inbox/ / outbox/ | 命令与结果 |

## inbox / HTTP command 示例

\`\`\`json
{
  "id": "patch-1",
  "action": "ui_apply_patch",
  "nodeId": "<节点 id>",
  "props": { "text": "新文案" }
}
\`\`\`

支持的 action：${actions}。

HTTP 速查：

- \`GET ${input.bridgeUrl}/api/agent/status\`
- \`GET ${input.bridgeUrl}/api/agent/snapshot\`
- \`GET ${input.bridgeUrl}/api/agent/errors\`
- \`POST ${input.bridgeUrl}/api/agent/command\`
- \`POST ${input.bridgeUrl}/api/agent/frame\`（body: \`{ "dataUrl": "data:image/png;base64,..." }\`）
`;
}

export function upsertAgentsMdPointer(projectRoot: string): void {
  const agentsPath = path.join(projectRoot, "AGENTS.md");
  if (!fs.existsSync(agentsPath)) return;
  let text: string;
  try {
    text = fs.readFileSync(agentsPath, "utf8");
  } catch {
    return;
  }
  const block = [
    AGENTS_MARKER_BEGIN,
    "",
    "## TapMakerWork 实时调试（文件通道 + HTTP）",
    "",
    "当本机 TapMakerWork 打开本项目时：",
    "",
    "1. 先读 `.tapmakerwork/ai/STATUS.md`、`ui-snapshot.json`、`errors.json`；有 `preview.png` 时查看画面。",
    "2. 用 `.tapmakerwork/ai/inbox/*.json` 或 `POST http://127.0.0.1:43121/api/agent/command` 控制 IDE/运行时。",
    "3. **每次改动后必须再读** STATUS / snapshot / errors，再决定下一步（闭环调试）。",
    "",
    AGENTS_MARKER_END,
    ""
  ].join("\n");
  if (text.includes(AGENTS_MARKER_BEGIN) && text.includes(AGENTS_MARKER_END)) {
    const next = text.replace(
      new RegExp(`${AGENTS_MARKER_BEGIN}[\\s\\S]*?${AGENTS_MARKER_END}\\n?`),
      block
    );
    if (next !== text) fs.writeFileSync(agentsPath, next, "utf8");
    return;
  }
  const spacer = text.endsWith("\n") ? "\n" : "\n\n";
  fs.writeFileSync(agentsPath, `${text}${spacer}${block}`, "utf8");
}

export function publishAgentContext(input: PublishAgentContextInput): void {
  const root = aiDir(input.projectRoot);
  fs.mkdirSync(path.join(root, "inbox"), { recursive: true });
  fs.mkdirSync(path.join(root, "outbox"), { recursive: true });
  const alive = input.alive !== false;
  const errors = (input.errors || []).slice(-MAX_ERRORS);
  const hasPreview = previewPngExists(input.projectRoot);
  const status: AgentRuntimeStatusFile = {
    updatedAt: new Date().toISOString(),
    alive,
    bridgeUrl: input.bridgeUrl,
    httpApi: `${input.bridgeUrl}/api/agent`,
    projectRoot: input.projectRoot,
    projectName: input.projectName,
    ...(input.activeUiEntry ? { activeUiEntry: input.activeUiEntry } : {}),
    ...(input.runtimeSessionId ? { runtimeSessionId: input.runtimeSessionId } : {}),
    runtimeScene: input.runtimeScene,
    snapshotSource: input.snapshotSource,
    snapshotRevision: input.snapshot.revision,
    previewPng: hasPreview,
    errorCount: errors.length,
    note: alive
      ? "After every change, re-read STATUS.md + ui-snapshot.json + errors.json."
      : "TapMakerWork is offline for this project; snapshot may be stale."
  };
  writeJson(path.join(root, "runtime-status.json"), status);
  writeJson(path.join(root, "ui-snapshot.json"), input.snapshot);
  writeJson(path.join(root, "errors.json"), { updatedAt: status.updatedAt, errors });
  writeJson(path.join(root, "logs-summary.json"), {
    updatedAt: status.updatedAt,
    channels: input.recentLogs || {}
  });
  const publishInput = { ...input, previewPng: hasPreview, errorCount: errors.length };
  fs.writeFileSync(path.join(root, "STATUS.md"), `${renderStatusMarkdown(publishInput)}\n`, "utf8");
  fs.writeFileSync(path.join(root, "CONTEXT.md"), `${renderAgentContextMarkdown(publishInput)}\n`, "utf8");
  try {
    upsertAgentsMdPointer(input.projectRoot);
  } catch {
    // ignore
  }
}

export function markAgentContextOffline(projectRoot: string, projectName: string, bridgeUrl: string): void {
  const root = aiDir(projectRoot);
  if (!fs.existsSync(root)) return;
  const empty: UiSnapshot = {
    revision: 0,
    root: { id: "offline", type: "Panel", name: "offline", props: {}, children: [] }
  };
  publishAgentContext({
    projectRoot,
    projectName,
    bridgeUrl,
    snapshot: empty,
    snapshotSource: "empty",
    runtimeScene: "idle",
    alive: false,
    errors: []
  });
}

export function looksLikeFailureLine(line: string): boolean {
  return /失败|error|exception|unreachable|崩溃|FAIL\b|Error:/i.test(line);
}

export function pushAgentError(
  errors: AgentErrorEntry[],
  channel: string,
  message: string,
  at = new Date().toISOString()
): AgentErrorEntry[] {
  const next = [...errors, { at, channel, message: message.slice(0, 500) }];
  return next.length > MAX_ERRORS ? next.slice(-MAX_ERRORS) : next;
}

function isLogChannel(value: unknown): value is LogChannel {
  return value === "runtime"
    || value === "build"
    || value === "lua"
    || value === "shell"
    || value === "repl"
    || value === "qrcode"
    || value === "agent";
}

function isAgentAction(value: unknown): value is AgentFileAction {
  return typeof value === "string" && (AGENT_FILE_ACTIONS as readonly string[]).includes(value);
}

export function parseAgentFileRequest(raw: unknown): AgentFileRequest | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id.trim()) return undefined;
  if (!isAgentAction(row.action)) return undefined;
  const request: AgentFileRequest = {
    id: row.id.trim(),
    action: row.action
  };
  if (typeof row.nodeId === "string") request.nodeId = row.nodeId;
  if (row.props && typeof row.props === "object") request.props = row.props as Record<string, UiValue>;
  if (typeof row.path === "string") request.path = row.path;
  if (typeof row.query === "string") request.query = row.query;
  if (typeof row.limit === "number" && Number.isFinite(row.limit)) request.limit = row.limit;
  if (isLogChannel(row.channel)) request.channel = row.channel;
  if (typeof row.objective === "string") request.objective = row.objective;
  if (row.orientation === "portrait" || row.orientation === "landscape") request.orientation = row.orientation;
  if (typeof row.createdAt === "string") request.createdAt = row.createdAt;
  return request;
}

export function listAgentInboxRequests(projectRoot: string): Array<{ file: string; request: AgentFileRequest }> {
  const inbox = path.join(aiDir(projectRoot), "inbox");
  if (!fs.existsSync(inbox)) return [];
  const files = fs.readdirSync(inbox).filter((name) => name.endsWith(".json")).sort();
  const out: Array<{ file: string; request: AgentFileRequest }> = [];
  for (const name of files) {
    const file = path.join(inbox, name);
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
      const request = parseAgentFileRequest(parsed);
      if (request) out.push({ file, request });
    } catch {
      // skip malformed
    }
  }
  return out;
}

export function writeAgentOutbox(projectRoot: string, response: AgentFileResponse, inboxFile?: string): void {
  const outbox = path.join(aiDir(projectRoot), "outbox", `${response.id}.json`);
  writeJson(outbox, response);
  if (inboxFile && fs.existsSync(inboxFile)) {
    try {
      fs.unlinkSync(inboxFile);
    } catch {
      // ignore
    }
  }
}

export function readAgentErrorsFile(projectRoot: string): AgentErrorEntry[] {
  try {
    const file = path.join(aiDir(projectRoot), "errors.json");
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { errors?: AgentErrorEntry[] };
    return Array.isArray(parsed.errors) ? parsed.errors : [];
  } catch {
    return [];
  }
}
