import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_LINE_CHARS = 600;
const MAX_DESCRIPTION_CHARS = 4_000;

export interface LogRing {
  push(line: string): void;
  lines(): string[];
}

export function createLogRing(capacity: number, now: () => Date = () => new Date()): LogRing {
  const entries: string[] = [];
  return {
    push(line) {
      const trimmed = line.trimEnd();
      if (!trimmed) return;
      entries.push(`${now().toISOString()} ${trimmed.slice(0, MAX_LINE_CHARS)}`);
      if (entries.length > capacity) entries.splice(0, entries.length - capacity);
    },
    lines: () => [...entries]
  };
}

export function captureStreamLines(stream: NodeJS.WriteStream, ring: LogRing): void {
  const write = stream.write.bind(stream) as (...args: unknown[]) => boolean;
  stream.write = ((chunk: unknown, ...rest: unknown[]) => {
    const text = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : "";
    for (const line of text.split(/\r?\n/)) ring.push(line);
    return write(chunk, ...rest);
  }) as typeof stream.write;
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/(authorization:\s*bearer\s+)[^\s"']+/gi, "$1***"],
  [/((?:access_?token|refresh_?token|token|secret|password|api_?key|session_?key)["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi, "$1***"],
  [/([?&](?:token|key|sign|signature|code)=)[^&\s"']+/gi, "$1***"]
];

export function redactSensitive(text: string, homeDir = os.homedir()): string {
  let result = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) result = result.replace(pattern, replacement);
  if (homeDir.length > 1) {
    for (const variant of new Set([homeDir, homeDir.replace(/\\/g, "/")])) result = result.split(variant).join("~");
  }
  return result;
}

export interface FeedbackClientInfo {
  appVersion?: string | undefined;
  desktopVersion?: string | undefined;
  userAgent?: string | undefined;
  screen?: string | undefined;
}

export interface FeedbackProjectInfo {
  name: string;
  root: string;
  gameVersion?: string | undefined;
  title?: string | undefined;
  appId?: string | undefined;
  orientation?: string | undefined;
  uiBackend?: string | undefined;
}

export interface FeedbackPackInput {
  generatedAt: Date;
  description?: string | undefined;
  client: FeedbackClientInfo;
  environment: {
    platform: string;
    arch: string;
    osRelease: string;
    node: string;
    makerVersion?: string | undefined;
    protocolVersion: number;
  };
  project?: FeedbackProjectInfo | undefined;
  runtimeSession?: string | undefined;
  runtimeError?: string | undefined;
  recentErrors: string[];
  runtimeLogs: string[];
  bridgeLogs: string[];
  studioLogs: Record<string, string[]>;
}

function codeBlock(lines: string[], empty: string): string {
  const body = lines.length ? lines.map((line) => line.slice(0, MAX_LINE_CHARS)).join("\n") : empty;
  return ["```text", body.replace(/```/g, "ˋˋˋ"), "```"].join("\n");
}

function field(label: string, value: string | number | undefined): string {
  return `- ${label}：${value === undefined || value === "" ? "未知" : value}`;
}

export function buildFeedbackMarkdown(input: FeedbackPackInput, homeDir = os.homedir()): string {
  const { client, environment, project } = input;
  const description = input.description?.trim().slice(0, MAX_DESCRIPTION_CHARS);
  const sections = [
    `# TapMakerWork 问题反馈`,
    "",
    `生成时间：${input.generatedAt.toISOString()}`,
    "",
    "## 问题描述",
    "",
    description || "（请补充：做了什么操作、期望的结果、实际看到的结果）",
    "",
    "## 复现步骤",
    "",
    "1. ",
    "2. ",
    "3. ",
    "",
    "## 环境",
    "",
    field("TapMakerWork", client.appVersion),
    field("桌面端", client.desktopVersion),
    field("系统", `${environment.platform} ${environment.arch} ${environment.osRelease}`),
    field("Node", environment.node),
    field("Maker CLI", environment.makerVersion),
    field("Bridge 协议", environment.protocolVersion),
    field("屏幕", client.screen),
    field("浏览器内核", client.userAgent),
    "",
    "## 项目",
    "",
    ...(project
      ? [
        field("名称", project.title || project.name),
        field("目录", project.root),
        field("游戏版本", project.gameVersion),
        field("App ID", project.appId),
        field("屏幕方向", project.orientation),
        field("UI 后端", project.uiBackend),
        field("Runtime 会话", input.runtimeSession)
      ]
      : ["- 未打开项目"]),
    "",
    "## 运行时错误",
    "",
    codeBlock(input.runtimeError ? input.runtimeError.split(/\r?\n/) : [], "无"),
    "",
    "## 最近错误",
    "",
    codeBlock(input.recentErrors, "无"),
    "",
    "## Runtime 日志",
    "",
    codeBlock(input.runtimeLogs, "没有可读的 Runtime 日志"),
    "",
    "## Bridge 日志",
    "",
    codeBlock(input.bridgeLogs, "无"),
    ...Object.entries(input.studioLogs)
      .filter(([, lines]) => lines.length > 0)
      .flatMap(([channel, lines]) => ["", `## Studio 终端：${channel}`, "", codeBlock(lines, "无")]),
    ""
  ];
  return redactSensitive(sections.join("\n"), homeDir);
}

export function readProjectGameVersion(projectRoot: string): string | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(projectRoot, ".project", "project.json"), "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" || typeof parsed.version === "number" ? String(parsed.version) : undefined;
  } catch {
    return undefined;
  }
}

export function feedbackFileName(generatedAt: Date): string {
  const stamp = generatedAt.toISOString().replace(/\.\d+Z$/, "").replace(/[-:]/g, "").replace("T", "-");
  return `tapmakerwork-feedback-${stamp}.md`;
}

export function defaultFeedbackDir(): string {
  const outputs = process.env.TAPMAKERWORK_OUTPUTS_DIR;
  return outputs ? path.join(outputs, "feedback") : path.join(os.homedir(), ".tapmakerwork", "feedback");
}

export function saveFeedbackPack(directory: string, fileName: string, markdown: string): string {
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, fileName);
  fs.writeFileSync(target, markdown, "utf8");
  return target;
}
