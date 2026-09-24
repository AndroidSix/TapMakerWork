import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";

const TAP_HOST = "www.taptap.cn";
const STEAM_HOST = "store.steampowered.com";
const X_UA = "V=1&PN=WebApp&LANG=zh_CN&VN_CODE=100000000&LOC=CN&PLT=PC&DS=Android&UID=0&OS=MacOS&OSV=10.15.7&DT=PC";
const USER_AGENT = "TapMakerWork/0.1 (new-game-radar; +https://github.com/androidsix/TapMakerWork)";

export type RadarChannelId = "maker" | "store" | "steam";

export interface RadarGameEntry {
  id: number;
  title: string;
  author: string;
  authorId?: number;
  authorUrl?: string;
  iconUrl?: string;
  tags: string[];
  score: number | null;
  hits: number;
  reviewCount: number;
  fans: number;
  board: string;
  rank: number;
  risingScore?: number;
  releasedAt?: number;
  url?: string;
  labels: string[];
  channel?: RadarChannelId;
}

export interface RadarBoard {
  id: string;
  label: string;
  sort: number;
  from: number;
  limit: number;
  description?: string;
  entries: RadarGameEntry[];
}

export type RadarQuadrant = "巨头垄断" | "红海拥挤" | "小而美" | "蓝海空白";
export type RadarLifecycle = "导入期" | "成长期" | "成熟期" | "衰退期";

export interface RadarQuadrantGuide {
  quadrant: RadarQuadrant;
  tone: "bad" | "mid" | "good";
  summary: string;
  meaning: string;
  axis: string;
  action: string;
}

/** 赛道象限完整说明：X=供给饱和，Y=头部占据 */
export const QUADRANT_GUIDE: RadarQuadrantGuide[] = [
  {
    quadrant: "蓝海空白",
    tone: "good",
    summary: "供给少、尚无稳定霸主",
    meaning: "该赛道上榜作品很少，竞争格局未定。玩家需求可能存在，但供给尚未挤满。",
    axis: "低供给饱和 · 头部尚未形成绝对垄断（样本少时头部占比可能虚高）",
    action: "优先验证：适合差异化切入，先做小体量验证口碑与留存。"
  },
  {
    quadrant: "小而美",
    tone: "mid",
    summary: "供给适中、头部不够极端",
    meaning: "赛道有一定作品量，但热度没有被少数巨头吃干净，仍有细分空间。",
    axis: "中低供给 · 头部占据相对可控",
    action: "可切入：找题材/玩法辨识度，用口碑和完成度打穿细分人群。"
  },
  {
    quadrant: "红海拥挤",
    tone: "bad",
    summary: "供给偏多、同质化风险高",
    meaning: "同类作品已经较多，玩家选择多，新作需要更强卖点才能被看见。",
    axis: "高供给 · 头部未必极端，但整体拥挤",
    action: "谨慎切入：避免跟风仿制，除非有明确差异化或渠道优势。"
  },
  {
    quadrant: "巨头垄断",
    tone: "bad",
    summary: "供给多且热度高度集中",
    meaning: "赛道既卷、又被头部作品拿走大部分曝光，后来者正面硬刚成本很高。",
    axis: "高供给饱和 · 高头部占据",
    action: "不建议正面切入：除非换赛道切口，或做巨头覆盖不到的边缘需求。"
  }
];

export interface RadarTrackRow {
  track: string;
  quadrant: RadarQuadrant;
  lifecycle: RadarLifecycle;
  count: number;
  supplySaturation: number;
  headOccupancy: number;
  smoothOccupancy: number;
  avgScore: number | null;
  opportunity: number;
  suggestion: string;
}

export interface RadarScoreBucket {
  label: string;
  min: number;
  max: number;
  count: number;
}

export interface RadarChannel {
  id: RadarChannelId;
  label: string;
  description: string;
  entries: RadarGameEntry[];
  boards: RadarBoard[];
  tracks: RadarTrackRow[];
  scoreBuckets: RadarScoreBucket[];
  error?: string;
}

export interface RadarSnapshot {
  fetchedAt: string;
  source: "live" | "offline";
  channels: RadarChannel[];
  /** @deprecated 兼容旧面板：等于当前主渠道（制造） */
  boardCount: number;
  entryCount: number;
  boards: RadarBoard[];
  entries: RadarGameEntry[];
  tracks: RadarTrackRow[];
  scoreBuckets: RadarScoreBucket[];
  error?: string;
}

export interface RadarDailyTrackStat {
  track: string;
  count: number;
  totalHits: number;
  avgScore: number | null;
}

export interface RadarDailyDayStat {
  date: string;
  count: number;
  totalHits: number;
  topTitle?: string;
  topHits?: number;
  topScore?: number | null;
}

export interface RadarDailyReport {
  fetchedAt: string;
  source: "live" | "offline";
  from: string;
  to: string;
  total: number;
  scoredCount: number;
  avgScore: number | null;
  totalHits: number;
  highlights: {
    hottest?: RadarGameEntry;
    bestScore?: RadarGameEntry;
    mostReviewed?: RadarGameEntry;
  };
  topByHits: RadarGameEntry[];
  topByScore: RadarGameEntry[];
  topTracks: RadarDailyTrackStat[];
  byDay: RadarDailyDayStat[];
  entries: RadarGameEntry[];
  truncated?: boolean;
  error?: string;
}

interface DailyLaunchCache {
  fetchedAt: string;
  sinceSec: number;
  entries: RadarGameEntry[];
}

interface BoardSpec {
  id: string;
  label: string;
  sort: number;
  from: number;
  limit: number;
}

/** 拉取原始池：官方仅稳定提供 sort=1（综合/热度向）与 sort=2（新上） */
const POOL_SPECS: BoardSpec[] = [
  { id: "pool-hot", label: "制造综合池", sort: 1, from: 0, limit: 40 },
  { id: "pool-new", label: "制造新上池", sort: 2, from: 0, limit: 40 }
];

const HEAT_BOARD_LIMIT = 30;
const RISING_BOARD_LIMIT = 30;

const TRACK_RULES: Array<{ track: string; match: RegExp }> = [
  { track: "模拟经营/建造", match: /模拟|经营|建造|养成|种田|农场|开店|公司|人生/ },
  { track: "休闲/治愈", match: /休闲|治愈|放置|挂机|轻松|竖屏/ },
  { track: "联机多人", match: /联机|多人|对战|竞技|PVP|MOBA/ },
  { track: "买断/单机", match: /买断|单机|剧情|文字|视觉小说|AVG/ },
  { track: "二次元/RPG", match: /二次元|角色扮演|RPG|修仙|冒险|刷宝/ },
  { track: "策略/卡牌", match: /策略|卡牌|塔防|战棋|Roguelike|肉鸽/ },
  { track: "开放世界", match: /开放世界|沙盒|大世界/ },
  { track: "解谜/叙事", match: /解谜|知识问答|找不同|叙事/ },
  { track: "动作/格斗", match: /动作|格斗|射击|割草|跑酷|街机/ },
  { track: "音游/节奏", match: /音游|节奏|音乐/ }
];

function configDir(): string {
  return path.join(os.homedir(), ".tapmakerwork");
}

function snapshotPath(): string {
  return path.join(configDir(), "new-game-radar-snapshot.json");
}

function httpsGetJson(hostname: string, pathnameWithQuery: string, extraHeaders?: Record<string, string>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path: pathnameWithQuery,
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
          ...extraHeaders
        },
        timeout: 20_000
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode || 0) >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("request_timeout"));
    });
    req.end();
  });
}

function tapGetJson(pathnameWithQuery: string): Promise<unknown> {
  return httpsGetJson(TAP_HOST, pathnameWithQuery, { "X-UA": X_UA });
}

function pickDeveloper(developers: unknown): { name: string; id?: number; url?: string } {
  if (!Array.isArray(developers) || developers.length === 0) return { name: "未知作者" };
  const first = developers[0] as Record<string, unknown>;
  const name = String(first.name || first.nickname || first.user_name || "未知作者");
  const idRaw = Number(first.id);
  const id = Number.isFinite(idRaw) && idRaw > 0 ? idRaw : undefined;
  const website = typeof first.website === "string" ? first.website.trim() : "";
  let url: string | undefined;
  if (website.startsWith("https://www.taptap.cn/developer/") || website.startsWith("https://www.taptap.cn/user/")) {
    url = website;
  } else if (id != null) {
    url = `https://www.taptap.cn/developer/${id}`;
  }
  const result: { name: string; id?: number; url?: string } = { name };
  if (id != null) result.id = id;
  if (url) result.url = url;
  return result;
}

function pickIconUrl(icon: unknown): string | undefined {
  if (!icon || typeof icon !== "object") return undefined;
  const record = icon as Record<string, unknown>;
  for (const key of ["small_url", "medium_url", "url", "large_url"]) {
    const value = record[key];
    if (typeof value === "string" && value.startsWith("http")) return value;
  }
  return undefined;
}

function pickTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((tag) => {
      if (typeof tag === "string") return tag;
      if (tag && typeof tag === "object" && "value" in tag) return String((tag as { value: unknown }).value);
      return "";
    })
    .filter(Boolean)
    .filter((tag) => tag !== "TapTap制造");
}

function pickScore(stat: Record<string, unknown> | undefined): number | null {
  const rating = stat?.rating as Record<string, unknown> | undefined;
  const raw = rating?.score;
  if (raw == null || raw === "" || raw === "0" || raw === 0) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function normalizeMakerApp(raw: Record<string, unknown>, board: string, rank: number): RadarGameEntry {
  const stat = (raw.stat && typeof raw.stat === "object" ? raw.stat : {}) as Record<string, unknown>;
  const labels = Array.isArray(raw.title_labels) ? raw.title_labels.map(String) : [];
  const released = typeof raw.released_time === "number" ? raw.released_time : undefined;
  const developer = pickDeveloper(raw.developers);
  const id = Number(raw.id) || 0;
  const iconUrl = pickIconUrl(raw.icon);
  const entry: RadarGameEntry = {
    id,
    title: String(raw.title || "未命名"),
    author: developer.name,
    tags: pickTags(raw.tags),
    score: pickScore(stat),
    hits: Number(stat.hits_total) || 0,
    reviewCount: Number(stat.review_count) || 0,
    fans: Number(stat.fans_count) || 0,
    board,
    rank,
    labels,
    channel: "maker"
  };
  if (developer.id != null) entry.authorId = developer.id;
  if (developer.url) entry.authorUrl = developer.url;
  if (iconUrl) entry.iconUrl = iconUrl;
  if (released != null) entry.releasedAt = released;
  if (id > 0) entry.url = `https://www.taptap.cn/app/${id}`;
  return entry;
}

/** TapTap 商店榜条目：list[].app */
export function normalizeStoreApp(raw: Record<string, unknown>, board: string, rank: number): RadarGameEntry {
  const app = (raw.app && typeof raw.app === "object" ? raw.app : raw) as Record<string, unknown>;
  const entry = normalizeMakerApp(app, board, rank);
  entry.channel = "store";
  if (!entry.author || entry.author === "未知作者") entry.author = "—";
  return entry;
}

/** Steam featuredcategories 条目 */
export function normalizeSteamItem(raw: Record<string, unknown>, board: string, rank: number): RadarGameEntry {
  const id = Number(raw.id) || 0;
  const icon =
    (typeof raw.small_capsule_image === "string" && raw.small_capsule_image) ||
    (typeof raw.header_image === "string" && raw.header_image) ||
    undefined;
  // ponytail: Steam 公开精选无评分/热度，用名次倒序当伪热度，仅够本地排序
  const hits = Math.max(0, 1000 - rank * 10);
  const entry: RadarGameEntry = {
    id,
    title: String(raw.name || "Untitled"),
    author: "Steam",
    tags: [],
    score: null,
    hits,
    reviewCount: 0,
    fans: 0,
    board,
    rank,
    labels: typeof raw.discount_percent === "number" && raw.discount_percent > 0 ? [`-${raw.discount_percent}%`] : [],
    channel: "steam"
  };
  if (icon) entry.iconUrl = icon;
  if (id > 0) entry.url = `https://store.steampowered.com/app/${id}`;
  return entry;
}

export function mapTrack(tags: string[], title = ""): string {
  const haystack = `${tags.join(" ")} ${title}`;
  for (const rule of TRACK_RULES) {
    if (rule.match.test(haystack)) return rule.track;
  }
  return "其他/未分类";
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function analyzeTracks(entries: RadarGameEntry[]): RadarTrackRow[] {
  const groups = new Map<string, RadarGameEntry[]>();
  for (const entry of entries) {
    const track = mapTrack(entry.tags, entry.title);
    const list = groups.get(track) || [];
    list.push(entry);
    groups.set(track, list);
  }

  const maxCount = Math.max(1, ...[...groups.values()].map((list) => list.length));
  const rows: RadarTrackRow[] = [];

  for (const [track, list] of groups) {
    if (list.length < 1) continue;
    const sorted = [...list].sort((a, b) => b.hits - a.hits);
    const totalHits = sorted.reduce((sum, item) => sum + Math.max(0, item.hits), 0) || 1;
    const topHits = sorted[0]?.hits || 0;
    const top2Hits = (sorted[0]?.hits || 0) + (sorted[1]?.hits || 0);
    const supplySaturation = clamp01(list.length / maxCount);
    const headOccupancy = clamp01(topHits / totalHits);
    const smoothOccupancy = clamp01(top2Hits / totalHits);
    const scored = list.map((item) => item.score).filter((score): score is number => score != null);
    const avgScore = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null;
    const headPenalty = list.length <= 2 ? Math.min(headOccupancy, 0.2) : headOccupancy;
    const opportunity = Math.round(
      clamp01(1 - supplySaturation) * clamp01(1 - headPenalty) * 100 * (avgScore == null ? 0.85 : clamp01(avgScore / 10) * 0.5 + 0.5)
    );

    let quadrant: RadarQuadrant = "红海拥挤";
    if (supplySaturation <= 0.28) quadrant = "蓝海空白";
    else if (supplySaturation <= 0.5 && headOccupancy < 0.7) quadrant = "小而美";
    else if (supplySaturation >= 0.7 && headOccupancy >= 0.5) quadrant = "巨头垄断";
    else if (supplySaturation >= 0.55) quadrant = "红海拥挤";
    else quadrant = "小而美";

    let lifecycle: RadarLifecycle = "成长期";
    if (list.length <= 2) lifecycle = "导入期";
    else if (supplySaturation >= 0.75 && headOccupancy >= 0.55) lifecycle = "成熟期";
    else if (avgScore != null && avgScore < 7 && supplySaturation > 0.5) lifecycle = "衰退期";

    let suggestion = "观察后再决定是否切入。";
    if (quadrant === "蓝海空白") suggestion = "人少且无霸主，最高优先级。";
    else if (quadrant === "小而美") suggestion = "可以差异化切入，注意口碑与题材辨识度。";
    else if (quadrant === "巨头垄断") suggestion = "人多且头部集中，不建议正面切入。";
    else suggestion = "供给偏多，需强差异化或避开头部玩法。";

    rows.push({
      track,
      quadrant,
      lifecycle,
      count: list.length,
      supplySaturation: round2(supplySaturation),
      headOccupancy: round2(headOccupancy),
      smoothOccupancy: round2(smoothOccupancy),
      avgScore: avgScore == null ? null : round2(avgScore),
      opportunity,
      suggestion
    });
  }

  return rows
    .filter((row) => row.count >= 1)
    .sort((a, b) => b.opportunity - a.opportunity || b.count - a.count);
}

export function buildScoreBuckets(entries: RadarGameEntry[]): RadarScoreBucket[] {
  const buckets: RadarScoreBucket[] = [
    { label: "9.0+", min: 9, max: 10.01, count: 0 },
    { label: "8.0-8.9", min: 8, max: 9, count: 0 },
    { label: "7.0-7.9", min: 7, max: 8, count: 0 },
    { label: "6.0-6.9", min: 6, max: 7, count: 0 },
    { label: "<6.0", min: 0, max: 6, count: 0 }
  ];
  for (const entry of entries) {
    if (entry.score == null) continue;
    const bucket = buckets.find((item) => entry.score! >= item.min && entry.score! < item.max);
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

/** 新锐指数：口碑为主（平方放大），热度取对数，并对超高热度做抑制，避免巨头霸榜 */
export function computeRisingScore(entry: RadarGameEntry): number {
  if (entry.score == null || entry.score <= 0) return 0;
  const heat = Math.log10(Math.max(0, entry.hits) + 10);
  const trust = 1 + Math.min(Math.max(0, entry.reviewCount), 30) / 60;
  const heatDamp = 1 / (1 + Math.max(0, entry.hits) / 3000);
  return round2(entry.score * entry.score * heat * trust * (0.35 + 0.65 * heatDamp));
}

export function buildHeatBoard(entries: RadarGameEntry[], limit = HEAT_BOARD_LIMIT): RadarBoard {
  const sorted = [...entries]
    .sort((a, b) => b.hits - a.hits || (b.score ?? 0) - (a.score ?? 0) || a.title.localeCompare(b.title, "zh"))
    .slice(0, limit);
  return {
    id: "heat",
    label: "热度榜",
    sort: 1,
    from: 0,
    limit,
    description: "按曝光热度（hits）降序，反映当前最热的作品。",
    entries: sorted.map((entry, index) => ({
      ...entry,
      board: "热度榜",
      rank: index + 1
    }))
  };
}

export function buildRisingBoard(entries: RadarGameEntry[], limit = RISING_BOARD_LIMIT): RadarBoard {
  const ranked = entries
    .map((entry) => ({ entry, risingScore: computeRisingScore(entry) }))
    .filter((item) => item.risingScore > 0)
    .sort((a, b) => b.risingScore - a.risingScore || b.entry.hits - a.entry.hits || a.entry.title.localeCompare(b.entry.title, "zh"))
    .slice(0, limit);
  return {
    id: "rising",
    label: "新锐榜",
    sort: 2,
    from: 0,
    limit,
    description: "综合口碑（评分平方）与热度（对数，并对超高热度抑制）及评论可信度排序，突出高口碑、尚未被巨头热度碾压的作品。",
    entries: ranked.map((item, index) => ({
      ...item.entry,
      board: "新锐榜",
      rank: index + 1,
      risingScore: item.risingScore
    }))
  };
}

export function buildDerivedBoards(entries: RadarGameEntry[]): RadarBoard[] {
  return [buildHeatBoard(entries), buildRisingBoard(entries)];
}

function buildSteamBoards(topSellers: RadarGameEntry[], newReleases: RadarGameEntry[]): RadarBoard[] {
  return [
    {
      id: "heat",
      label: "畅销榜",
      sort: 1,
      from: 0,
      limit: topSellers.length,
      description: "Steam 商店公开「畅销」精选（featuredcategories.top_sellers），全球对照用。",
      entries: topSellers.map((entry, index) => ({ ...entry, board: "畅销榜", rank: index + 1 }))
    },
    {
      id: "rising",
      label: "新品榜",
      sort: 2,
      from: 0,
      limit: newReleases.length,
      description: "Steam 商店公开「新品」精选（featuredcategories.new_releases），无评分字段，不作新锐分。",
      entries: newReleases.map((entry, index) => ({ ...entry, board: "新品榜", rank: index + 1 }))
    }
  ];
}

function buildChannel(
  id: RadarChannelId,
  label: string,
  description: string,
  entries: RadarGameEntry[],
  boards?: RadarBoard[],
  error?: string
): RadarChannel {
  const resolvedBoards = boards || buildDerivedBoards(entries);
  const channel: RadarChannel = {
    id,
    label,
    description,
    entries,
    boards: resolvedBoards,
    tracks: analyzeTracks(entries),
    scoreBuckets: buildScoreBuckets(entries)
  };
  if (error) channel.error = error;
  return channel;
}

function flattenSnapshot(fetchedAt: string, source: "live" | "offline", channels: RadarChannel[], error?: string): RadarSnapshot {
  const primary = channels.find((item) => item.id === "maker") || channels[0];
  const snapshot: RadarSnapshot = {
    fetchedAt,
    source,
    channels,
    boardCount: primary?.boards.length || 0,
    entryCount: primary?.entries.length || 0,
    boards: primary?.boards || [],
    entries: primary?.entries || [],
    tracks: primary?.tracks || [],
    scoreBuckets: primary?.scoreBuckets || []
  };
  if (error) snapshot.error = error;
  return snapshot;
}

/** 兼容旧快照：无 channels 时把顶层 entries 当作制造渠道 */
function coerceChannels(raw: Partial<RadarSnapshot>): RadarChannel[] {
  if (Array.isArray(raw.channels) && raw.channels.length > 0) {
    return raw.channels.map((channel) =>
      buildChannel(channel.id, channel.label, channel.description, channel.entries || [], channel.boards, channel.error)
    );
  }
  return [
    buildChannel(
      "maker",
      "TapTap 制造",
      "制造综合池 + 新上池，本地推导热度榜 / 新锐榜。",
      Array.isArray(raw.entries) ? raw.entries : []
    )
  ];
}

async function fetchMakerEntries(): Promise<RadarGameEntry[]> {
  const seen = new Set<number>();
  const entries: RadarGameEntry[] = [];
  for (const spec of POOL_SPECS) {
    const query = `/webapiv2/maker/v1/app-list?sort=${spec.sort}&from=${spec.from}&limit=${spec.limit}&platform=android`;
    const payload = (await tapGetJson(query)) as {
      success?: boolean;
      data?: { list?: Record<string, unknown>[]; msg?: string };
    };
    if (!payload.success) {
      throw new Error(payload.data?.msg || "maker_list_failed");
    }
    for (const [index, item] of (payload.data?.list || []).entries()) {
      const entry = normalizeMakerApp(item, spec.label, index + 1);
      if (!entry.id || seen.has(entry.id)) continue;
      seen.add(entry.id);
      entries.push(entry);
    }
  }
  return entries;
}

async function fetchStoreEntries(): Promise<RadarGameEntry[]> {
  // ponytail: 官方 type=hot/new/played 目前都落「热门榜」，只拉一页热门即可
  const query = `/webapiv2/app-top/v2/hits?type=hot&from=0&limit=40`;
  const payload = (await tapGetJson(query)) as {
    success?: boolean;
    data?: { list?: Record<string, unknown>[]; title?: string; msg?: string };
  };
  if (!payload.success) throw new Error(payload.data?.msg || "store_list_failed");
  const boardLabel = String(payload.data?.title || "商店热门");
  const seen = new Set<number>();
  const entries: RadarGameEntry[] = [];
  for (const [index, item] of (payload.data?.list || []).entries()) {
    const entry = normalizeStoreApp(item, boardLabel, index + 1);
    if (!entry.id || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }
  return entries;
}

async function fetchSteamChannel(): Promise<RadarChannel> {
  const payload = (await httpsGetJson(STEAM_HOST, "/api/featuredcategories/?l=schinese&cc=cn")) as Record<string, unknown>;
  const topRaw = ((payload.top_sellers as { items?: Record<string, unknown>[] } | undefined)?.items) || [];
  const newRaw = ((payload.new_releases as { items?: Record<string, unknown>[] } | undefined)?.items) || [];
  const topSellers = topRaw.map((item, index) => normalizeSteamItem(item, "Steam 畅销", index + 1));
  const newReleases = newRaw.map((item, index) => normalizeSteamItem(item, "Steam 新品", index + 1));
  const seen = new Set<number>();
  const entries: RadarGameEntry[] = [];
  for (const entry of [...topSellers, ...newReleases]) {
    if (!entry.id || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }
  return buildChannel(
    "steam",
    "Steam 对照",
    "Valve 公开精选接口（畅销 / 新品），作全球独立与商业趋势对照；非国内小游戏榜。",
    entries,
    buildSteamBoards(topSellers, newReleases)
  );
}

async function fetchChannelSafe(
  id: RadarChannelId,
  label: string,
  description: string,
  runner: () => Promise<{ entries: RadarGameEntry[]; boards?: RadarBoard[] }>
): Promise<RadarChannel> {
  try {
    const result = await runner();
    return buildChannel(id, label, description, result.entries, result.boards);
  } catch (error) {
    return buildChannel(id, label, description, [], undefined, error instanceof Error ? error.message : String(error));
  }
}

export function readOfflineSnapshot(): RadarSnapshot | null {
  try {
    if (!fs.existsSync(snapshotPath())) return null;
    const raw = JSON.parse(fs.readFileSync(snapshotPath(), "utf8")) as Partial<RadarSnapshot>;
    if (!raw) return null;
    const channels = coerceChannels(raw);
    if (channels.every((channel) => channel.entries.length === 0) && !Array.isArray(raw.entries)) return null;
    return flattenSnapshot(raw.fetchedAt || new Date().toISOString(), "offline", channels, raw.error);
  } catch {
    return null;
  }
}

export function writeOfflineSnapshot(snapshot: RadarSnapshot): void {
  fs.mkdirSync(configDir(), { recursive: true });
  const toStore: RadarSnapshot = {
    ...snapshot,
    source: "offline"
  };
  fs.writeFileSync(snapshotPath(), `${JSON.stringify(toStore, null, 2)}\n`, "utf8");
}

export async function fetchLatestRadarSnapshot(): Promise<RadarSnapshot> {
  const [maker, store, steam] = await Promise.all([
    fetchChannelSafe("maker", "TapTap 制造", "制造综合池 + 新上池，本地推导热度榜 / 新锐榜。", async () => ({
      entries: await fetchMakerEntries()
    })),
    fetchChannelSafe("store", "TapTap 商店", "商店公开热门榜（app-top/v2/hits）。官方 type 目前均落热门，作全站对照。", async () => ({
      entries: await fetchStoreEntries()
    })),
    fetchChannelSafe("steam", "Steam 对照", "Valve 公开精选接口（畅销 / 新品）。", async () => {
      const channel = await fetchSteamChannel();
      return { entries: channel.entries, boards: channel.boards };
    })
  ]);
  const channels = [maker, store, steam];
  const errors = channels.filter((channel) => channel.error).map((channel) => `${channel.label}: ${channel.error}`);
  const snapshot = flattenSnapshot(
    new Date().toISOString(),
    "live",
    channels,
    errors.length ? errors.join("；") : undefined
  );
  if (channels.every((channel) => channel.entries.length === 0)) {
    throw new Error(snapshot.error || "all_channels_failed");
  }
  writeOfflineSnapshot(snapshot);
  return snapshot;
}

export function loadRadarSnapshot(preferLive: boolean): Promise<RadarSnapshot> {
  if (!preferLive) {
    const offline = readOfflineSnapshot();
    if (offline) return Promise.resolve(offline);
  }
  return fetchLatestRadarSnapshot().catch((error) => {
    const offline = readOfflineSnapshot();
    if (offline) {
      return {
        ...offline,
        source: "offline",
        error: error instanceof Error ? error.message : String(error)
      };
    }
    throw error;
  });
}

export function emptyRadarSnapshot(message?: string): RadarSnapshot {
  return flattenSnapshot(
    new Date().toISOString(),
    "offline",
    [
      buildChannel("maker", "TapTap 制造", "制造综合池 + 新上池。", []),
      buildChannel("store", "TapTap 商店", "商店公开热门榜。", []),
      buildChannel("steam", "Steam 对照", "Steam 公开精选。", [])
    ],
    message
  );
}

const DAILY_PAGE_SIZE = 40;
const DAILY_MAX_PAGES = 60;
const DAILY_MAX_RANGE_DAYS = 30;
const DAILY_CACHE_BUFFER_DAYS = 30;

function dailyCachePath(): string {
  return path.join(configDir(), "new-game-radar-daily.json");
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** 本地日历日 YYYY-MM-DD */
export function dayKeyFromTs(tsSec: number): string {
  const date = new Date(tsSec * 1000);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function startOfLocalDay(dateStr: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) throw new Error("invalid_date");
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

export function endOfLocalDay(dateStr: string): number {
  return startOfLocalDay(dateStr) + 86400 - 1;
}

export function defaultDailyRange(days = 7): { from: string; to: string } {
  const span = Math.max(1, Math.min(DAILY_MAX_RANGE_DAYS, Math.floor(days)));
  const toDate = new Date();
  const fromDate = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate() - (span - 1));
  return {
    from: `${fromDate.getFullYear()}-${pad2(fromDate.getMonth() + 1)}-${pad2(fromDate.getDate())}`,
    to: `${toDate.getFullYear()}-${pad2(toDate.getMonth() + 1)}-${pad2(toDate.getDate())}`
  };
}

function clampDailyRange(from: string, to: string): { from: string; to: string } {
  let fromSec = startOfLocalDay(from);
  let toSec = endOfLocalDay(to);
  if (fromSec > toSec) {
    const tmp = from;
    from = to;
    to = tmp;
    fromSec = startOfLocalDay(from);
    toSec = endOfLocalDay(to);
  }
  const maxSpan = DAILY_MAX_RANGE_DAYS * 86400 - 1;
  if (toSec - fromSec > maxSpan) {
    fromSec = toSec - maxSpan;
    from = dayKeyFromTs(fromSec);
  }
  return { from, to };
}

function readDailyCache(): DailyLaunchCache | null {
  try {
    if (!fs.existsSync(dailyCachePath())) return null;
    const raw = JSON.parse(fs.readFileSync(dailyCachePath(), "utf8")) as DailyLaunchCache;
    if (!raw || !Array.isArray(raw.entries)) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeDailyCache(cache: DailyLaunchCache): void {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(dailyCachePath(), `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

/** 分页拉制造新上池，直到最旧 releasedAt < sinceSec 或触顶 */
export async function fetchMakerLaunchesSince(sinceSec: number): Promise<{ entries: RadarGameEntry[]; truncated: boolean }> {
  const seen = new Set<number>();
  const entries: RadarGameEntry[] = [];
  let truncated = false;
  for (let page = 0; page < DAILY_MAX_PAGES; page += 1) {
    const from = page * DAILY_PAGE_SIZE;
    const query = `/webapiv2/maker/v1/app-list?sort=2&from=${from}&limit=${DAILY_PAGE_SIZE}&platform=android`;
    const payload = (await tapGetJson(query)) as {
      success?: boolean;
      data?: { list?: Record<string, unknown>[]; next_page?: string; msg?: string };
    };
    if (!payload.success) throw new Error(payload.data?.msg || "maker_daily_failed");
    const list = payload.data?.list || [];
    if (list.length === 0) break;
    let oldest: number | undefined;
    for (const [index, item] of list.entries()) {
      const entry = normalizeMakerApp(item, "每日上线", from + index + 1);
      if (!entry.id || seen.has(entry.id)) continue;
      seen.add(entry.id);
      entries.push(entry);
      if (entry.releasedAt != null) {
        oldest = oldest == null ? entry.releasedAt : Math.min(oldest, entry.releasedAt);
      }
    }
    if (oldest != null && oldest < sinceSec) break;
    if (!payload.data?.next_page) break;
    if (page === DAILY_MAX_PAGES - 1) truncated = true;
  }
  return { entries, truncated };
}

export function buildDailyReport(
  pool: RadarGameEntry[],
  from: string,
  to: string,
  meta: { fetchedAt: string; source: "live" | "offline"; truncated?: boolean; error?: string }
): RadarDailyReport {
  const range = clampDailyRange(from, to);
  const fromSec = startOfLocalDay(range.from);
  const toSec = endOfLocalDay(range.to);
  const entries = pool
    .filter((entry) => entry.releasedAt != null && entry.releasedAt >= fromSec && entry.releasedAt <= toSec)
    .sort((a, b) => (b.releasedAt || 0) - (a.releasedAt || 0) || b.hits - a.hits);

  const scored = entries.filter((entry) => entry.score != null);
  const totalHits = entries.reduce((sum, entry) => sum + Math.max(0, entry.hits), 0);
  const avgScore = scored.length
    ? round2(scored.reduce((sum, entry) => sum + (entry.score || 0), 0) / scored.length)
    : null;

  const topByHits = [...entries].sort((a, b) => b.hits - a.hits || (b.score ?? 0) - (a.score ?? 0)).slice(0, 10);
  const topByScore = [...entries]
    .filter((entry) => entry.score != null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.reviewCount - a.reviewCount || b.hits - a.hits)
    .slice(0, 10);
  const mostReviewed = [...entries].sort((a, b) => b.reviewCount - a.reviewCount || b.hits - a.hits)[0];

  const trackMap = new Map<string, RadarGameEntry[]>();
  for (const entry of entries) {
    const track = mapTrack(entry.tags, entry.title);
    const list = trackMap.get(track) || [];
    list.push(entry);
    trackMap.set(track, list);
  }
  const topTracks: RadarDailyTrackStat[] = [...trackMap.entries()]
    .map(([track, list]) => {
      const scoredList = list.filter((item) => item.score != null);
      return {
        track,
        count: list.length,
        totalHits: list.reduce((sum, item) => sum + Math.max(0, item.hits), 0),
        avgScore: scoredList.length
          ? round2(scoredList.reduce((sum, item) => sum + (item.score || 0), 0) / scoredList.length)
          : null
      };
    })
    .sort((a, b) => b.count - a.count || b.totalHits - a.totalHits)
    .slice(0, 10);

  const dayMap = new Map<string, RadarGameEntry[]>();
  for (const entry of entries) {
    const key = dayKeyFromTs(entry.releasedAt!);
    const list = dayMap.get(key) || [];
    list.push(entry);
    dayMap.set(key, list);
  }
  const byDay: RadarDailyDayStat[] = [];
  for (let ts = fromSec; ts <= toSec; ts += 86400) {
    const date = dayKeyFromTs(ts);
    const list = dayMap.get(date) || [];
    const top = [...list].sort((a, b) => b.hits - a.hits || (b.score ?? 0) - (a.score ?? 0))[0];
    const day: RadarDailyDayStat = {
      date,
      count: list.length,
      totalHits: list.reduce((sum, item) => sum + Math.max(0, item.hits), 0)
    };
    if (top) {
      day.topTitle = top.title;
      day.topHits = top.hits;
      day.topScore = top.score;
    }
    byDay.push(day);
  }

  const report: RadarDailyReport = {
    fetchedAt: meta.fetchedAt,
    source: meta.source,
    from: range.from,
    to: range.to,
    total: entries.length,
    scoredCount: scored.length,
    avgScore,
    totalHits,
    highlights: {
      ...(topByHits[0] ? { hottest: topByHits[0] } : {}),
      ...(topByScore[0] ? { bestScore: topByScore[0] } : {}),
      ...(mostReviewed && mostReviewed.reviewCount > 0 ? { mostReviewed } : {})
    },
    topByHits,
    topByScore,
    topTracks,
    byDay,
    entries
  };
  if (meta.truncated) report.truncated = true;
  if (meta.error) report.error = meta.error;
  return report;
}

export async function getDailyLaunchReport(options: {
  from?: string;
  to?: string;
  refresh?: boolean;
}): Promise<RadarDailyReport> {
  const fallback = defaultDailyRange(7);
  const range = clampDailyRange(options.from || fallback.from, options.to || fallback.to);
  const needSince = startOfLocalDay(range.from);
  const cacheSinceTarget = Math.min(needSince, startOfLocalDay(defaultDailyRange(DAILY_CACHE_BUFFER_DAYS).from));
  const cache = readDailyCache();
  const cacheCovers = Boolean(cache && cache.sinceSec <= needSince && cache.entries.length > 0);

  if (!options.refresh && cacheCovers && cache) {
    return buildDailyReport(cache.entries, range.from, range.to, {
      fetchedAt: cache.fetchedAt,
      source: "offline"
    });
  }

  try {
    const { entries, truncated } = await fetchMakerLaunchesSince(cacheSinceTarget);
    const fetchedAt = new Date().toISOString();
    writeDailyCache({ fetchedAt, sinceSec: cacheSinceTarget, entries });
    return buildDailyReport(entries, range.from, range.to, {
      fetchedAt,
      source: "live",
      truncated
    });
  } catch (error) {
    if (cache && cache.entries.length > 0) {
      return buildDailyReport(cache.entries, range.from, range.to, {
        fetchedAt: cache.fetchedAt,
        source: "offline",
        error: error instanceof Error ? error.message : String(error)
      });
    }
    throw error;
  }
}

export function emptyDailyReport(message?: string, from?: string, to?: string): RadarDailyReport {
  const range = clampDailyRange(from || defaultDailyRange(7).from, to || defaultDailyRange(7).to);
  return buildDailyReport([], range.from, range.to, {
    fetchedAt: new Date().toISOString(),
    source: "offline",
    ...(message ? { error: message } : {})
  });
}

const ALLOWED_ICON_HOST_SUFFIXES = [".tapimg.com", ".steamstatic.com", ".steamcdn-a.akamaihd.net"];
const ALLOWED_ICON_HOSTS = new Set([
  "img-tc.tapimg.com",
  "img.tapimg.com",
  "img2.tapimg.com",
  "img3.tapimg.com",
  "assets.tapimg.com",
  "shared.akamai.steamstatic.com",
  "cdn.cloudflare.steamstatic.com",
  "cdn.akamai.steamstatic.com",
  "steamcdn-a.akamaihd.net"
]);

function isAllowedIconHost(hostname: string): boolean {
  if (ALLOWED_ICON_HOSTS.has(hostname)) return true;
  return ALLOWED_ICON_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

export async function proxyTapIcon(rawUrl: string): Promise<{ contentType: string; body: Buffer }> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("invalid_icon_url");
  }
  if (parsed.protocol !== "https:") throw new Error("icon_https_required");
  if (!isAllowedIconHost(parsed.hostname)) throw new Error("icon_host_not_allowed");
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          Referer: parsed.hostname.includes("steam") ? "https://store.steampowered.com/" : "https://www.taptap.cn/"
        },
        timeout: 15_000
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          if ((res.statusCode || 0) >= 400) {
            reject(new Error(`icon_http_${res.statusCode}`));
            return;
          }
          const contentType = String(res.headers["content-type"] || "image/jpeg").split(";")[0] || "image/jpeg";
          resolve({ contentType, body: Buffer.concat(chunks) });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("icon_timeout"));
    });
    req.end();
  });
}
