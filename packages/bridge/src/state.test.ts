import { describe, expect, it } from "vitest";
import { EditorState } from "./state.js";

describe("editor history", () => {
  it("undoes and redoes visual patches without reusing revisions", () => {
    const state = new EditorState();
    const initial = state.getSnapshot();
    const changed = state.apply({
      requestId: "change-1",
      baseRevision: initial.revision,
      nodeId: "home.single-player",
      props: { text: "临时预览" }
    });
    expect(changed.revision).toBe(initial.revision + 1);
    expect(state.undo().revision).toBe(changed.revision + 1);
    const redone = state.redo();
    expect(redone.revision).toBe(changed.revision + 2);
    expect(redone.root.children[1]?.children[0]?.props.text).toBe("临时预览");
  });

  it("keeps the current selection when a runtime refresh omits selectedId", () => {
    const state = new EditorState();
    const current = state.getSnapshot();
    const refreshed = state.replaceFromRuntime({ revision: 99, root: current.root });
    expect(refreshed.selectedId).toBe("home.single-player");
  });

  it("drops a stale selection that is missing from the runtime tree", () => {
    const state = new EditorState();
    const current = state.getSnapshot();
    const refreshed = state.replaceFromRuntime({
      revision: 99,
      selectedId: "scripts/main.lua:module:0",
      root: {
        id: "nanovg-root",
        type: "NanoVG",
        name: "NanoVG",
        props: {},
        source: { file: "runtime", line: 0 },
        children: []
      }
    });
    expect(refreshed.selectedId).toBeUndefined();
    expect(refreshed.root.id).toBe("nanovg-root");
    expect(current.selectedId).toBe("home.single-player");
  });

  it("coalesces realtime drag patches into one undo step", () => {
    const state = new EditorState();
    const initial = state.getSnapshot();
    let revision = initial.revision;
    for (const left of [10, 20, 30]) {
      revision = state.apply({
        requestId: `drag-${left}`,
        baseRevision: revision,
        nodeId: "home.single-player",
        props: { left },
        historyGroup: "drag-gesture"
      }).revision;
    }
    const undone = state.undo();
    expect(undone.root.children[1]?.children[0]?.props.left).toBeUndefined();
    const redone = state.redo();
    expect(redone.root.children[1]?.children[0]?.props.left).toBe(30);
  });
});
