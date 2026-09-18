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
});
