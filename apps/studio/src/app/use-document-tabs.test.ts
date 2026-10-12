// @vitest-environment happy-dom
import { act, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "./render-hook";
import { useDocumentTabs } from "./use-document-tabs";
import { DEFAULT_DOCUMENT_TABS, DOCUMENT_TABS_STORAGE_KEY } from "./workspace-storage";

const dockInsets = { left: 220, right: 280 };

function setup() {
  const toast = vi.fn();
  const view = renderHook(() => useDocumentTabs({ toast, dockInsets }));
  const strip = document.createElement("nav");
  strip.getBoundingClientRect = () => ({ top: 80, bottom: 110, left: 220, right: 744 }) as DOMRect;
  view.result.current.documentTabsRef.current = strip;
  return { ...view, toast };
}

function dragEnd(clientX: number, clientY: number) {
  return { clientX, clientY } as ReactDragEvent;
}

function pointerDown(clientX: number, clientY: number) {
  const target = document.createElement("div");
  return { clientX, clientY, target, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as ReactPointerEvent<HTMLElement>;
}

function pointer(type: "pointermove" | "pointerup", clientX: number, clientY: number) {
  act(() => { window.dispatchEvent(new PointerEvent(type, { clientX, clientY })); });
}

function storedTabs() {
  return JSON.parse(localStorage.getItem(DOCUMENT_TABS_STORAGE_KEY) ?? "null") as unknown;
}

afterEach(() => {
  localStorage.clear();
});

describe("useDocumentTabs", () => {
  it("moves tabs with the keyboard and ignores moves past the edges", () => {
    const { result, unmount } = setup();
    act(() => result.current.moveDocumentTab("visual", -1));
    expect(result.current.documentTabs.slice(0, 2)).toEqual(["visual", "workflow"]);
    expect(storedTabs()).toEqual(result.current.documentTabs);
    act(() => result.current.moveDocumentTab("visual", -1));
    expect(result.current.documentTabs[0]).toBe("visual");
    unmount();
  });

  it("reorders the dragged tab before the drop target", () => {
    const { result, unmount } = setup();
    act(() => result.current.setDraggedDocumentTab("code"));
    act(() => result.current.reorderDocumentTab("workflow"));
    expect(result.current.documentTabs).toEqual(["code", "workflow", "visual", "runtime", "preview"]);
    expect(storedTabs()).toEqual(result.current.documentTabs);
    unmount();
  });

  it("keeps the workspace docked when the drag ends on the tab strip", () => {
    const { result, toast, unmount } = setup();
    act(() => result.current.setDraggedDocumentTab("code"));
    act(() => result.current.finishDocumentTabDrag(dragEnd(400, 95)));
    expect(result.current.floatingWorkspace).toBeNull();
    expect(result.current.documentTabs).toEqual(DEFAULT_DOCUMENT_TABS);
    expect(toast).not.toHaveBeenCalled();
    unmount();
  });

  it("floats the workspace when a tab is dropped away from the strip", () => {
    const { result, toast, unmount } = setup();
    act(() => result.current.finishDocumentTabDrag(dragEnd(500, 200)));
    const floating = result.current.floatingWorkspace;
    expect(floating?.y).toBe(180);
    expect(floating!.x + floating!.width).toBeLessThanOrEqual(window.innerWidth - 8);
    expect(floating!.y + floating!.height).toBeLessThanOrEqual(window.innerHeight - 8);
    expect(toast).toHaveBeenCalledWith("工作区已脱离停靠；拖动标题空白处可移动，右下角可缩放", "success");
    unmount();
  });

  it("moves the floating workspace and docks it again over the tab bar", () => {
    const { result, toast, unmount } = setup();
    act(() => result.current.setFloatingWorkspace({ x: 100, y: 300, width: 600, height: 400 }));
    act(() => result.current.beginFloatingWorkspaceMove(pointerDown(150, 310)));
    expect(document.body.classList.contains("moving-workspace")).toBe(true);
    pointer("pointermove", 200, 330);
    expect(result.current.floatingWorkspace).toMatchObject({ x: 150, y: 320 });
    pointer("pointerup", 400, 100);
    expect(result.current.floatingWorkspace).toBeNull();
    expect(document.body.classList.contains("moving-workspace")).toBe(false);
    expect(toast).toHaveBeenCalledWith("工作区已重新停靠", "success");
    unmount();
  });

  it("does not shrink the floating workspace below its minimum size", () => {
    const { result, unmount } = setup();
    act(() => result.current.setFloatingWorkspace({ x: 100, y: 100, width: 600, height: 400 }));
    act(() => result.current.beginFloatingWorkspaceResize(pointerDown(700, 500)));
    pointer("pointermove", 100, 100);
    pointer("pointerup", 100, 100);
    expect(result.current.floatingWorkspace).toMatchObject({ width: 480, height: 340 });
    unmount();
  });
});
