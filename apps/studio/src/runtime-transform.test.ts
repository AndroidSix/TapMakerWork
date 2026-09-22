import { describe, expect, it } from "vitest";
import type { UiNode } from "@tapmakerwork/protocol";
import { collectRuntimeBoxes } from "./RuntimeMirror.js";
import { groupCenter, resizeRect, rotatePoint, scaleRatio, snapValue, toggleSelection, toolForShortcut } from "./runtime-transform.js";
import { clipRectToSpace, runtimeCoordinateSpace, runtimeHitCandidates } from "./runtime-hit-test.js";

describe("runtime transform helpers", () => {
  it("matches the Cocos transform shortcuts", () => {
    expect(["Q", "w", "E", "r", "T"].map((key) => toolForShortcut(key))).toEqual(["select", "move", "rotate", "scale", "rect"]);
  });

  it("toggles an additive selection without duplicating nodes", () => {
    expect(toggleSelection(["a"], "b", true)).toEqual(["a", "b"]);
    expect(toggleSelection(["a", "b"], "a", true)).toEqual(["b"]);
    expect(toggleSelection(["a", "b"], "c", false)).toEqual(["c"]);
  });

  it("computes group transforms and bounded rectangle resizing", () => {
    expect(groupCenter([{ x: 0, y: 0, w: 20, h: 10 }, { x: 30, y: 10, w: 10, h: 20 }])).toEqual({ x: 20, y: 15 });
    expect(rotatePoint({ x: 20, y: 10 }, { x: 10, y: 10 }, Math.PI / 2).x).toBeCloseTo(10);
    expect(rotatePoint({ x: 20, y: 10 }, { x: 10, y: 10 }, Math.PI / 2).y).toBeCloseTo(20);
    expect(scaleRatio({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 })).toBe(2);
    expect(snapValue(23, 10)).toBe(20);
    expect(snapValue(28, 10)).toBe(30);
    expect(resizeRect({ x: 0, y: 0, w: 20, h: 20 }, "nw", 30, 30)).toEqual({ x: 16, y: 16, w: 4, h: 4 });
  });
});

function node(id: string, children: UiNode[] = [], rect = { x: 0, y: 0, w: 720, h: 1280 }): UiNode {
  return {
    id,
    type: "Panel",
    name: id,
    props: { $screen: rect },
    children
  };
}

describe("runtime hit order", () => {
  it("keeps popup controls in front and lets clicks pass through the popup shell", () => {
    const root = node("root", [
      node("main", [node("panel", [node("deep-button", [], { x: 40, y: 40, w: 120, h: 48 })])]),
      node("popup", [node("popup-button", [], { x: 40, y: 40, w: 120, h: 48 })])
    ]);
    const boxes = collectRuntimeBoxes(root);
    const layerOf = (id: string) => {
      const layer = boxes.find((box) => box.id === id)?.layer;
      if (layer == null) throw new Error(`missing ${id}`);
      return layer;
    };
    expect(layerOf("popup-button")).toBeGreaterThan(layerOf("deep-button"));
    expect(layerOf("popup")).toBeLessThan(layerOf("deep-button"));
    expect(layerOf("deep-button")).toBeGreaterThan(layerOf("panel"));
  });

  it("prefers specific front controls and keeps tiny nodes selectable", () => {
    const space = { width: 720, height: 1280, source: "physical" as const };
    const candidates = runtimeHitCandidates([
      { id: "root", x: 0, y: 0, w: 720, h: 1280, depth: 0, layer: 0, order: 0 },
      { id: "button", x: 100, y: 100, w: 180, h: 50, depth: 2, layer: 2, order: 1 },
      { id: "icon", x: 270, y: 110, w: 8, h: 8, depth: 3, layer: 3, order: 2 }
    ], { x: 278, y: 114 }, space, 8);
    expect(candidates.map((candidate) => candidate.id)).toEqual(["icon", "button"]);
  });

  it("uses physical viewport coordinates when engine rectangles are physical", () => {
    const root = { x: 0, y: 0, w: 720, h: 1280 };
    const snapshot = {
      revision: 1,
      root: node("root", [], root),
      viewport: { width: 360, height: 640, scale: 2, physicalWidth: 720, physicalHeight: 1280 }
    };
    expect(runtimeCoordinateSpace(snapshot, root)).toEqual({ width: 720, height: 1280, source: "physical" });
    expect(clipRectToSpace({ x: -10, y: 100, w: 40, h: 50 }, { width: 720, height: 1280, source: "physical" })).toEqual({ x: 0, y: 100, w: 30, h: 50 });
  });
});
