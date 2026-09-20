import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink, Image as ImageIcon, MonitorPlay, RefreshCw, Save } from "lucide-react";
import type { PreviewPanelState } from "@tapmakerwork/protocol";

const API = "http://127.0.0.1:43121";

export function isEmbeddableGamePreview(url: string): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (/\.(png|jpe?g|gif|webp|svg|bmp)(\?|#|$)/i.test(url)) return false;
  if (/\/qrco|qrcode|qr-code|test_qrcode|\/qr\//i.test(url)) return false;
  return true;
}

export interface PreviewDockProps {
  panel: PreviewPanelState | undefined;
  projectName: string;
  desktopAvailable: boolean;
  compact?: boolean;
  runtimeLive?: boolean;
  onChanged: (panel: PreviewPanelState) => void;
  onLog: (line: string) => void;
  onToast: (message: string, kind?: "info" | "success" | "error" | "warn") => void;
  onOpenExternal: (url: string) => void;
}

export function PreviewDock({
  panel,
  projectName,
  desktopAvailable,
  compact = false,
  runtimeLive = false,
  onChanged,
  onLog,
  onToast,
  onOpenExternal
}: PreviewDockProps) {
  const [urlDraft, setUrlDraft] = useState(panel?.url || "");
  const [busy, setBusy] = useState<"save" | "refresh" | "shot" | "">("");
  const [shots, setShots] = useState<Array<{ path: string; bytes: number }>>([]);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const transport = panel?.transport || "auto";
  const url = panel?.url || "";
  const embeddable = isEmbeddableGamePreview(url);
  const useNative = desktopAvailable && Boolean(window.tapMakerWork?.preview) && transport !== "iframe" && embeddable;
  const reloadToken = panel?.reloadToken ?? 0;

  useEffect(() => setUrlDraft(panel?.url || ""), [panel?.url]);

  const loadShots = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/preview/panel/shots`);
      const result = await response.json() as { shots?: Array<{ path: string; bytes: number }> };
      setShots(result.shots ?? []);
    } catch {
      setShots([]);
    }
  }, []);

  useEffect(() => { void loadShots(); }, [loadShots]);

  const mountNative = useCallback(async () => {
    if (!useNative || !url || !frameRef.current) return;
    const rect = frameRef.current.getBoundingClientRect();
    const result = await window.tapMakerWork!.preview!.mount({
      url,
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      orientation: panel?.orientation || "portrait"
    });
    if (!result.ok) onToast(`桌面预览挂载失败：${result.error || "unknown"}`, "error");
  }, [useNative, url, panel?.orientation, onToast]);

  useEffect(() => {
    if (!useNative) {
      void window.tapMakerWork?.preview?.unmount();
      return;
    }
    void mountNative();
    return () => { void window.tapMakerWork?.preview?.unmount(); };
  }, [useNative, mountNative, reloadToken]);

  useEffect(() => {
    if (!useNative || !reloadToken) return;
    void window.tapMakerWork?.preview?.reload();
  }, [useNative, reloadToken]);

  const saveSettings = useCallback(async (patch: Partial<PreviewPanelState>) => {
    setBusy("save");
    try {
      const response = await fetch(`${API}/api/preview/panel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch)
      });
      const result = await response.json() as { panel?: PreviewPanelState; error?: string };
      if (!response.ok || !result.panel) throw new Error(result.error || "保存预览设置失败");
      onChanged(result.panel);
      onToast("预览设置已保存", "success");
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy("");
    }
  }, [onChanged, onToast]);

  const reloadPreview = useCallback(async (withMaker = false) => {
    setBusy("refresh");
    try {
      const response = await fetch(`${API}/api/preview/panel/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maker: withMaker })
      });
      const result = await response.json() as { panel?: PreviewPanelState; makerRefresh?: { error?: string }; error?: string };
      if (!response.ok || !result.panel) throw new Error(result.error || "刷新预览失败");
      onChanged(result.panel);
      if (result.makerRefresh?.error) onLog(`Maker refresh 失败：${result.makerRefresh.error}`);
      else onLog(withMaker ? "已刷新预览 + Maker" : "已刷新预览");
      if (!useNative && embeddable) iframeRef.current?.contentWindow?.location.reload();
      onToast("预览已刷新", "success");
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy("");
    }
  }, [onChanged, onLog, onToast, useNative, embeddable]);

  const captureShot = useCallback(async () => {
    setBusy("shot");
    try {
      let dataUrl: string | undefined;
      if (useNative) {
        const result = await window.tapMakerWork!.preview!.capture();
        if (!result.ok || !result.dataUrl) throw new Error(result.error || "桌面截帧失败");
        dataUrl = result.dataUrl;
      }
      const response = await fetch(`${API}/api/preview/panel/shot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataUrl, note: "panel" })
      });
      const result = await response.json() as { ok?: boolean; path?: string; panel?: PreviewPanelState; error?: string; hint?: string };
      if (result.panel) onChanged(result.panel);
      if (result.path) {
        onLog(`预览证据：${result.path}`);
        onToast("截图已保存", "success");
        void loadShots();
      } else {
        onToast(result.hint || result.error || "当前环境无法截图", "warn");
      }
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy("");
    }
  }, [useNative, onChanged, onLog, onToast, loadShots]);

  return (
    <div className={`preview-dock ${compact ? "compact" : ""}`}>
      <div className="preview-toolbar">
        <label className="preview-url">
          <span>URL</span>
          <input
            value={urlDraft}
            onChange={(event) => setUrlDraft(event.target.value)}
            placeholder="游戏预览地址（非二维码）"
            spellCheck={false}
          />
        </label>
        <button className="icon-command" aria-label="保存 URL" disabled={busy === "save"} onClick={() => void saveSettings({ url: urlDraft })}><Save size={13} /></button>
        <Tip label="回退到 Maker test_qrcode.url（多为扫码链接，不能当游戏流）">
          <button className="icon-command" aria-label="使用项目二维码链接" onClick={() => void saveSettings({ url: "" })}><MonitorPlay size={13} /></button>
        </Tip>
        <label className="preview-orient">
          <select value={panel?.orientation || "portrait"} onChange={(e) => void saveSettings({ orientation: e.target.value as "portrait" | "landscape" })}>
            <option value="portrait">竖</option>
            <option value="landscape">横</option>
          </select>
        </label>
        {!compact && (
          <label>
            通道
            <select value={transport} onChange={(e) => void saveSettings({ transport: e.target.value as PreviewPanelState["transport"] })}>
              <option value="auto">自动</option>
              <option value="iframe">iframe</option>
              <option value="webcontentsview">桌面 View</option>
            </select>
          </label>
        )}
        <label className="preview-toggle" title="写 ui.json 后刷新右侧预览">
          <input type="checkbox" checked={panel?.autoRefreshIframe ?? true} onChange={(e) => void saveSettings({ autoRefreshIframe: e.target.checked })} />
          自动刷新
        </label>
        <label className="preview-toggle" title="写 ui.json 后调用官方 preview refresh（较重）">
          <input type="checkbox" checked={panel?.autoRefreshMaker ?? false} onChange={(e) => void saveSettings({ autoRefreshMaker: e.target.checked })} />
          Maker
        </label>
        <button className="icon-command" aria-label="刷新" disabled={busy === "refresh"} onClick={() => void reloadPreview(false)}><RefreshCw size={13} /></button>
        <button className="icon-command" aria-label="截图" disabled={busy === "shot"} onClick={() => void captureShot()}><ImageIcon size={13} /></button>
        <button className="icon-command" aria-label="外部打开" disabled={!url} onClick={() => url && onOpenExternal(url)}><ExternalLink size={13} /></button>
      </div>
      <div className="preview-stage" ref={frameRef}>
        {(runtimeLive || (!embeddable && url)) && (
          <div className="runtime-live-banner">
            <strong>{runtimeLive ? "Runtime 已连接" : "预览说明"}</strong>
            <p>
              {runtimeLive
                ? "这是 Web 预览通道，不代表独立 Runtime 的最终画面；请切到“真实运行”查看系统窗口采样。"
                : "当前 URL 不是可交互游戏流。编辑请使用设计画布，最终效果以“真实运行”为准。"}
            </p>
          </div>
        )}
        {!url ? (
          <div className="empty-state preview-empty">
            <strong>实时预览</strong>
            <p>此处只嵌入 Web 游戏流；Maker 独立运行器请切到 <b>真实运行</b>。</p>
            <p className="muted">项目 {projectName || "—"} · {desktopAvailable ? "桌面通道可用" : "iframe 模式"}{runtimeLive ? " · Runtime 已连接" : ""}</p>
          </div>
        ) : !embeddable ? (
          <div className="preview-fallback">
            <div className="preview-fallback-card slim">
              <strong>测试二维码 / 非游戏流</strong>
              <code>{url}</code>
              <div className="overlay-row">
                <button onClick={() => onOpenExternal(url)}>外部打开</button>
              </div>
            </div>
          </div>
        ) : useNative ? (
          <div className="preview-native-placeholder">
            <span>桌面 WebContentsView 已挂载</span>
            <small>{url}</small>
          </div>
        ) : (
          <iframe
            key={`${reloadToken}`}
            ref={iframeRef}
            title="TapTap Maker 预览"
            src={url}
            className={`preview-frame orientation-${panel?.orientation || "portrait"}`}
            allow="autoplay; clipboard-read; clipboard-write; fullscreen"
            referrerPolicy="no-referrer"
          />
        )}
      </div>
      {!compact && shots.length > 0 && (
        <div className="preview-shots">
          <span>证据</span>
          {shots.slice(0, 4).map((shot) => (
            <code key={shot.path} title={shot.path}>{shot.path.split("/").slice(-2).join("/")}</code>
          ))}
        </div>
      )}
    </div>
  );
}

function Tip({ label, children }: { label: string; children: ReactNode }) {
  return <span className="tip-wrap" data-tip={label}>{children}</span>;
}
