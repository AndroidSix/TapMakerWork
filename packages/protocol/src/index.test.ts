import { describe, expect, it } from "vitest";
import { applyUiPatch, findUiNode, type UiSnapshot } from "./index.js";

const snapshot: UiSnapshot = {
  revision: 2,
  root: {
    id: "root",
    type: "Panel",
    name: "Root",
    props: { width: "100%" },
    children: [{ id: "button", type: "Button", name: "Start", props: { width: 200 }, children: [] }]
  }
};

describe("UI patch protocol", () => {
  it("updates one node without mutating the input", () => {
    const next = applyUiPatch(snapshot, {
      requestId: "p1",
      baseRevision: 2,
      nodeId: "button",
      props: { width: 240, text: "开始" }
    });
    expect(next.revision).toBe(3);
    expect(findUiNode(next.root, "button")?.props).toEqual({ width: 240, text: "开始" });
    expect(findUiNode(snapshot.root, "button")?.props).toEqual({ width: 200 });
  });

  it("rejects stale revisions", () => {
    expect(() => applyUiPatch(snapshot, {
      requestId: "p2",
      baseRevision: 1,
      nodeId: "button",
      props: { width: 10 }
    })).toThrow("revision_conflict:2");
  });
});
