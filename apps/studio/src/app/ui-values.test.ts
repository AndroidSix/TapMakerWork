import { describe, expect, it } from "vitest";
import type { UiNode, UiSnapshot } from "@tapmakerwork/protocol";
import { displayValue, edgeValue, imagePathFromProps, keepValidSelection, labelForType, rgba, runtimeLayoutBox, runtimeStyle, shadowValue, visualWeight } from "./ui-values";

function node(id: string, type: string, props: UiNode["props"] = {}, children: UiNode[] = []): UiNode {
  return { id, type, name: id, props, children };
}

function snapshot(root: UiNode, selectedId?: string): UiSnapshot {
  return { root, ...(selectedId ? { selectedId } : {}) } as UiSnapshot;
}

describe("ui value helpers", () => {
  it("labels known widget types in Chinese and keeps unknown ones", () => {
    expect(labelForType("Button")).toBe("按钮");
    expect(labelForType("Panel")).toBe("容器");
    expect(labelForType("ScrollView")).toBe("ScrollView");
  });

  it("converts color arrays to rgba and falls back for invalid input", () => {
    expect(rgba([255, 0, 0])).toBe("rgba(255, 0, 0, 1)");
    expect(rgba([0, 0, 0, 0])).toBe("rgba(0, 0, 0, 0)");
    expect(rgba("#fff")).toBe("#fff");
    expect(rgba(undefined, "red")).toBe("red");
  });

  it("shows expressions in braces and serializes objects", () => {
    expect(displayValue({ $expression: "state.hp" })).toBe("{state.hp}");
    expect(displayValue([1, 2])).toBe("[1,2]");
    expect(displayValue(undefined, "-")).toBe("-");
  });

  it("formats edges and shadows as css strings", () => {
    expect(edgeValue([4, "auto"])).toBe("4px auto");
    expect(edgeValue({ top: 1, left: 2 })).toBe("1px 0px 0px 2px");
    expect(edgeValue(8)).toBe(8);
    expect(shadowValue([{ x: 1, y: 2, blur: 3, color: [0, 0, 0, 255] }])).toBe("1px 2px 3px rgba(0, 0, 0, 1)");
    expect(shadowValue([])).toBeUndefined();
  });

  it("ignores an all-zero runtime layout", () => {
    expect(runtimeLayoutBox({ $layout: { x: 0, y: 0, w: 0, h: 0 } })).toEqual({});
    expect(runtimeLayoutBox({ $layout: { x: 10, y: 0, w: 100, h: 50 } })).toEqual({ x: 10, y: 0, w: 100, h: 50 });
  });

  it("positions nodes absolutely when runtime layout has an offset", () => {
    const style = runtimeStyle(node("a", "Panel", { $layout: { x: 10, y: 20, w: 100, h: 50 } }));
    expect(style).toMatchObject({ position: "absolute", left: 10, top: 20, width: "100px", height: "50px" });
    expect(runtimeStyle(node("b", "Panel", { width: 40 })).position).toBe("relative");
  });

  it("weights visible content and skips hidden nodes", () => {
    const tree = node("root", "Panel", {}, [node("btn", "Button"), node("hidden", "Label", { visible: false })]);
    expect(visualWeight(tree)).toBe(2.25);
  });

  it("reads the first non-empty image path and skips expressions", () => {
    expect(imagePathFromProps({ path: { $expression: "img" }, sprite: "  ui/a.png " })).toBe("ui/a.png");
    expect(imagePathFromProps({ path: "" })).toBeUndefined();
  });
});

describe("keepValidSelection", () => {
  const root = node("root", "Panel", {}, [node("a", "Button"), node("b", "Label")]);

  it("keeps the local selection while the node still exists", () => {
    expect(keepValidSelection(snapshot(root, "a"), snapshot(root, "b")).selectedId).toBe("a");
  });

  it("prefers the explicit id over the current selection", () => {
    expect(keepValidSelection(snapshot(root, "a"), snapshot(root), "b").selectedId).toBe("b");
  });

  it("falls back to the incoming selection when the local node is gone", () => {
    expect(keepValidSelection(snapshot(root, "removed"), snapshot(root, "b")).selectedId).toBe("b");
  });

  it("drops the selection when neither node exists", () => {
    const result = keepValidSelection(snapshot(root, "removed"), snapshot(root, "also-removed"));
    expect("selectedId" in result).toBe(false);
  });
});
