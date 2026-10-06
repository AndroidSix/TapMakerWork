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
  latest: "0.1.5",
  title: "TapMakerWork 0.1.5",
  notes: [
    "【AI 控 IDE】任意 AI（Cursor/Trae/WorkBuddy/Codex…）可像控本地软件一样调试本 IDE 与 Runtime：读活树/错误/画面，改控件、启停预览、构建、doctor、截帧。",
    "【开箱无 MCP】打开项目即写入 .tapmakerwork/ai/（STATUS、snapshot、errors、preview.png）；也可用 http://127.0.0.1:43121/api/agent。",
    "【报错置前】运行/预览失败时 IDE 自动抢到前台，避免漏看错误。",
    "用法：TapMakerWork 打开游戏项目并尽量启动 Runtime → AI 打开同一目录 → 说「按 .tapmakerwork/ai/STATUS.md 闭环调试」。"
  ],
  links: [
    {
      label: "完整更新日志",
      url: "https://github.com/AndroidSix/TapMakerWork/blob/main/docs/CHANGELOG.md#release-0.1.5"
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
  publishedAt: "2026-10-06",
  force: false,
  downloads: {
    macArm64: "https://github.com/AndroidSix/TapMakerWork/releases/download/v0.1.5/TapMakerWork-0.1.5-mac-arm64.pkg",
    macX64: "https://github.com/AndroidSix/TapMakerWork/releases/download/v0.1.5/TapMakerWork-0.1.5-mac-x64.pkg",
    windowsX64: "https://github.com/AndroidSix/TapMakerWork/releases/download/v0.1.5/TapMakerWork-0.1.5-windows-x64.exe",
    page: "https://github.com/AndroidSix/TapMakerWork/releases/tag/v0.1.5",
    site: "https://androidsix.github.io/tapmakerwork-site/",
    githubPage: "https://github.com/AndroidSix/TapMakerWork/releases/tag/v0.1.5"
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
