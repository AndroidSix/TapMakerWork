import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ExternalLink, MonitorPlay, RefreshCw, Save } from "lucide-react";
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
  const [busy, setBusy] = useState<"save" | "refresh" | "">("");
  const [runtimeFrame, setRuntimeFrame] = useState<{ dataUrl: string; sourceId?: string; sourceName?: string; width?: number; height?: number }>();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const transport = panel?.transport || "auto";
  const url = panel?.url || "";
  const embeddable = isEmbeddableGamePreview(url);
  const useNative = desktopAvailable && Boolean(window.tapMakerWork?.preview) && transport !== "iframe" && embeddable;
  const reloadToken = panel?.reloadToken ?? 0;

  useEffect(() => setUrlDraft(panel?.url || ""), [panel?.url]);

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
    if (!useNative || !frameRef.current) return;
    const observer = new ResizeObserver(() => { void mountNative(); });
    observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, [mountNative, useNative]);

  useEffect(() => {
    if (!useNative || !reloadToken) return;
    void window.tapMakerWork?.preview?.reload();
  }, [useNative, reloadToken]);

  useEffect(() => {
    const captureRuntime = window.tapMakerWork?.captureRuntime || window.tapMakerWork?.runtime?.capture;
    if (!runtimeLive || embeddable || !captureRuntime) {
      setRuntimeFrame(undefined);
      return;
    }
    let active = true;
    const capture = async () => {
      try {
        const result = await captureRuntime({ projectName, orientation: panel?.orientation || "portrait" });
        if (active && result.ok && result.dataUrl) setRuntimeFrame({
          dataUrl: result.dataUrl,
          ...(result.sourceId ? { sourceId: result.sourceId } : {}),
          ...(result.sourceName ? { sourceName: result.sourceName } : {}),
          ...(result.width ? { width: result.width } : {}),
          ...(result.height ? { height: result.height } : {})
        });
      } catch {
        // The next capture retries while Runtime remains available.
      }
    };
    void capture();
    const timer = window.setInterval(capture, 450);
    return () => { active = false; window.clearInterval(timer); };
  }, [embeddable, panel?.orientation, projectName, runtimeLive]);

  const interactWithRuntime = useCallback(async (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!runtimeFrame?.sourceId || !runtimeFrame.sourceName || !window.tapMakerWork?.runtime?.interact) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const sourceWidth = runtimeFrame.width || bounds.width;
    const sourceHeight = runtimeFrame.height || bounds.height;
    const sourceRatio = sourceWidth / Math.max(1, sourceHeight);
    const boundsRatio = bounds.width / Math.max(1, bounds.height);
    const renderedWidth = boundsRatio > sourceRatio ? bounds.height * sourceRatio : bounds.width;
    const renderedHeight = boundsRatio > sourceRatio ? bounds.height : bounds.width / sourceRatio;
    const renderedLeft = bounds.left + (bounds.width - renderedWidth) / 2;
    const renderedTop = bounds.top + (bounds.height - renderedHeight) / 2;
    const localX = event.clientX - renderedLeft;
    const localY = event.clientY - renderedTop;
    if (localX < 0 || localY < 0 || localX > renderedWidth || localY > renderedHeight) return;
    const result = await window.tapMakerWork.runtime.interact({
      sourceId: runtimeFrame.sourceId,
      sourceName: runtimeFrame.sourceName,
      normalizedX: localX / Math.max(1, renderedWidth),
      normalizedY: localY / Math.max(1, renderedHeight),
      viewportWidth: sourceWidth,
      viewportHeight: sourceHeight
    });
    if (!result.ok) onToast(result.error || "Runtime 点击转发失败", "error");
  }, [onToast, runtimeFrame]);

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
        <Tip label="清除 Web URL；Runtime 运行时自动回退到本机实时画面">
          <button className="icon-command" aria-label="使用本机 Runtime 预览" onClick={() => void saveSettings({ url: "" })}><MonitorPlay size={13} /></button>
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
        {runtimeFrame ? (
          <button className="preview-runtime-frame" type="button" onPointerDown={(event) => void interactWithRuntime(event)} aria-label="本机 Runtime 实时预览；点击可操作游戏">
            <img src={runtimeFrame.dataUrl} alt="Maker Runtime 实时画面" />
            <span>{runtimeFrame.sourceName || "Maker Runtime"} · 本机实时回退</span>
          </button>
        ) : !url ? (
          <div className="empty-state preview-empty">
            <strong>Web / Runtime 预览</strong>
            <p>输入可访问的 Web 游戏 URL；未配置 URL 时，启动 Runtime 后会自动显示本机实时画面。</p>
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
    </div>
  );
}

function Tip({ label, children }: { label: string; children: ReactNode }) {
  return <span className="tip-wrap" data-tip={label}>{children}</span>;
}
