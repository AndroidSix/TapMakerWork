import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { Radar, RefreshCw, Search, X } from "lucide-react";

export const NEW_GAME_RADAR_SEEN_KEY = "tapmakerwork.tools.newGameRadar.seen";

export function readNewGameRadarSeen(): boolean {
  try {
    return localStorage.getItem(NEW_GAME_RADAR_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markNewGameRadarSeen(): void {
  try {
    localStorage.setItem(NEW_GAME_RADAR_SEEN_KEY, "1");
  } catch {
    // ignore
  }
}

interface RadarGameEntry {
  id: number;
  title: string;
  author: string;
  authorId?: number;
  authorUrl?: string;
  iconUrl?: string;
  url?: string;
  tags: string[];
  score: number | null;
  hits: number;
  reviewCount: number;
  fans: number;
  board: string;
  rank: number;
  risingScore?: number;
  labels: string[];
}

interface RadarBoard {
  id: string;
  label: string;
  description?: string;
  entries: RadarGameEntry[];
}

interface RadarTrackRow {
  track: string;
  quadrant: string;
  lifecycle: string;
  count: number;
  supplySaturation: number;
  headOccupancy: number;
  smoothOccupancy: number;
  avgScore: number | null;
  opportunity: number;
  suggestion: string;
}

interface RadarScoreBucket {
  label: string;
  count: number;
}

interface RadarSnapshot {
  fetchedAt: string;
  source: "live" | "offline";
  boardCount: number;
  entryCount: number;
  boards: RadarBoard[];
  entries: RadarGameEntry[];
  tracks: RadarTrackRow[];
  scoreBuckets: RadarScoreBucket[];
  error?: string;
}

interface NewGameRadarPanelProps {
  apiBase: string;
  onClose: () => void;
  onOpenExternal: (url: string) => void;
}

type MainTab = "list" | "insight" | "analysis" | "viz";
type AnalysisSub = "opportunity" | "tracks";
type VizSub = "distribution" | "supply";
type BoardFilter = "all" | "heat" | "rising";
type ChartStyle = "hbar" | "vbar" | "donut";

const CHART_COLORS = ["#49c2ff", "#7ddea4", "#f0d59a", "#ff8f8f", "#9db7ff", "#d4a5ff", "#7bdff2", "#ffb86b", "#c3e88d", "#ff79c6"];

const SCORE_BUCKET_META: Record<string, { title: string; detail: string }> = {
  "9.0+": { title: "9.0+ 优秀口碑", detail: "评分 ≥ 9.0，口碑顶尖" },
  "8.0-8.9": { title: "8.0-8.9 良好口碑", detail: "评分 8.0–8.9，口碑扎实" },
  "7.0-7.9": { title: "7.0-7.9 中等口碑", detail: "评分 7.0–7.9，口碑一般" },
  "6.0-6.9": { title: "6.0-6.9 偏弱口碑", detail: "评分 6.0–6.9，口碑偏弱" },
  "<6.0": { title: "<6.0 低分", detail: "评分低于 6.0，口碑较差" },
  "未开分": { title: "未开分", detail: "尚无有效评分（样本不足或未开分）" }
};

const QUADRANT_GUIDE = [
  {
    quadrant: "蓝海空白",
    tone: "good" as const,
    summary: "供给少、尚无稳定霸主",
    meaning: "该赛道上榜作品很少，竞争格局未定。玩家需求可能存在，但供给尚未挤满。",
    axis: "低供给饱和 · 头部尚未形成绝对垄断（样本少时头部占比可能虚高）",
    action: "优先验证：适合差异化切入，先做小体量验证口碑与留存。"
  },
  {
    quadrant: "小而美",
    tone: "mid" as const,
    summary: "供给适中、头部不够极端",
    meaning: "赛道有一定作品量，但热度没有被少数巨头吃干净，仍有细分空间。",
    axis: "中低供给 · 头部占据相对可控",
    action: "可切入：找题材/玩法辨识度，用口碑和完成度打穿细分人群。"
  },
  {
    quadrant: "红海拥挤",
    tone: "bad" as const,
    summary: "供给偏多、同质化风险高",
    meaning: "同类作品已经较多，玩家选择多，新作需要更强卖点才能被看见。",
    axis: "高供给 · 头部未必极端，但整体拥挤",
    action: "谨慎切入：避免跟风仿制，除非有明确差异化或渠道优势。"
  },
  {
    quadrant: "巨头垄断",
    tone: "bad" as const,
    summary: "供给多且热度高度集中",
    meaning: "赛道既卷、又被头部作品拿走大部分曝光，后来者正面硬刚成本很高。",
    axis: "高供给饱和 · 高头部占据",
    action: "不建议正面切入：除非换赛道切口，或做巨头覆盖不到的边缘需求。"
  }
];

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function quadrantClass(quadrant: string): string {
  if (quadrant === "巨头垄断" || quadrant === "红海拥挤") return "radar-bad";
  if (quadrant === "蓝海空白") return "radar-good";
  return "radar-mid";
}

function matchesQuery(entry: RadarGameEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    entry.title,
    entry.author,
    entry.tags.join(" "),
    entry.board,
    String(entry.id),
    entry.authorId != null ? String(entry.authorId) : ""
  ].join(" ").toLowerCase();
  return needle.split(/\s+/).every((part) => haystack.includes(part));
}

function radarIconSrc(apiBase: string, iconUrl?: string): string | undefined {
  if (!iconUrl) return undefined;
  return `${apiBase}/api/tools/new-game-radar/icon?url=${encodeURIComponent(iconUrl)}`;
}

interface ChartDatum {
  label: string;
  value: number;
  note?: string;
  detail?: string;
}

function chartTooltipText(item: ChartDatum, total: number): string {
  const percent = total > 0 ? Math.round((item.value / total) * 100) : 0;
  return [item.label, item.detail, `数量 ${item.value}`, `占比 ${percent}%`, item.note]
    .filter(Boolean)
    .join("\n");
}

interface ChartHandlers {
  onShowTip: (event: MouseEvent<HTMLElement>, item: ChartDatum, total: number) => void;
  onHideTip: () => void;
}

function RadarHBarChart({ title, data, onShowTip, onHideTip }: { title: string; data: ChartDatum[] } & ChartHandlers) {
  const max = Math.max(1, ...data.map((item) => item.value));
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <section className="radar-chart-card" aria-label={title}>
      <h4>{title}</h4>
      <div className="radar-bars">
        {data.map((item, index) => (
          <div
            key={item.label}
            className="radar-bar-row"
            onMouseEnter={(event) => onShowTip(event, item, total)}
            onMouseMove={(event) => onShowTip(event, item, total)}
            onMouseLeave={onHideTip}
          >
            <span className="radar-bar-label">{item.label}</span>
            <div className="radar-bar-track">
              <i style={{ width: `${(item.value / max) * 100}%`, background: CHART_COLORS[index % CHART_COLORS.length] }} />
            </div>
            <em>
              {item.value} 条 · {total ? Math.round((item.value / total) * 100) : 0}%
              {item.note ? ` · ${item.note}` : ""}
            </em>
          </div>
        ))}
      </div>
    </section>
  );
}

function RadarBarChart({ title, data, onShowTip, onHideTip }: { title: string; data: ChartDatum[] } & ChartHandlers) {
  const max = Math.max(1, ...data.map((item) => item.value));
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <section className="radar-chart-card" aria-label={title}>
      <h4>{title}</h4>
      <div className="radar-vbar-chart">
        {data.map((item, index) => (
          <div
            key={item.label}
            className="radar-vbar-col"
            onMouseEnter={(event) => onShowTip(event, item, total)}
            onMouseMove={(event) => onShowTip(event, item, total)}
            onMouseLeave={onHideTip}
          >
            <strong>{item.value}</strong>
            <div className="radar-vbar-track">
              <i style={{ height: `${(item.value / max) * 100}%`, background: CHART_COLORS[index % CHART_COLORS.length] }} />
            </div>
            <span>{item.label}</span>
            {item.note && <em>{item.note}</em>}
          </div>
        ))}
      </div>
    </section>
  );
}

function RadarDonutChart({ title, data, onShowTip, onHideTip }: { title: string; data: ChartDatum[] } & ChartHandlers) {
  const total = data.reduce((sum, item) => sum + item.value, 0) || 1;
  const radius = 64;
  const stroke = 22;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <section className="radar-chart-card" aria-label={title}>
      <h4>{title}</h4>
      <div className="radar-donut-wrap">
        <svg className="radar-donut-svg" viewBox="0 0 180 180" role="img">
          <circle cx="90" cy="90" r={radius} fill="none" stroke="#1a2230" strokeWidth={stroke} />
          {data.map((item, index) => {
            const length = (item.value / total) * circumference;
            const dash = `${length} ${circumference - length}`;
            const node = (
              <circle
                key={item.label}
                cx="90"
                cy="90"
                r={radius}
                fill="none"
                stroke={CHART_COLORS[index % CHART_COLORS.length]}
                strokeWidth={stroke}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                transform="rotate(-90 90 90)"
                className="radar-donut-seg"
                onMouseEnter={(event) => onShowTip(event as unknown as MouseEvent<HTMLElement>, item, total)}
                onMouseMove={(event) => onShowTip(event as unknown as MouseEvent<HTMLElement>, item, total)}
                onMouseLeave={onHideTip}
              />
            );
            offset += length;
            return node;
          })}
          <text x="90" y="86" textAnchor="middle" className="radar-donut-center-value">{total}</text>
          <text x="90" y="104" textAnchor="middle" className="radar-donut-center-label">合计</text>
        </svg>
        <ul className="radar-donut-legend">
          {data.map((item, index) => (
            <li
              key={item.label}
              onMouseEnter={(event) => onShowTip(event, item, total)}
              onMouseMove={(event) => onShowTip(event, item, total)}
              onMouseLeave={onHideTip}
            >
              <i style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
              <span>{item.label}</span>
              <em>{item.value}{item.note ? ` · ${item.note}` : ""} · {Math.round((item.value / total) * 100)}%</em>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function NewGameRadarPanel({ apiBase, onClose, onOpenExternal }: NewGameRadarPanelProps) {
  const [snapshot, setSnapshot] = useState<RadarSnapshot | null>(null);
  const [busy, setBusy] = useState<"load" | "refresh" | "offline" | null>("load");
  const [message, setMessage] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>("list");
  const [analysisSub, setAnalysisSub] = useState<AnalysisSub>("tracks");
  const [vizSub, setVizSub] = useState<VizSub>("distribution");
  const [boardFilter, setBoardFilter] = useState<BoardFilter>("heat");
  const [chartStyle, setChartStyle] = useState<ChartStyle>("hbar");
  const [query, setQuery] = useState("");
  const [hoverTip, setHoverTip] = useState<{ text: string; x: number; y: number } | null>(null);

  const applySnapshot = useCallback((next: RadarSnapshot) => {
    setSnapshot(next);
    if (next.error) setMessage(`已回退离线快照：${next.error}`);
    else setMessage(null);
  }, []);

  const load = useCallback(async (action: "auto" | "refresh" | "offline") => {
    setBusy(action === "auto" ? "load" : action);
    setMessage(null);
    try {
      const response = await fetch(`${apiBase}/api/tools/new-game-radar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const data = await response.json() as { snapshot?: RadarSnapshot; error?: string };
      if (!data.snapshot) throw new Error(data.error || `HTTP ${response.status}`);
      applySnapshot(data.snapshot);
      if (!response.ok && data.error) setMessage(data.error);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }, [apiBase, applySnapshot]);

  useEffect(() => {
    markNewGameRadarSeen();
    void load("auto");
  }, [load]);

  const activeBoard = useMemo(() => {
    if (!snapshot) return null;
    if (boardFilter === "heat") return snapshot.boards.find((board) => board.id === "heat") || null;
    if (boardFilter === "rising") return snapshot.boards.find((board) => board.id === "rising") || null;
    return null;
  }, [snapshot, boardFilter]);

  const filteredEntries = useMemo(() => {
    if (!snapshot) return [];
    const source = activeBoard?.entries || snapshot.entries;
    return source.filter((entry) => matchesQuery(entry, query));
  }, [snapshot, activeBoard, query]);

  const scoreChartData = useMemo<ChartDatum[]>(() => {
    if (!snapshot) return [];
    const buckets = (snapshot.scoreBuckets || []).map((bucket) => {
      const meta = SCORE_BUCKET_META[bucket.label];
      const item: ChartDatum = {
        label: meta?.title || bucket.label,
        value: bucket.count,
        detail: meta?.detail || `评分区间 ${bucket.label}`
      };
      return item;
    });
    const unrated = snapshot.entries.filter((entry) => entry.score == null).length;
    if (unrated > 0) {
      const meta = SCORE_BUCKET_META["未开分"]!;
      buckets.push({
        label: meta.title,
        value: unrated,
        detail: meta.detail
      });
    }
    return buckets;
  }, [snapshot]);
  const supplyChartData = useMemo<ChartDatum[]>(
    () => [...(snapshot?.tracks || [])]
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((row) => {
        const item: ChartDatum = {
          label: row.track,
          value: row.count,
          detail: `${row.quadrant} · ${row.lifecycle} · 机会指数 ${row.opportunity}`
        };
        if (row.avgScore != null) item.note = `均分 ${row.avgScore}`;
        return item;
      }),
    [snapshot]
  );

  const showChartTip = useCallback((event: MouseEvent<HTMLElement>, item: ChartDatum, total: number) => {
    const host = (event.currentTarget as HTMLElement).closest(".radar-panel");
    const hostRect = host?.getBoundingClientRect();
    const x = event.clientX - (hostRect?.left || 0) + 12;
    const y = event.clientY - (hostRect?.top || 0) + 12;
    setHoverTip({ text: chartTooltipText(item, total), x, y });
  }, []);
  const hideChartTip = useCallback(() => setHoverTip(null), []);

  const openGame = (entry: RadarGameEntry) => {
    const url = entry.url || (entry.id > 0 ? `https://www.taptap.cn/app/${entry.id}` : "");
    if (url) onOpenExternal(url);
  };

  const openAuthor = (entry: RadarGameEntry) => {
    const url = entry.authorUrl
      || (entry.authorId != null ? `https://www.taptap.cn/developer/${entry.authorId}` : "");
    if (url) onOpenExternal(url);
  };

  const showRisingScore = boardFilter === "rising";

  return (
    <section className="overlay-panel panel tools-panel radar-panel" aria-label="新游雷达">
      <div className="overlay-heading">
        <strong><Radar size={15} aria-hidden="true" />工具集 · 新游雷达</strong>
        <button type="button" aria-label="关闭" onClick={onClose}><X size={14} />关闭</button>
      </div>

      <div className="radar-shell">
        <header className="radar-header">
          <div>
            <h3>TapTap 制造新游雷达</h3>
            <p>
              TapTap 制造榜 · {snapshot ? formatDate(snapshot.fetchedAt) : "—"} ·{" "}
              {snapshot ? `${snapshot.boardCount} 榜 / ${snapshot.entryCount} 条` : "加载中"} ·{" "}
              {snapshot?.source === "live" ? "在线" : "离线快照"}
              {query.trim() || boardFilter !== "all" ? ` · 当前 ${filteredEntries.length} 条` : ""}
            </p>
          </div>
          <div className="radar-actions">
            <button type="button" disabled={busy != null} onClick={() => void load("offline")}>离线快照</button>
            <button type="button" className="primary" disabled={busy != null} onClick={() => void load("refresh")}>
              <RefreshCw size={13} />{busy === "refresh" ? "获取中…" : "获取最新排行"}
            </button>
          </div>
        </header>

        <label className="radar-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder="搜索游戏名 / 开发者 / 标签"
            onChange={(event) => {
              setQuery(event.target.value);
              if (event.target.value.trim()) setMainTab("list");
            }}
          />
          {query && (
            <button type="button" className="radar-search-clear" aria-label="清空搜索" onClick={() => setQuery("")}>
              <X size={12} />
            </button>
          )}
        </label>

        <nav className="radar-tabs" aria-label="主视图">
          {([
            ["list", "榜单明细"],
            ["insight", "雷达洞察"],
            ["analysis", "分析台"],
            ["viz", "可视化"]
          ] as const).map(([id, label]) => (
            <button key={id} type="button" className={mainTab === id ? "active" : ""} onClick={() => setMainTab(id)}>
              {label}
            </button>
          ))}
        </nav>

        {message && <p className="radar-message">{message}</p>}

        {busy === "load" && !snapshot ? <p className="radar-message">正在加载榜单…</p> : null}

        {snapshot && mainTab === "list" && (
          <>
            <nav className="radar-subtabs" aria-label="榜单类型">
              <button type="button" className={boardFilter === "heat" ? "active" : ""} onClick={() => setBoardFilter("heat")}>热度榜</button>
              <button type="button" className={boardFilter === "rising" ? "active" : ""} onClick={() => setBoardFilter("rising")}>新锐榜</button>
              <button type="button" className={boardFilter === "all" ? "active" : ""} onClick={() => setBoardFilter("all")}>全部样本</button>
            </nav>
            {activeBoard?.description && <p className="radar-footnote">{activeBoard.description}</p>}
            {boardFilter === "all" && <p className="radar-footnote">全部样本用于赛道分析；热度榜按曝光排序；新锐榜按「口碑² × 热度对数 × 评论可信度」，并对超高热度做抑制。</p>}
            <div className="radar-table-wrap">
              <table className="radar-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>游戏</th>
                    <th>作者</th>
                    <th>标签</th>
                    <th>热度</th>
                    <th>评分</th>
                    {showRisingScore && <th>新锐分</th>}
                    <th>评论</th>
                    <th>榜单</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.length === 0 ? (
                    <tr><td colSpan={showRisingScore ? 9 : 8}>没有匹配「{query || "当前榜单"}」的游戏或开发者</td></tr>
                  ) : filteredEntries.map((entry) => (
                    <tr key={`${entry.board}-${entry.id}-${entry.rank}`}>
                      <td>{entry.rank}</td>
                      <td>
                        <div className="radar-game-cell">
                          {radarIconSrc(apiBase, entry.iconUrl) ? (
                            <button type="button" className="radar-icon-btn" title="打开游戏页" onClick={() => openGame(entry)}>
                              <img
                                src={radarIconSrc(apiBase, entry.iconUrl)}
                                alt=""
                                className="radar-icon"
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                onError={(event) => {
                                  const target = event.currentTarget;
                                  target.style.display = "none";
                                  const fallback = target.parentElement?.querySelector(".radar-icon-fallback");
                                  if (fallback instanceof HTMLElement) fallback.hidden = false;
                                }}
                              />
                              <span className="radar-icon radar-icon-fallback" hidden aria-hidden="true" />
                            </button>
                          ) : (
                            <span className="radar-icon radar-icon-fallback" aria-hidden="true" />
                          )}
                          <div>
                            <button type="button" className="radar-link" onClick={() => openGame(entry)}>
                              <strong>{entry.title}</strong>
                            </button>
                            {entry.labels.length > 0 && <small className="radar-labels">{entry.labels.join(" · ")}</small>}
                          </div>
                        </div>
                      </td>
                      <td>
                        {entry.authorUrl || entry.authorId != null ? (
                          <button type="button" className="radar-link" onClick={() => openAuthor(entry)}>{entry.author}</button>
                        ) : entry.author}
                      </td>
                      <td>{entry.tags.join(" / ") || "—"}</td>
                      <td>{entry.hits}</td>
                      <td>{entry.score ?? "—"}</td>
                      {showRisingScore && <td>{entry.risingScore ?? "—"}</td>}
                      <td>{entry.reviewCount}</td>
                      <td>{entry.board}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {snapshot && mainTab === "insight" && (
          <div className="radar-insight">
            <section>
              <h4>机会 Top3</h4>
              <ol>
                {snapshot.tracks.slice(0, 3).map((row) => (
                  <li key={row.track}>
                    <strong className={quadrantClass(row.quadrant)}>{row.track}</strong>
                    <span>机会 {row.opportunity} · {row.quadrant} · {row.suggestion}</span>
                  </li>
                ))}
              </ol>
            </section>
            <section>
              <h4>拥挤赛道</h4>
              <ol>
                {[...snapshot.tracks].sort((a, b) => b.supplySaturation - a.supplySaturation).slice(0, 3).map((row) => (
                  <li key={row.track}>
                    <strong className={quadrantClass(row.quadrant)}>{row.track}</strong>
                    <span>供给 {row.supplySaturation.toFixed(2)} · 头部 {row.headOccupancy.toFixed(2)} · {row.suggestion}</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}

        {snapshot && mainTab === "analysis" && (
          <>
            <nav className="radar-subtabs" aria-label="分析子视图">
              <button type="button" className={analysisSub === "opportunity" ? "active" : ""} onClick={() => setAnalysisSub("opportunity")}>机会分排行</button>
              <button type="button" className={analysisSub === "tracks" ? "active" : ""} onClick={() => setAnalysisSub("tracks")}>赛道竞争</button>
            </nav>

            <section className="radar-quadrant-guide" aria-label="象限说明">
              <div className="radar-quadrant-guide-head">
                <h4>象限说明</h4>
                <p>横轴 = 供给饱和（赛道作品量相对最高赛道），纵轴 = 头部占据（第一名热度 / 赛道热度总和）。</p>
              </div>
              <div className="radar-quadrant-grid">
                {QUADRANT_GUIDE.map((item) => (
                  <article key={item.quadrant} className={`radar-quadrant-card radar-${item.tone}`}>
                    <strong className={quadrantClass(item.quadrant)}>{item.quadrant}</strong>
                    <em>{item.summary}</em>
                    <p>{item.meaning}</p>
                    <small>坐标含义：{item.axis}</small>
                    <small>建议：{item.action}</small>
                  </article>
                ))}
              </div>
            </section>

            <div className="radar-table-wrap">
              <table className="radar-table">
                <thead>
                  <tr>
                    <th>赛道</th>
                    <th>象限</th>
                    <th>生命周期</th>
                    <th>条数</th>
                    <th>供给饱和</th>
                    <th>头部占据</th>
                    <th>平滑占据</th>
                    <th>均分</th>
                    <th>机会指数</th>
                    <th>建议</th>
                  </tr>
                </thead>
                <tbody>
                  {(analysisSub === "opportunity"
                    ? [...snapshot.tracks].sort((a, b) => b.opportunity - a.opportunity)
                    : [...snapshot.tracks].sort((a, b) => b.count - a.count)
                  ).map((row) => (
                    <tr key={row.track}>
                      <td>{row.track}</td>
                      <td className={quadrantClass(row.quadrant)}>{row.quadrant}</td>
                      <td>{row.lifecycle}</td>
                      <td>{row.count}</td>
                      <td>{row.supplySaturation.toFixed(2)}</td>
                      <td>{row.headOccupancy.toFixed(2)}</td>
                      <td>{row.smoothOccupancy.toFixed(2)}</td>
                      <td>{row.avgScore ?? "—"}</td>
                      <td><strong>{row.opportunity}</strong></td>
                      <td className={quadrantClass(row.quadrant)}>{row.suggestion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="radar-footnote">样本过少的赛道仍会展示，建议结合榜单明细人工复核。</p>
          </>
        )}

        {snapshot && mainTab === "viz" && (
          <>
            <nav className="radar-subtabs" aria-label="可视化子视图">
              <button type="button" className={vizSub === "distribution" ? "active" : ""} onClick={() => setVizSub("distribution")}>分布结构</button>
              <button type="button" className={vizSub === "supply" ? "active" : ""} onClick={() => setVizSub("supply")}>赛道供给</button>
            </nav>
            <nav className="radar-subtabs" aria-label="图表样式">
              <button type="button" className={chartStyle === "hbar" ? "active" : ""} onClick={() => setChartStyle("hbar")}>横向条形</button>
              <button type="button" className={chartStyle === "vbar" ? "active" : ""} onClick={() => setChartStyle("vbar")}>柱状图</button>
              <button type="button" className={chartStyle === "donut" ? "active" : ""} onClick={() => setChartStyle("donut")}>环形图</button>
            </nav>
            {vizSub === "distribution" && (
              chartStyle === "hbar"
                ? <RadarHBarChart title="评分分布 · 横向条形" data={scoreChartData} onShowTip={showChartTip} onHideTip={hideChartTip} />
                : chartStyle === "vbar"
                  ? <RadarBarChart title="评分分布 · 柱状图" data={scoreChartData} onShowTip={showChartTip} onHideTip={hideChartTip} />
                  : <RadarDonutChart title="评分分布 · 环形图" data={scoreChartData} onShowTip={showChartTip} onHideTip={hideChartTip} />
            )}
            {vizSub === "supply" && (
              chartStyle === "hbar"
                ? <RadarHBarChart title="赛道供给量 · 横向条形" data={supplyChartData} onShowTip={showChartTip} onHideTip={hideChartTip} />
                : chartStyle === "vbar"
                  ? <RadarBarChart title="赛道供给量 · 柱状图" data={supplyChartData} onShowTip={showChartTip} onHideTip={hideChartTip} />
                  : <RadarDonutChart title="赛道供给量 · 环形图" data={supplyChartData} onShowTip={showChartTip} onHideTip={hideChartTip} />
            )}
            <p className="radar-footnote">鼠标悬停任意图段可查看名称与详情。评分分布含「未开分」样本。</p>
          </>
        )}
        {hoverTip && (
          <div className="radar-chart-tooltip" style={{ left: hoverTip.x, top: hoverTip.y }} role="tooltip">
            {hoverTip.text.split("\n").map((line) => <div key={line}>{line}</div>)}
          </div>
        )}
      </div>
    </section>
  );
}
