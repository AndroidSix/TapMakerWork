import { useCallback, useEffect, useState } from "react";
import { Copy, ExternalLink, FolderOpen, Image as ImageIcon, RefreshCw, X } from "lucide-react";

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

interface CompressRunResult {
  ok: boolean;
  target: string;
  total: number;
  compressed: number;
  skipped: number;
  failed: number;
  savedBytes: number;
  aiCopyText: string;
  error?: string;
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
  const [busy, setBusy] = useState<"load" | "save" | "run" | null>(null);
  const [result, setResult] = useState<CompressRunResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
    setBusy("run");
    setMessage(null);
    setResult(null);
    try {
      const response = await fetch(`${apiBase}/api/tools/image-compress`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "run",
          target: target.trim(),
          projectRoot,
          recursive: true
        })
      });
      const data = await response.json() as CompressRunResult & { error?: string };
      if (!response.ok && !data.aiCopyText) throw new Error(data.error || `HTTP ${response.status}`);
      setResult(data);
      if (data.error) setMessage(data.error);
      else setMessage(`完成：压缩 ${data.compressed} / 扫描 ${data.total}，节省 ${formatBytes(data.savedBytes)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }, [apiBase, projectRoot, target]);

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
          <button
            type="button"
            className="primary"
            disabled={busy === "run"}
            onClick={() => void runCompress()}
          >
            {busy === "run" ? "压缩中…" : "开始压缩"}
          </button>
          <span className="desktop-card-note">{tinyEnabled ? "优先 Tiny，失败回退本地" : "使用本地压缩（无需 Tiny）"}</span>
        </div>
      </section>

      {message && <p className="image-compress-message">{message}</p>}

      {result && (
        <section className="image-compress-card">
          <h4>压缩结果</h4>
          <p>扫描 {result.total} · 压缩 {result.compressed} · 跳过 {result.skipped} · 失败 {result.failed} · 节省 {formatBytes(result.savedBytes || 0)}</p>
          <div className="tips-copy-preview">
            <pre className="tips-copy-text">{result.aiCopyText}</pre>
          </div>
          <button type="button" className="primary tips-copy" onClick={() => void onCopy(result.aiCopyText)}>
            <Copy size={13} />复制给 AI（分批提交）
          </button>
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
