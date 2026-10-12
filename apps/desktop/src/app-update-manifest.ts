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
  latest: "0.1.7",
  title: "TapMakerWork 0.1.7",
  notes: [
    "【Lua 智能编辑】Lua 语法错误实时标红；补全项目与 urhox-libs 符号，悬停查看文档；编辑器补齐查找、折叠等功能。",
    "【资源体检】包体报告（按类型占比、最大文件、可压缩候选）；未引用素材一键移入项目回收站，可恢复或清空。",
    "【图片增量压缩】按内容哈希跳过已压缩过的图片，可强制重压；点击结果查看压缩前后对比，可单张还原原图。",
    "【安全区检查】画布显示刘海 / Home 条安全区，越界或超出画布的节点高亮，点击即可定位。",
    "【Runtime 管理】集中查看所有项目的本地预览进程（PID、运行时长、日志），可切换项目或停止；状态栏显示运行数量。",
    "【一键反馈包】汇总版本、系统、项目、Runtime / Bridge 日志与最近错误并自动脱敏，可复制或保存；运行时错误弹窗可直接生成。",
    "【更快更省】查询预览状态不再反复启动 Maker CLI；减少重复轮询，窗口隐藏时暂停截图；编辑器与工具面板按需加载。",
    "【更稳更安全】打包版收紧本机 Bridge 访问来源；修复改 Lua 后颜色/文本回写读到旧值；打开中的项目目录被删除时 Bridge 不再崩溃。"
  ],
  links: [
    {
      label: "完整更新日志",
      url: "https://github.com/AndroidSix/TapMakerWork/blob/main/docs/CHANGELOG.md#release-0.1.7"
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
    windowsX64: "https://github.com/AndroidSix/TapMakerWork/releases/download/v0.1.7/TapMakerWork-0.1.7-windows-x64.exe",
    page: "https://github.com/AndroidSix/TapMakerWork/releases/tag/v0.1.7",
    site: "https://androidsix.github.io/tapmakerwork-site/",
    githubPage: "https://github.com/AndroidSix/TapMakerWork/releases/tag/v0.1.7"
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
