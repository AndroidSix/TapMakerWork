// @vitest-environment happy-dom
import { act, type PointerEvent as ReactPointerEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "./render-hook";
import { useWorkspaceLayout } from "./use-workspace-layout";
import { DEFAULT_LAYOUT, LAYOUT_STORAGE_KEY } from "./workspace-storage";

function pointerDown(clientX: number, clientY: number) {
  return { clientX, clientY, preventDefault: vi.fn() } as unknown as ReactPointerEvent;
}

function pointer(type: "pointermove" | "pointerup", clientX: number, clientY: number) {
  act(() => { window.dispatchEvent(new PointerEvent(type, { clientX, clientY })); });
}

function setup() {
  const toast = vi.fn();
  const view = renderHook(() => useWorkspaceLayout({ toast }));
  return { ...view, toast };
}

function storedLayout() {
  return JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "null") as unknown;
}

afterEach(() => {
  localStorage.clear();
  document.body.className = "";
});

describe("useWorkspaceLayout", () => {
  it("restores the stored layout", () => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ ...DEFAULT_LAYOUT, left: 300 }));
    const { result, unmount } = setup();
    expect(result.current.layout.left).toBe(300);
    unmount();
  });

  it("persists explicit changes and resets to the default", () => {
    const { result, toast, unmount } = setup();
    act(() => result.current.persistLayout({ ...DEFAULT_LAYOUT, terminal: 200 }));
    expect(result.current.layout.terminal).toBe(200);
    expect(storedLayout()).toEqual({ ...DEFAULT_LAYOUT, terminal: 200 });
    act(() => result.current.resetLayout());
    expect(result.current.layout).toEqual(DEFAULT_LAYOUT);
    expect(toast).toHaveBeenCalledWith("已还原默认 IDE 布局", "success");
    unmount();
  });

  it("drags the left pane within its limits and stops on pointerup", () => {
    const { result, unmount } = setup();
    act(() => result.current.beginLayoutDrag("left")(pointerDown(100, 0)));
    expect(document.body.classList.contains("resizing-col")).toBe(true);
    pointer("pointermove", 150, 0);
    expect(result.current.layout.left).toBe(DEFAULT_LAYOUT.left + 50);
    pointer("pointermove", 900, 0);
    expect(result.current.layout.left).toBe(420);
    pointer("pointerup", 900, 0);
    expect(document.body.classList.contains("resizing-col")).toBe(false);
    pointer("pointermove", 100, 0);
    expect(result.current.layout.left).toBe(420);
    expect(storedLayout()).toMatchObject({ left: 420 });
    unmount();
  });

  it("inverts the right pane drag and uses vertical movement for the terminal", () => {
    const { result, unmount } = setup();
    act(() => result.current.beginLayoutDrag("right", true)(pointerDown(500, 0)));
    pointer("pointermove", 460, 0);
    pointer("pointerup", 460, 0);
    expect(result.current.layout.right).toBe(DEFAULT_LAYOUT.right + 40);
    act(() => result.current.beginLayoutDrag("terminal", false, true)(pointerDown(0, 600)));
    expect(document.body.classList.contains("resizing-row")).toBe(true);
    pointer("pointermove", 300, 560);
    pointer("pointerup", 300, 560);
    expect(result.current.layout.terminal).toBe(DEFAULT_LAYOUT.terminal + 40);
    unmount();
  });
});
