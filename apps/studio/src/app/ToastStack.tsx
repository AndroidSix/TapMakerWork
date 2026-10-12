import type { ToastItem } from "./types";

export function ToastStack({ items }: { items: ToastItem[] }) {
  if (!items.length) return null;
  return (
    <div className="toast-stack" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={`toast-item toast-${item.kind}${item.busy ? " toast-busy" : ""}`}>{item.message}</div>
      ))}
    </div>
  );
}
