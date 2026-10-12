import type { ReactNode } from "react";
import { ExternalLink, Download, XCircle } from "lucide-react";
import type { DesktopUpdateState } from "../desktop-api";

export function UpdateNoteText({ text, onOpen }: { text: string; onOpen: (url: string) => void }) {
  const nodes: ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const label = match[1] ?? "";
    const url = match[2] ?? "";
    if (!url) continue;
    nodes.push(
      <button
        key={`note-link-${key++}`}
        type="button"
        className="update-note-link"
        onClick={() => onOpen(url)}
      >
        {label}
      </button>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return <>{nodes}</>;
}

export function UpdateDocLinks({
  links,
  onOpen
}: {
  links?: Array<{ label: string; url: string }> | undefined;
  onOpen: (url: string) => void;
}) {
  if (!links || links.length === 0) return null;
  return (
    <div className="update-doc-links" role="group" aria-label="发布说明相关文档">
      {links.map((link) => (
        <button key={`${link.label}-${link.url}`} type="button" className="update-doc-link" onClick={() => onOpen(link.url)}>
          <ExternalLink size={12} />
          {link.label}
        </button>
      ))}
    </div>
  );
}

export function UpdatePromptDialog({
  state,
  busy,
  onUpdate,
  onSnooze,
  onMute,
  onClose,
  onOpenExternal
}: {
  state: DesktopUpdateState;
  busy: string;
  onUpdate: () => void;
  onSnooze: () => void;
  onMute: () => void;
  onClose: () => void;
  onOpenExternal: (url: string) => void;
}) {
  return <div className="legal-backdrop update-prompt-backdrop" role="presentation">
    <section className="sponsor-dialog update-prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="update-prompt-title">
      <header>
        <div>
          <span>应用更新</span>
          <h2 id="update-prompt-title">{state.title || `发现新版本 ${state.availableVersion || ""}`}</h2>
          <p>当前 {state.currentVersion} → 可更新 {state.availableVersion}。立即更新将打开对应平台安装包下载页。</p>
        </div>
        <button className="icon-command" aria-label="关闭更新提示" onClick={onClose}><XCircle size={18} /></button>
      </header>
      <div className="update-prompt-body">
        {(state.notes && state.notes.length > 0) ? (
          <ul className="update-notes">
            {state.notes.map((note) => (
              <li key={note}><UpdateNoteText text={note} onOpen={onOpenExternal} /></li>
            ))}
          </ul>
        ) : (
          <p className="desktop-card-note">请下载并安装新版本后重启 TapMakerWork。</p>
        )}
        <UpdateDocLinks links={state.links} onOpen={onOpenExternal} />
        {state.message && <p className="desktop-card-note" role="status">{state.message}</p>}
      </div>
      <footer>
        <button disabled={Boolean(busy) || Boolean(state.force)} onClick={onMute}>不再提醒</button>
        <button disabled={Boolean(busy) || Boolean(state.force)} onClick={onSnooze}>暂不更新</button>
        <button className="primary" disabled={Boolean(busy)} onClick={onUpdate}>
          <Download size={13} />立即更新
        </button>
      </footer>
    </section>
  </div>;
}
