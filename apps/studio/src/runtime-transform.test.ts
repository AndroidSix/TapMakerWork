import { describe, expect, it } from "vitest";
import { groupCenter, resizeRect, rotatePoint, scaleRatio, snapValue, toggleSelection, toolForShortcut } from "./runtime-transform.js";

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
