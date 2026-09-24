import { describe, expect, it } from "vitest";
import { applyUiPatch, applyUiTreeOp, findUiNode, isKitInternalUiNode, isUiKitSourceFile, type UiSnapshot } from "./index.js";

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

function sampleTree(): UiSnapshot {
  return {
    revision: 1,
    root: {
      id: "root",
      type: "Panel",
      name: "root",
      props: { id: "root" },
      children: [
        {
          id: "a",
          type: "Panel",
          name: "A",
          props: { id: "A", visible: true },
          children: [
            { id: "a1", type: "Label", name: "A1", props: { text: "one" }, children: [] }
          ]
        },
        { id: "b", type: "Panel", name: "B", props: { id: "B" }, children: [] }
      ]
    }
  };
}

describe("ui tree ops", () => {
  it("toggles visible", () => {
    const next = applyUiTreeOp(sampleTree(), { type: "toggle-visible", nodeId: "a" });
    expect(findUiNode(next.root, "a")?.props.visible).toBe(false);
  });

  it("moves sibling up/down", () => {
    const up = applyUiTreeOp(sampleTree(), { type: "move", nodeId: "b", direction: "up" });
    expect(up.root.children.map((n) => n.id)).toEqual(["b", "a"]);
    const down = applyUiTreeOp(sampleTree(), { type: "move", nodeId: "a", direction: "down" });
    expect(down.root.children.map((n) => n.id)).toEqual(["b", "a"]);
  });

  it("deletes non-root nodes and rejects root delete", () => {
    const next = applyUiTreeOp(sampleTree(), { type: "delete", nodeId: "a" });
    expect(next.root.children.map((n) => n.id)).toEqual(["b"]);
    expect(next.selectedId).toBe("root");
    expect(() => applyUiTreeOp(sampleTree(), { type: "delete", nodeId: "root" })).toThrow();
  });

  it("inserts child and sibling", () => {
    const child = applyUiTreeOp(sampleTree(), { type: "insert-child", nodeId: "b", nodeType: "Label", name: "NewLabel" });
    expect(findUiNode(child.root, "b")?.children.some((n) => n.name === "NewLabel")).toBe(true);
    const sibling = applyUiTreeOp(sampleTree(), { type: "insert-sibling", nodeId: "b", nodeType: "Button", name: "NewBtn" });
    expect(sibling.root.children.some((n) => n.name === "NewBtn")).toBe(true);
  });

  it("creates an empty transform node for visual composition", () => {
    const next = applyUiTreeOp(sampleTree(), { type: "insert-child", nodeId: "b", nodeType: "Node" });
    const node = findUiNode(next.root, next.selectedId!);
    expect(node?.type).toBe("Node");
    expect(node?.props).toMatchObject({ position: "absolute", left: 0, top: 0, width: 100, height: 100 });
  });

  it("duplicates a node after itself", () => {
    const next = applyUiTreeOp(sampleTree(), { type: "duplicate", nodeId: "a" });
    const names = next.root.children.map((n) => n.name);
    expect(names[0]).toBe("A");
    expect(names[1]).toContain("A_copy");
  });

  it("relocates node under another parent", () => {
    const next = applyUiTreeOp(sampleTree(), { type: "relocate", nodeId: "a1", parentId: "b", index: 0 });
    expect(findUiNode(next.root, "a")?.children.length).toBe(0);
    expect(findUiNode(next.root, "b")?.children[0]?.id).toBe("a1");
  });

  it("relocates sibling order within same parent", () => {
    const next = applyUiTreeOp(sampleTree(), { type: "relocate", nodeId: "b", parentId: "root", index: 0 });
    expect(next.root.children.map((n) => n.id)).toEqual(["b", "a"]);
  });

  it("renames node", () => {
    const next = applyUiTreeOp(sampleTree(), { type: "rename", nodeId: "a", name: "PanelA" });
    expect(findUiNode(next.root, "a")?.name).toBe("PanelA");
  });
});

describe("ui kit source detection", () => {
  it("recognises UiStyle factories regardless of path separators", () => {
    expect(isUiKitSourceFile("scripts/ui/UiStyle.lua")).toBe(true);
    expect(isUiKitSourceFile("scripts\\ui\\ui-style.lua")).toBe(true);
    expect(isUiKitSourceFile("scripts/ui/MainHUD.lua")).toBe(false);
    expect(isUiKitSourceFile("scripts/ui/QCuteTheme.lua")).toBe(false);
    expect(isUiKitSourceFile(undefined)).toBe(false);
  });

  it("treats kit-internal parts as non-movable unless they carry an explicit id", () => {
    expect(isKitInternalUiNode({ props: {}, source: { file: "scripts/ui/UiStyle.lua", line: 259 } })).toBe(true);
    expect(isKitInternalUiNode({ props: { id: "produceLev" }, source: { file: "scripts/ui/UiStyle.lua", line: 259 } })).toBe(false);
    expect(isKitInternalUiNode({ props: {}, source: { file: "scripts/ui/MainHUD.lua", line: 333 } })).toBe(false);
    expect(isKitInternalUiNode(undefined)).toBe(false);
  });
});
