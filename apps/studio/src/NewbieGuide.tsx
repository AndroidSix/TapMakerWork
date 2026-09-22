import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react";
import guideLiveEdit from "../../../docs/guide/step-live-edit.png";
import guideReconnect from "../../../docs/guide/step-reconnect.png";

export const ONBOARDING_STORAGE_KEY = "tapmakerwork.onboarding.v1";
export const COACH_LIVE_EDIT_KEY = "tapmakerwork.coach.liveEdit";
export const COACH_RUNTIME_START_KEY = "tapmakerwork.coach.runtimeStart";

const STEPS = [
  {
    id: "live-edit-start",
    title: "第一步：实时编辑 + 启动 Runtime",
    body: "先点顶部「实时编辑」，再点「启动 Maker Runtime」，等待游戏窗口起来。起来后才能在真实画面上点选控件。",
    callouts: ["第一步：点击「实时编辑」", "第二步：点击「启动 Maker Runtime」，等待启动即可"],
    image: guideLiveEdit,
    imageAlt: "新手引导：点击实时编辑，再启动 Maker Runtime"
  },
  {
    id: "reconnect",
    title: "第二步：若未连上，点「重新接入并连接」",
    body: "项目多时注入可能失败。若出现「运行时编辑桥尚未连接」，点「重新接入并连接」即可；成功后就能拖拽编辑。",
    callouts: ["因为项目众多，如果启动注入失败，请自行点击「重新接入并连接」再注入一次"],
    image: guideReconnect,
    imageAlt: "新手引导：重新接入并连接运行时编辑桥"
  }
] as const;

interface NewbieGuideDialogProps {
  onClose: (opts?: { enableCoachMarks?: boolean }) => void;
}

export function NewbieGuideDialog({ onClose }: NewbieGuideDialogProps) {
  const [index, setIndex] = useState(0);
  const step = STEPS[index]!;
  const isLast = index >= STEPS.length - 1;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose({ enableCoachMarks: true });
      if (event.key === "ArrowRight" && !isLast) setIndex((value) => value + 1);
      if (event.key === "ArrowLeft" && index > 0) setIndex((value) => value - 1);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [index, isLast, onClose]);

  return (
    <div className="sponsor-backdrop newbie-backdrop" role="presentation">
      <section className="sponsor-dialog newbie-dialog" role="dialog" aria-modal="true" aria-labelledby="newbie-guide-title">
        <header>
          <div>
            <span><Sparkles size={13} aria-hidden="true" />首次使用 · 约 30 秒</span>
            <h2 id="newbie-guide-title">实时编辑上手引导</h2>
            <p>按两步即可开始改界面。看完后，顶部按钮会有弱提示，点过一次就消失。</p>
          </div>
          <button className="icon-command" aria-label="关闭新手引导" onClick={() => onClose({ enableCoachMarks: true })}><X size={18} /></button>
        </header>
        <div className="newbie-body">
          <div className="newbie-step-meta">
            <strong>{step.title}</strong>
            <p>{step.body}</p>
            <div className="newbie-callouts" aria-label="关键提示">
              {step.callouts.map((text) => (
                <p key={text} className="newbie-callout">{text}</p>
              ))}
            </div>
            <small>{index + 1} / {STEPS.length}</small>
          </div>
          <figure className="newbie-figure">
            <img src={step.image} alt={step.imageAlt} />
          </figure>
        </div>
        <footer>
          <button type="button" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))}>
            <ChevronLeft size={14} />上一步
          </button>
          {!isLast ? (
            <button type="button" className="primary" autoFocus onClick={() => setIndex((value) => value + 1)}>
              下一步<ChevronRight size={14} />
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              autoFocus
              onClick={() => onClose({ enableCoachMarks: true })}
            >
              开始使用
            </button>
          )}
          <button type="button" onClick={() => onClose({ enableCoachMarks: false })}>跳过引导</button>
        </footer>
      </section>
    </div>
  );
}

export function readOnboardingSeen(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markOnboardingSeen(): void {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
  } catch {
    // ignore
  }
}

export function readCoachMark(key: string): boolean {
  try {
    return localStorage.getItem(key) === "pending";
  } catch {
    return false;
  }
}

export function dismissCoachMark(key: string): void {
  try {
    localStorage.setItem(key, "done");
  } catch {
    // ignore
  }
}

export function enableCoachMarks(): void {
  try {
    if (localStorage.getItem(COACH_LIVE_EDIT_KEY) !== "done") localStorage.setItem(COACH_LIVE_EDIT_KEY, "pending");
    if (localStorage.getItem(COACH_RUNTIME_START_KEY) !== "done") localStorage.setItem(COACH_RUNTIME_START_KEY, "pending");
  } catch {
    // ignore
  }
}

interface CoachMarkProps {
  label: string;
  active: boolean;
  children: ReactNode;
}

export function CoachMark({ label, active, children }: CoachMarkProps) {
  if (!active) return <>{children}</>;
  return (
    <span className="coach-mark-wrap">
      {children}
      <span className="coach-mark-pulse" aria-hidden="true" />
      <span className="coach-mark-label">{label}</span>
    </span>
  );
}
