import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface TipProps {
  label: string;
  children: ReactNode;
  /** 显式关闭浮层；左侧栏 / 模式切换也会自动禁用浮层 */
  disabled?: boolean;
}

interface TipPosition {
  top: number;
  left: number;
  maxWidth: number;
  placement: "below" | "above";
}

function shouldSuppressBubble(node: HTMLElement | null): boolean {
  return Boolean(node?.closest(".left-pane, .commandbar .mode-switch"));
}

export function Tip({ label, children, disabled = false }: TipProps) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const tipId = useId();
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<TipPosition>({ top: 0, left: 0, maxWidth: 240, placement: "below" });

  const suppressed = disabled || shouldSuppressBubble(wrapRef.current);

  useLayoutEffect(() => {
    if (!visible || suppressed || !wrapRef.current) return;
    const anchor = wrapRef.current.getBoundingClientRect();
    const margin = 12;
    const maxWidth = Math.min(280, Math.max(160, window.innerWidth - margin * 2));
    const estimatedHeight = bubbleRef.current?.offsetHeight || Math.min(120, 24 + Math.ceil(label.length / 28) * 16);
    let placement: TipPosition["placement"] = "below";
    let top = anchor.bottom + 6;
    if (top + estimatedHeight > window.innerHeight - margin && anchor.top - 6 - estimatedHeight > margin) {
      placement = "above";
      top = Math.max(margin, anchor.top - 6 - estimatedHeight);
    } else {
      top = Math.min(top, window.innerHeight - margin - estimatedHeight);
      top = Math.max(margin, top);
    }
    let left = anchor.left + anchor.width / 2 - maxWidth / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - maxWidth - margin));
    setPos({ top, left, maxWidth, placement });
  }, [visible, label, suppressed]);

  useEffect(() => {
    if (!visible) return;
    const hide = () => setVisible(false);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [visible]);

  const show = visible && !suppressed;

  return (
    <span
      ref={wrapRef}
      className="tip-wrap"
      title={suppressed ? label : undefined}
      onMouseEnter={() => {
        if (disabled || shouldSuppressBubble(wrapRef.current)) return;
        setVisible(true);
      }}
      onMouseLeave={() => setVisible(false)}
      onFocusCapture={() => {
        if (disabled || shouldSuppressBubble(wrapRef.current)) return;
        setVisible(true);
      }}
      onBlurCapture={(event) => {
        if (!wrapRef.current?.contains(event.relatedTarget as Node | null)) setVisible(false);
      }}
    >
      {children}
      {show &&
        createPortal(
          <div
            ref={bubbleRef}
            id={tipId}
            role="tooltip"
            className={`tip-bubble tip-${pos.placement}`}
            style={{ top: pos.top, left: pos.left, maxWidth: pos.maxWidth }}
          >
            {label}
          </div>,
          document.body
        )}
    </span>
  );
}
