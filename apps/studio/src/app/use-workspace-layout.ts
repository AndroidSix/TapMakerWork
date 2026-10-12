import { useCallback, useRef, useState } from "react";
import type { ToastKind, WorkspaceLayout } from "./types";
import { DEFAULT_LAYOUT, LAYOUT_STORAGE_KEY, clamp, loadWorkspaceLayout, terminalMaxHeight } from "./workspace-storage";

export function useWorkspaceLayout({ toast }: { toast: (message: string, kind?: ToastKind) => void }) {
  const [layout, setLayout] = useState<WorkspaceLayout>(() => loadWorkspaceLayout());
  const layoutDragRef = useRef<{ key: keyof WorkspaceLayout; base: number; originX: number; originY: number } | null>(null);

  const persistLayout = useCallback((next: WorkspaceLayout) => {
    setLayout(next);
    try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  const resetLayout = useCallback(() => {
    persistLayout({ ...DEFAULT_LAYOUT });
    toast("已还原默认 IDE 布局", "success");
  }, [persistLayout, toast]);

  const beginLayoutDrag = useCallback((key: keyof WorkspaceLayout, invertX = false, invertY = false) => (event: React.PointerEvent) => {
    event.preventDefault();
    layoutDragRef.current = {
      key,
      base: layout[key],
      originX: event.clientX,
      originY: event.clientY
    };
    document.body.classList.add(key === "terminal" ? "resizing-row" : "resizing-col");
    const onMove = (moveEvent: PointerEvent) => {
      const drag = layoutDragRef.current;
      if (!drag) return;
      const dx = moveEvent.clientX - drag.originX;
      const dy = moveEvent.clientY - drag.originY;
      const delta = key === "terminal" ? dy : dx;
      const signed = (invertX || invertY) ? -delta : delta;
      setLayout((current) => {
        const raw = drag.base + signed;
        const next = { ...current, [key]: clamp(raw, key === "terminal" ? 40 : key === "previewDock" ? 220 : key === "right" ? 200 : 160, key === "terminal" ? terminalMaxHeight() : key === "previewDock" ? 520 : key === "right" ? 480 : 420) };
        try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    };
    const onUp = () => {
      layoutDragRef.current = null;
      document.body.classList.remove("resizing-row", "resizing-col");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [layout]);

  return { layout, persistLayout, resetLayout, beginLayoutDrag };
}
