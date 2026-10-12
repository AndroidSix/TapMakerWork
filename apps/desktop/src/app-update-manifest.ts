import { isVersionNewer, normalizeReleaseVersion } from "./release-update.js";

export interface AppUpdateDownloads {
  macArm64?: string;
  macX64?: string;
  windowsX64?: string;
  page?: string;
  site?: string;
  githubPage?: string;
}

export interface AppUpdateLink {
  label: string;
  url: string;
}

export interface AppUpdateManifest {
  latest: string;
  title: string;
  notes: string[];
  links: AppUpdateLink[];
  publishedAt?: string;
  force: boolean;
  downloads: AppUpdateDownloads;
  source: "gitee" | "github" | "builtin";
}

export const BUILTIN_UPDATE_MANIFEST: Omit<AppUpdateManifest, "source"> = {
  latest: "0.1.6",
  title: "TapMakerWork 0.1.6",
  notes: [
    "【Windows 升级 MCP】修复 Windows 上切换/升级 Maker MCP 版本失败；切换账号后不再「丢失」已安装的 MCP 版本。",
    "【实时编辑桥注入】支持任意 TimeStep 变量名；保留入口文件 BOM 与 CRLF，修复 Windows 编辑器保存的 main.lua 注入后报 Lua 语法错误。",
    "【失败原因可见】注入失败、Runtime 自动重启失败会弹出中文原因并写入 Runtime 日志。",
    "【Git 忽略】打开项目时自动把 .tapmakerwork/ 写入项目 .gitignore。",
    "【防丢改动】保存时检测外部修改并提示，切换文件前确认未保存内容；非 UTF-8 文件只读打开，避免中文乱码；视觉改动写回 Lua 更安全。",
    "【多项目 Runtime】多个项目可同时运行各自的 Runtime，切换项目不再停止预览；项目标签绿点表示运行中。",
    "【Node.js 升级】设置页支持一键升级 Node.js；无法自动升级时提供可一键复制的升级命令。",
    "【新游雷达】每日上线新增「今日」「近3天」快捷范围。"
  ],
  links: [
    {
      label: "完整更新日志",
      url: "https://github.com/AndroidSix/TapMakerWork/blob/main/docs/CHANGELOG.md#release-0.1.6"
    },
    {
      label: "macOS 安装说明",
      url: "https://github.com/AndroidSix/TapMakerWork/blob/main/README.md#macos-install"
    },
    {
      label: "源码打包详细步骤",
      url: "https://github.com/AndroidSix/TapMakerWork/blob/main/docs/DESKTOP_RELEASE.md#macos-build-from-source"
    }
  ],
  publishedAt: "2026-10-12",
  force: false,
  downloads: {
    windowsX64: "https://github.com/AndroidSix/TapMakerWork/releases/download/v0.1.6/TapMakerWork-0.1.6-windows-x64.exe",
    page: "https://github.com/AndroidSix/TapMakerWork/releases/tag/v0.1.6",
    site: "https://androidsix.github.io/tapmakerwork-site/",
    githubPage: "https://github.com/AndroidSix/TapMakerWork/releases/tag/v0.1.6"
  }
};

const GITEE_URL = "https://gitee.com/AndroidSUP/tap-maker-work/raw/main/version.json";
const GITHUB_URL = "https://raw.githubusercontent.com/AndroidSix/TapMakerWork/main/version.json";
const CACHE_TTL_MS = 15 * 60 * 1000;
const SNOOZE_MS = 24 * 60 * 60 * 1000;

let cached: { value: AppUpdateManifest; fetchedAt: number } | undefined;

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNotes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 20);
}

function asLinks(value: unknown): AppUpdateLink[] {
  if (!Array.isArray(value)) return [];
  const links: AppUpdateLink[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const label = asNonEmptyString(row.label);
    const url = asNonEmptyString(row.url);
    if (!label || !url || !/^https?:\/\//i.test(url)) continue;
    links.push({ label, url });
    if (links.length >= 8) break;
  }
  return links;
}

export function normalizeUpdateManifest(raw: unknown, source: AppUpdateManifest["source"]): AppUpdateManifest | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const data = raw as Record<string, unknown>;
  const latest = normalizeReleaseVersion(asNonEmptyString(data.latest) || "");
  if (!latest) return undefined;
  const downloadsRaw = data.downloads && typeof data.downloads === "object"
    ? data.downloads as Record<string, unknown>
    : {};
  const downloads: AppUpdateDownloads = {};
  const macArm64 = asNonEmptyString(downloadsRaw.macArm64);
  const macX64 = asNonEmptyString(downloadsRaw.macX64);
  const windowsX64 = asNonEmptyString(downloadsRaw.windowsX64);
  const page = asNonEmptyString(downloadsRaw.page);
  const site = asNonEmptyString(downloadsRaw.site);
  const githubPage = asNonEmptyString(downloadsRaw.githubPage);
  if (macArm64) downloads.macArm64 = macArm64;
  if (macX64) downloads.macX64 = macX64;
  if (windowsX64) downloads.windowsX64 = windowsX64;
  if (page) downloads.page = page;
  if (site) downloads.site = site;
  if (githubPage) downloads.githubPage = githubPage;
  const title = asNonEmptyString(data.title) || `TapMakerWork ${latest}`;
  const notes = asNotes(data.notes);
  const links = asLinks(data.links);
  const publishedAt = asNonEmptyString(data.publishedAt);
  return {
    latest,
    title,
    notes: notes.length > 0 ? notes : [`发现新版本 ${latest}，请下载对应平台安装包。`],
    links,
    ...(publishedAt ? { publishedAt } : {}),
    force: data.force === true,
    downloads,
    source
  };
}

async function fetchManifest(url: string, source: AppUpdateManifest["source"]): Promise<AppUpdateManifest | undefined> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "TapMakerWork/desktop" },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) return undefined;
  return normalizeUpdateManifest(JSON.parse(await response.text()), source);
}

export async function loadAppUpdateManifest(force = false): Promise<AppUpdateManifest> {
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.value;
  try {
    const fromGitee = await fetchManifest(GITEE_URL, "gitee");
    if (fromGitee) {
      cached = { value: fromGitee, fetchedAt: Date.now() };
      return fromGitee;
    }
  } catch {
    // fall through
  }
  try {
    const fromGithub = await fetchManifest(GITHUB_URL, "github");
    if (fromGithub) {
      cached = { value: fromGithub, fetchedAt: Date.now() };
      return fromGithub;
    }
  } catch {
    // fall through
  }
  const builtin: AppUpdateManifest = { ...BUILTIN_UPDATE_MANIFEST, source: "builtin" };
  cached = { value: builtin, fetchedAt: Date.now() };
  return builtin;
}

export function pickPlatformDownloadUrl(
  downloads: AppUpdateDownloads,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): string | undefined {
  if (platform === "darwin") {
    if (arch === "arm64" && downloads.macArm64) return downloads.macArm64;
    if (downloads.macX64) return downloads.macX64;
    if (downloads.macArm64) return downloads.macArm64;
  }
  if (platform === "win32" && downloads.windowsX64) return downloads.windowsX64;
  return downloads.page || downloads.site || downloads.githubPage;
}

export function shouldPromptUpdate(options: {
  currentVersion: string;
  latestVersion: string;
  force?: boolean;
  mutedVersion?: string;
  snoozeUntil?: number;
  now?: number;
}): boolean {
  if (!isVersionNewer(options.latestVersion, options.currentVersion)) return false;
  if (options.force) return true;
  if (options.mutedVersion && normalizeReleaseVersion(options.mutedVersion) === normalizeReleaseVersion(options.latestVersion)) {
    return false;
  }
  const now = options.now ?? Date.now();
  if (typeof options.snoozeUntil === "number" && options.snoozeUntil > now) return false;
  return true;
}

export function nextSnoozeUntil(now = Date.now()): number {
  return now + SNOOZE_MS;
}

export type UpdateReminder = "show" | "snoozed" | "muted" | "hidden";

export function resolveUpdateReminder(options: {
  currentVersion: string;
  latestVersion: string;
  force?: boolean;
  mutedVersion?: string;
  snoozeUntil?: number;
  now?: number;
}): UpdateReminder {
  if (!isVersionNewer(options.latestVersion, options.currentVersion)) return "hidden";
  if (options.force) return "show";
  if (options.mutedVersion && normalizeReleaseVersion(options.mutedVersion) === normalizeReleaseVersion(options.latestVersion)) {
    return "muted";
  }
  const now = options.now ?? Date.now();
  if (typeof options.snoozeUntil === "number" && options.snoozeUntil > now) return "snoozed";
  return "show";
}
