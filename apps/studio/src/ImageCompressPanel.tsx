import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, FolderOpen, Image as ImageIcon, Loader2, RefreshCw, Square, X } from "lucide-react";

interface CompressSettings {
  tinyEnabled: boolean;
  useWebFallback: boolean;
  keyCount: number;
  keysConfigured: boolean;
  configDir: string;
  tinypngDevelopersUrl: string;
  localEngines?: { label: string };
  localInstallHint?: string;
}

interface CompressFileResult {
  path: string;
  success: boolean;
  skipped?: boolean;
  engine?: string;
  beforeBytes?: number;
  afterBytes?: number;
  durationMs?: number;
  error?: string;
}

interface CompressJob {
  ok: boolean;
  state: "running" | "done" | "failed" | "cancelled";
  target: string;
  total: number;
  processed: number;
  current?: string;
  compressed: number;
  skipped: number;
  failed: number;
  savedBytes: number;
  engine: string;
  files: CompressFileResult[];
  aiCopyText: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

type FileFilter = "all" | "compressed" | "skipped" | "failed";

const JOB_STATE_LABEL: Record<CompressJob["state"], string> = {
  running: "压缩中",
  done: "已完成",
  failed: "失败",
  cancelled: "已停止"
};

const POLL_INTERVAL_MS = 500;

function relativeTo(root: string, filePath: string): string {
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedPath = filePath.replace(/\\/g, "/");
  return normalizedPath.startsWith(`${normalizedRoot}/`) ? normalizedPath.slice(normalizedRoot.length + 1) : normalizedPath;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function fileStatus(file: CompressFileResult): Exclude<FileFilter, "all"> {
  if (file.success) return "compressed";
  return file.skipped ? "skipped" : "failed";
}

function fileDetail(file: CompressFileResult): string {
  if (file.error) return file.error;
  const before = file.beforeBytes ?? 0;
  const after = file.afterBytes ?? before;
  if (file.skipped) return `${formatBytes(before)} · 已是最优，未改动`;
  const ratio = before > 0 ? Math.round((1 - after / before) * 100) : 0;
  return `${formatBytes(before)} → ${formatBytes(after)}（-${ratio}%）`;
}

interface ImageCompressPanelProps {
  apiBase: string;
  projectRoot?: string;
  onClose?: () => void;
  onCopy: (text: string) => void | Promise<void>;
  onOpenExternal: (url: string) => void;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

export function ImageCompressPanel({ apiBase, projectRoot, onClose, onCopy, onOpenExternal }: ImageCompressPanelProps) {
  const [settings, setSettings] = useState<CompressSettings | null>(null);
  const [keysText, setKeysText] = useState("");
  const [tinyEnabled, setTinyEnabled] = useState(false);
  const [useWebFallback, setUseWebFallback] = useState(true);
  const [target, setTarget] = useState("");
  const [defaultTarget, setDefaultTarget] = useState("");
  const [busy, setBusy] = useState<"load" | "save" | null>(null);
  const [job, setJob] = useState<CompressJob | null>(null);
  const [fileFilter, setFileFilter] = useState<FileFilter>("all");
  const [now, setNow] = useState(() => Date.now());
  const [message, setMessage] = useState<string | null>(null);
  const running = job?.state === "running";

  const fetchJob = useCallback(async () => {
    const response = await fetch(`${apiBase}/api/tools/image-compress/job`);
    if (!response.ok) return;
    const data = await response.json() as { job: CompressJob | null };
    setJob(data.job);
  }, [apiBase]);

  useEffect(() => { void fetchJob().catch(() => undefined); }, [fetchJob]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void fetchJob().catch(() => undefined);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [fetchJob, running]);

  useEffect(() => {
    if (!job || job.state === "running") return;
    if (job.state === "failed") setMessage(job.error || "压缩失败");
    else setMessage(`${JOB_STATE_LABEL[job.state]}：压缩 ${job.compressed} / 扫描 ${job.total}，节省 ${formatBytes(job.savedBytes)}`);
  }, [job?.state, job?.startedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setBusy("load");
    setMessage(null);
    try {
      const query = projectRoot ? `?projectRoot=${encodeURIComponent(projectRoot)}` : "";
      const response = await fetch(`${apiBase}/api/tools/image-compress${query}`);
      const data = await response.json() as {
        settings: CompressSettings;
        keysText?: string;
        defaultTarget?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setSettings(data.settings);
      setKeysText(data.keysText || "");
      setTinyEnabled(Boolean(data.settings.tinyEnabled));
      setUseWebFallback(data.settings.useWebFallback !== false);
      const nextTarget = data.defaultTarget || (projectRoot ? `${projectRoot}/assets` : "");
      setDefaultTarget(nextTarget);
      setTarget((current) => current || nextTarget);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }, [apiBase, projectRoot]);

  useEffect(() => { void load(); }, [load]);

  const saveSettings = useCallback(async () => {
    setBusy("save");
    setMessage(null);
    try {
      const keys = keysText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
      const response = await fetch(`${apiBase}/api/tools/image-compress`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "save-settings",
          tinyEnabled,
          useWebFallback,
          tinyKeys: keys
        })
      });
      const data = await response.json() as { settings: CompressSettings; error?: string };
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setSettings(data.settings);
      setMessage("已保存到本机用户目录（不会写入游戏项目 git）");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }, [apiBase, keysText, tinyEnabled, useWebFallback]);

  const pickDirectory = useCallback(async () => {
    if (window.tapMakerWork?.chooseDirectory) {
      const defaultPath = target || projectRoot;
      const picked = await window.tapMakerWork.chooseDirectory(
        defaultPath
          ? { title: "选择要压缩的图片目录", defaultPath }
          : { title: "选择要压缩的图片目录" }
      );
      if (picked) setTarget(picked);
      return;
    }
    const typed = window.prompt("输入要压缩的目录绝对路径", target || defaultTarget || "");
    if (typed) setTarget(typed.trim());
  }, [defaultTarget, projectRoot, target]);

  const runCompress = useCallback(async () => {
    if (!target.trim()) {
      setMessage("请先选择要压缩的目录");
      return;
    }
    setMessage(null);
    setFileFilter("all");
    try {
      const response = await fetch(`${apiBase}/api/tools/image-compress`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "run", target: target.trim(), recursive: true })
      });
      const data = await response.json() as { job?: CompressJob; error?: string };
      if (data.job) {
        setNow(Date.now());
        setJob(data.job);
      }
      if (!response.ok) setMessage(data.error || `HTTP ${response.status}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [apiBase, target]);

  const cancelCompress = useCallback(async () => {
    await fetch(`${apiBase}/api/tools/image-compress`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "cancel" })
    }).catch(() => undefined);
    setMessage("正在停止：当前图片处理完后停止…");
  }, [apiBase]);

  const visibleFiles = useMemo(() => {
    const files = job?.files ?? [];
    return [...files].reverse().filter((file) => fileFilter === "all" || fileStatus(file) === fileFilter);
  }, [fileFilter, job?.files]);

  const body = (
    <div className="image-compress-panel">
      <header className="tips-category-header">
        <h3><ImageIcon size={15} aria-hidden="true" />图片批量压缩</h3>
        <p>默认用<strong>本地压缩</strong>（无需 Key、无需开启 Tiny）。开启 TinyPNG 后会优先用 Tiny，失败再回退本地。密钥只保存在本机用户目录。</p>
      </header>

      <section className="image-compress-card">
        <h4>本地引擎</h4>
        <p className="desktop-card-note">
          当前：{settings?.localEngines?.label || "内置 Jimp"}
          {settings?.localInstallHint ? ` · ${settings.localInstallHint}` : ""}
        </p>
      </section>

      <section className="image-compress-card">
        <div className="desktop-card-heading">
          <div>
            <h4>TinyPNG（可选增强）</h4>
            <p>不开启也能压缩。开启后效果通常更好；API Key 仍不是必须。</p>
          </div>
        </div>
        <label className="settings-switch-row">
          <span>
            <strong>启用 TinyPNG 优先压缩</strong>
            <small>关闭 = 仅本地压缩。开启后优先 Tiny，失败自动回退本地。</small>
          </span>
          <input type="checkbox" checked={tinyEnabled} onChange={(event) => setTinyEnabled(event.target.checked)} />
        </label>

        {tinyEnabled && (
          <div className="image-compress-optional">
            <p className="image-compress-optional-note">以下为可选项：不填 Key 也能用 Web 回退；填写官方 API Key 通常更稳、效果更好。</p>
            <div className="desktop-card-heading">
              <div>
                <h4>可选：API Key</h4>
                <p>申请地址：tinypng.com/developers（约 500 张/月/Key）</p>
              </div>
              <button type="button" onClick={() => onOpenExternal(settings?.tinypngDevelopersUrl || "https://tinypng.com/developers")}>
                <ExternalLink size={13} />打开官网申请
              </button>
            </div>
            <label className="settings-switch-row">
              <span><strong>允许 Web 回退</strong><small>无 Key 或官方 API 失败时，尝试 tinypng.com Web 接口（仅 png/jpg）。</small></span>
              <input type="checkbox" checked={useWebFallback} onChange={(event) => setUseWebFallback(event.target.checked)} />
            </label>
            <label className="image-compress-keys">
              <span>tiny_keys（可选，每行一个 API Key）</span>
              <textarea
                value={keysText}
                onChange={(event) => setKeysText(event.target.value)}
                placeholder={"# 可选。从 https://tinypng.com/developers 获取\napi_key_1\napi_key_2"}
                rows={5}
                spellCheck={false}
              />
            </label>
          </div>
        )}

        <div className="desktop-card-actions">
          <button type="button" className="primary" disabled={busy === "save"} onClick={() => void saveSettings()}>
            {busy === "save" ? "保存中…" : "保存配置"}
          </button>
          <button type="button" disabled={busy === "load"} onClick={() => void load()}>
            <RefreshCw size={13} />刷新
          </button>
          <small className="desktop-card-note">
            Tiny：{tinyEnabled ? "开" : "关"} · Key：{settings?.keyCount ?? 0} 个
            {settings?.configDir ? ` · ${settings.configDir}` : ""}
          </small>
        </div>
      </section>

      <section className="image-compress-card">
        <h4>压缩目录</h4>
        <p className="desktop-card-note">默认项目内 assets；也可选择其它目录。</p>
        <div className="overlay-row">
          <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder={defaultTarget || "图片目录绝对路径"} />
          <button type="button" onClick={() => void pickDirectory()}><FolderOpen size={13} />选择</button>
          <button type="button" onClick={() => setTarget(defaultTarget)} disabled={!defaultTarget}>恢复默认</button>
        </div>
        <div className="desktop-card-actions">
          <button type="button" className="primary" disabled={running} onClick={() => void runCompress()}>
            {running ? "压缩中…" : "开始压缩"}
          </button>
          {running && (
            <button type="button" onClick={() => void cancelCompress()}><Square size={12} />停止</button>
          )}
          <span className="desktop-card-note">{tinyEnabled ? "优先 Tiny，失败回退本地" : "使用本地压缩（无需 Tiny）"}</span>
        </div>
      </section>

      {message && <p className="image-compress-message">{message}</p>}

      {job && (
        <section className="image-compress-card image-compress-job" aria-live="polite">
          <div className="image-compress-job-head">
            <h4>任务详情</h4>
            <span className={`image-compress-state is-${job.state}`}>
              {running && <Loader2 size={12} className="spin" aria-hidden="true" />}
              {JOB_STATE_LABEL[job.state]}
            </span>
          </div>
          <div
            className="image-compress-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={job.total || 1}
            aria-valuenow={job.processed}
          >
            <i style={{ width: `${job.total ? Math.round((job.processed / job.total) * 100) : running ? 0 : 100}%` }} />
          </div>
          <p className="image-compress-job-meta">
            {job.processed} / {job.total} 张
            {job.total ? ` · ${Math.round((job.processed / job.total) * 100)}%` : ""}
            {` · 用时 ${formatDuration((job.finishedAt ? Date.parse(job.finishedAt) : now) - Date.parse(job.startedAt))}`}
            {job.engine ? ` · ${job.engine}` : ""}
          </p>
          <p className="image-compress-job-meta" title={job.target}>目录：{job.target}</p>
          {job.current && <p className="image-compress-current">正在处理：{relativeTo(job.target, job.current)}</p>}

          <nav className="image-compress-filters" aria-label="按结果筛选">
            {([
              ["all", "全部", job.files.length],
              ["compressed", "已压缩", job.compressed],
              ["skipped", "跳过", job.skipped],
              ["failed", "失败", job.failed]
            ] as const).map(([id, label, count]) => (
              <button key={id} type="button" className={fileFilter === id ? "active" : ""} onClick={() => setFileFilter(id)}>
                {label} {count}
              </button>
            ))}
            <span>节省 {formatBytes(job.savedBytes || 0)}</span>
          </nav>

          <ol className="image-compress-files">
            {visibleFiles.length === 0 ? (
              <li className="image-compress-empty">{running ? "等待第一张图片处理完成…" : "没有符合条件的文件"}</li>
            ) : visibleFiles.map((file) => (
              <li key={file.path} className={`is-${fileStatus(file)}`}>
                <strong title={file.path}>{relativeTo(job.target, file.path)}</strong>
                <span>{fileDetail(file)}</span>
                <small>{[file.engine, file.durationMs != null ? formatDuration(file.durationMs) : ""].filter(Boolean).join(" · ")}</small>
              </li>
            ))}
          </ol>

          {job.state === "done" && job.compressed > 0 && (
            <>
              <div className="tips-copy-preview">
                <pre className="tips-copy-text">{job.aiCopyText}</pre>
              </div>
              <button type="button" className="primary tips-copy" onClick={() => void onCopy(job.aiCopyText)}>
                <Copy size={13} />复制给 AI（分批提交）
              </button>
            </>
          )}
        </section>
      )}
    </div>
  );

  if (!onClose) return body;

  return (
    <section className="overlay-panel panel tools-panel" aria-label="图片压缩">
      <div className="overlay-heading">
        <strong><ImageIcon size={15} aria-hidden="true" />工具集 · 图片压缩</strong>
        <button type="button" aria-label="关闭" onClick={onClose}><X size={14} />关闭</button>
      </div>
      {body}
    </section>
  );
}
