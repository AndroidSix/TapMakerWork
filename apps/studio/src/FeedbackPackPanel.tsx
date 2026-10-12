import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, LifeBuoy, Loader2, RefreshCw, Save, Users, X } from "lucide-react";
import type { LogChannel } from "@tapmakerwork/protocol";

interface FeedbackPack {
  markdown: string;
  fileName: string;
  savedPath?: string;
}

interface FeedbackPackPanelProps {
  apiBase: string;
  appVersion: string;
  desktopVersion?: string | undefined;
  runtimeError?: string | undefined;
  studioLogs: Record<LogChannel, string[]>;
  onClose: () => void;
  onCopy: (text: string) => void;
  onOpenCommunity: () => void;
}

function clientInfo(appVersion: string, desktopVersion: string | undefined) {
  return {
    appVersion,
    desktopVersion,
    userAgent: navigator.userAgent,
    screen: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`
  };
}

export function FeedbackPackPanel({ apiBase, appVersion, desktopVersion, runtimeError, studioLogs, onClose, onCopy, onOpenCommunity }: FeedbackPackPanelProps) {
  const [description, setDescription] = useState("");
  const [includeStudioLogs, setIncludeStudioLogs] = useState(true);
  const [pack, setPack] = useState<FeedbackPack | null>(null);
  const [busy, setBusy] = useState<"preview" | "copy" | "save" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const previewedRef = useRef(false);

  const requestPack = useCallback(async (save: boolean): Promise<FeedbackPack | undefined> => {
    const response = await fetch(`${apiBase}/api/feedback/pack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description,
        client: clientInfo(appVersion, desktopVersion),
        runtimeError,
        studioLogs: includeStudioLogs ? studioLogs : {},
        save
      })
    }).catch(() => undefined);
    if (!response?.ok) {
      setMessage("生成反馈包失败：Bridge 未响应，请确认 Bridge 已连接后重试。");
      return undefined;
    }
    const next = await response.json() as FeedbackPack;
    setPack(next);
    return next;
  }, [apiBase, appVersion, description, desktopVersion, includeStudioLogs, runtimeError, studioLogs]);

  const run = useCallback(async (action: "preview" | "copy" | "save") => {
    setBusy(action);
    setMessage(null);
    const next = await requestPack(action === "save");
    setBusy(null);
    if (!next) return;
    if (action === "copy") onCopy(next.markdown);
    if (action === "save" && next.savedPath) setMessage(`已保存到 ${next.savedPath}`);
  }, [onCopy, requestPack]);

  useEffect(() => {
    if (previewedRef.current) return;
    previewedRef.current = true;
    void run("preview");
  }, [run]);

  return (
    <section className="overlay-panel panel tools-panel" aria-label="一键反馈包">
      <div className="overlay-heading">
        <strong><LifeBuoy size={15} aria-hidden="true" />一键反馈包</strong>
        <div className="asset-checkup-heading-actions">
          <button type="button" aria-label="关闭" onClick={onClose}><X size={14} />关闭</button>
        </div>
      </div>
      <div className="image-compress-panel">
        <p className="desktop-card-note">
          自动汇总 TapMakerWork / Maker 版本、系统、项目信息、Runtime 与 Bridge 日志和最近错误。用户目录、token、签名参数会自动脱敏。复制后发到 QQ 群，或保存成文件发给开发者。
        </p>
        <section className="image-compress-card">
          <label className="image-compress-keys">
            问题描述（选填，越具体越好排查）
            <textarea
              className="feedback-pack-description"
              value={description}
              placeholder="例如：打开 HomePage.lua 后点「启动」，预览窗口黑屏，Runtime 终端报 attempt to index nil"
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <div className="desktop-card-actions">
            <label className="image-compress-force">
              <input type="checkbox" checked={includeStudioLogs} onChange={(event) => setIncludeStudioLogs(event.target.checked)} />
              附带 Studio 终端日志
            </label>
            {runtimeError && <span className="feedback-pack-flag">已附带当前运行时错误</span>}
          </div>
          <div className="desktop-card-actions">
            <button type="button" disabled={busy !== null} onClick={() => void run("preview")}>
              {busy === "preview" ? <Loader2 size={12} className="spin" /> : <RefreshCw size={13} />}刷新预览
            </button>
            <button type="button" className="primary" disabled={busy !== null} onClick={() => void run("copy")}>
              {busy === "copy" ? <Loader2 size={12} className="spin" /> : <Copy size={13} />}复制反馈包
            </button>
            <button type="button" disabled={busy !== null} onClick={() => void run("save")}>
              {busy === "save" ? <Loader2 size={12} className="spin" /> : <Save size={13} />}保存为文件
            </button>
            <button type="button" onClick={onOpenCommunity}><Users size={13} />去 QQ 群反馈</button>
          </div>
          {message && (
            <p className="image-compress-message" role="status">
              {message}
              {pack?.savedPath && message.startsWith("已保存") && (
                <button type="button" className="feedback-pack-inline" onClick={() => onCopy(pack.savedPath!)}>复制路径</button>
              )}
            </p>
          )}
        </section>
        <section className="image-compress-card">
          <div className="desktop-card-heading">
            <div>
              <h4>预览</h4>
              <p>{pack ? `${pack.fileName} · ${pack.markdown.length.toLocaleString()} 字符` : "正在生成…"}</p>
            </div>
          </div>
          <pre className="tips-copy-text feedback-pack-preview" aria-live="polite">{pack?.markdown ?? "正在汇总版本、日志与错误信息…"}</pre>
        </section>
      </div>
    </section>
  );
}
