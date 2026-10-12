import { useCallback, useRef, useState } from "react";
import type { DocumentTab, FloatingWorkspace, ToastKind } from "./types";
import { DOCUMENT_TABS_STORAGE_KEY, clamp, loadDocumentTabs } from "./workspace-storage";

export function useDocumentTabs({ toast, dockInsets }: {
  toast: (message: string, kind?: ToastKind) => void;
  dockInsets: { left: number; right: number };
}) {
  const [documentTabs, setDocumentTabs] = useState<DocumentTab[]>(loadDocumentTabs);
  const [draggedDocumentTab, setDraggedDocumentTab] = useState<DocumentTab | null>(null);
  const [floatingWorkspace, setFloatingWorkspace] = useState<FloatingWorkspace | null>(null);
  const documentTabsRef = useRef<HTMLElement | null>(null);
  const floatingWorkspaceDragRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const floatingWorkspaceResizeRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null);

  const reorderDocumentTab = useCallback((target: DocumentTab) => {
    if (!draggedDocumentTab || draggedDocumentTab === target) return;
    setDocumentTabs((current) => {
      const next = current.filter((item) => item !== draggedDocumentTab);
      next.splice(Math.max(0, current.indexOf(target)), 0, draggedDocumentTab);
      try { localStorage.setItem(DOCUMENT_TABS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [draggedDocumentTab]);

  const moveDocumentTab = useCallback((tab: DocumentTab, direction: -1 | 1) => {
    setDocumentTabs((current) => {
      const index = current.indexOf(tab);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      try { localStorage.setItem(DOCUMENT_TABS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const finishDocumentTabDrag = useCallback((event: React.DragEvent) => {
    const tabsBounds = documentTabsRef.current?.getBoundingClientRect();
    const outsideTabStrip = tabsBounds && (
      event.clientY < tabsBounds.top - 14 || event.clientY > tabsBounds.bottom + 40
      || event.clientX < tabsBounds.left - 24 || event.clientX > tabsBounds.right + 24
    );
    if (!floatingWorkspace && outsideTabStrip && event.clientX > 0 && event.clientY > 0) {
      const width = Math.min(920, Math.max(560, window.innerWidth * .58));
      const height = Math.min(720, Math.max(420, window.innerHeight * .62));
      setFloatingWorkspace({
        x: clamp(event.clientX - width / 2, 8, Math.max(8, window.innerWidth - width - 8)),
        y: clamp(event.clientY - 20, 8, Math.max(8, window.innerHeight - height - 8)),
        width,
        height
      });
      toast("工作区已脱离停靠；拖动标题空白处可移动，右下角可缩放", "success");
    }
    setDraggedDocumentTab(null);
  }, [floatingWorkspace, toast]);

  const beginFloatingWorkspaceMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!floatingWorkspace || (event.target as HTMLElement).closest("button, input, select")) return;
    event.preventDefault();
    floatingWorkspaceDragRef.current = { startX: event.clientX, startY: event.clientY, x: floatingWorkspace.x, y: floatingWorkspace.y };
    const onMove = (moveEvent: PointerEvent) => {
      const drag = floatingWorkspaceDragRef.current;
      if (!drag) return;
      setFloatingWorkspace((current) => current ? {
        ...current,
        x: clamp(drag.x + moveEvent.clientX - drag.startX, 8, Math.max(8, window.innerWidth - current.width - 8)),
        y: clamp(drag.y + moveEvent.clientY - drag.startY, 8, Math.max(8, window.innerHeight - current.height - 8))
      } : current);
    };
    const onUp = (upEvent: PointerEvent) => {
      floatingWorkspaceDragRef.current = null;
      document.body.classList.remove("moving-workspace");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const dockLeft = dockInsets.left + 5;
      const dockRight = window.innerWidth - dockInsets.right - 5;
      if (upEvent.clientX >= dockLeft && upEvent.clientX <= dockRight && upEvent.clientY >= 82 && upEvent.clientY <= 150) {
        setFloatingWorkspace(null);
        toast("工作区已重新停靠", "success");
      }
    };
    document.body.classList.add("moving-workspace");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [dockInsets.left, dockInsets.right, floatingWorkspace, toast]);

  const beginFloatingWorkspaceResize = useCallback((event: React.PointerEvent) => {
    if (!floatingWorkspace) return;
    event.preventDefault();
    event.stopPropagation();
    floatingWorkspaceResizeRef.current = { startX: event.clientX, startY: event.clientY, width: floatingWorkspace.width, height: floatingWorkspace.height };
    const onMove = (moveEvent: PointerEvent) => {
      const drag = floatingWorkspaceResizeRef.current;
      if (!drag) return;
      setFloatingWorkspace((current) => current ? {
        ...current,
        width: clamp(drag.width + moveEvent.clientX - drag.startX, 480, Math.max(480, window.innerWidth - current.x - 8)),
        height: clamp(drag.height + moveEvent.clientY - drag.startY, 340, Math.max(340, window.innerHeight - current.y - 8))
      } : current);
    };
    const onUp = () => {
      floatingWorkspaceResizeRef.current = null;
      document.body.classList.remove("resizing-workspace");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    document.body.classList.add("resizing-workspace");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [floatingWorkspace]);

  return {
    documentTabs,
    setDraggedDocumentTab,
    floatingWorkspace,
    setFloatingWorkspace,
    documentTabsRef,
    reorderDocumentTab,
    moveDocumentTab,
    finishDocumentTabDrag,
    beginFloatingWorkspaceMove,
    beginFloatingWorkspaceResize
  };
}
