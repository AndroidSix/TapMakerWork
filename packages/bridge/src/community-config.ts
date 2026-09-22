export interface CommunityConfig {
  qqGroupId: string;
  qqGroupName: string;
  qqGroupJoinUrl: string;
  officialSiteUrl?: string;
  updatedAt?: string;
  source: "gitee" | "github" | "builtin";
}

export const BUILTIN_COMMUNITY: Omit<CommunityConfig, "source"> = {
  qqGroupId: "1124103038",
  qqGroupName: "TapMakerWork工具交流群",
  qqGroupJoinUrl: "https://qm.qq.com/q/OCt1HAmHK2",
  officialSiteUrl: "https://androidsix.github.io/tapmakerwork-site/",
  updatedAt: "2026-09-22"
};

const GITEE_URL = "https://gitee.com/AndroidSUP/tap-maker-work/raw/main/community.json";
const GITHUB_URL = "https://raw.githubusercontent.com/AndroidSix/TapMakerWork/main/community.json";

const CACHE_TTL_MS = 30 * 60 * 1000;

let cached: { value: CommunityConfig; fetchedAt: number } | undefined;

function normalizeConfig(raw: unknown, source: CommunityConfig["source"]): CommunityConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const data = raw as Record<string, unknown>;
  const qqGroupId = typeof data.qqGroupId === "string" ? data.qqGroupId.trim() : "";
  const qqGroupName = typeof data.qqGroupName === "string" ? data.qqGroupName.trim() : "";
  const qqGroupJoinUrl = typeof data.qqGroupJoinUrl === "string" ? data.qqGroupJoinUrl.trim() : "";
  if (!qqGroupId || !qqGroupName || !qqGroupJoinUrl) return undefined;
  const result: CommunityConfig = {
    qqGroupId,
    qqGroupName,
    qqGroupJoinUrl,
    source
  };
  if (typeof data.officialSiteUrl === "string" && data.officialSiteUrl.trim()) {
    result.officialSiteUrl = data.officialSiteUrl.trim();
  } else if (BUILTIN_COMMUNITY.officialSiteUrl) {
    result.officialSiteUrl = BUILTIN_COMMUNITY.officialSiteUrl;
  }
  if (typeof data.updatedAt === "string" && data.updatedAt.trim()) {
    result.updatedAt = data.updatedAt.trim();
  }
  return result;
}

async function fetchCommunity(url: string, source: CommunityConfig["source"]): Promise<CommunityConfig | undefined> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "TapMakerWork/bridge" },
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) return undefined;
  const text = await response.text();
  try {
    return normalizeConfig(JSON.parse(text), source);
  } catch {
    return undefined;
  }
}

export async function loadCommunityConfig(force = false): Promise<CommunityConfig> {
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value;
  }
  try {
    const fromGitee = await fetchCommunity(GITEE_URL, "gitee");
    if (fromGitee) {
      cached = { value: fromGitee, fetchedAt: Date.now() };
      return fromGitee;
    }
  } catch {
    // fall through
  }
  try {
    const fromGithub = await fetchCommunity(GITHUB_URL, "github");
    if (fromGithub) {
      cached = { value: fromGithub, fetchedAt: Date.now() };
      return fromGithub;
    }
  } catch {
    // fall through
  }
  const builtin: CommunityConfig = { ...BUILTIN_COMMUNITY, source: "builtin" };
  cached = { value: builtin, fetchedAt: Date.now() };
  return builtin;
}
