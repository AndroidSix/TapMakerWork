import { describe, expect, it } from "vitest";
import { DEFAULT_DEVICE_PROFILES } from "@tapmakerwork/protocol";
import { describeSafeAreaIssue, findSafeAreaIssues, safeInsetsInCanvas, type MeasuredNode } from "./safe-area-check";

const canvas = { width: 720, height: 1280 };
const insets = { top: 80, right: 0, bottom: 60, left: 0 };

function node(id: string, type: string, rect: MeasuredNode["rect"], extra: Partial<MeasuredNode> = {}): MeasuredNode {
  return { id, name: id, type, rect, hasChildren: false, insideScroll: false, ...extra };
}

describe("safeInsetsInCanvas", () => {
  it("scales device insets to the design canvas", () => {
    const device = { ...DEFAULT_DEVICE_PROFILES[0]!, width: 360, height: 640, safeArea: { top: 20, right: 0, bottom: 10, left: 5 } };
    expect(safeInsetsInCanvas(device, canvas)).toEqual({ top: 40, right: 0, bottom: 20, left: 10 });
  });
});

describe("findSafeAreaIssues", () => {
  it("flags content entering the notch and home indicator zones", () => {
    const issues = findSafeAreaIssues([
      node("title", "Label", { left: 100, top: 20, width: 300, height: 40 }),
      node("start", "Button", { left: 100, top: 1240, width: 300, height: 30 }),
      node("ok", "Button", { left: 100, top: 600, width: 300, height: 60 })
    ], canvas, insets);
    expect(issues.map((issue) => [issue.id, issue.kind, issue.edges])).toEqual([
      ["title", "unsafe-area", ["top"]],
      ["start", "unsafe-area", ["bottom"]]
    ]);
  });

  it("reports leaving the canvas as the more severe problem", () => {
    const [issue] = findSafeAreaIssues([node("coin", "Image", { left: 700, top: 10, width: 60, height: 60 })], canvas, insets);
    expect(issue).toMatchObject({ kind: "outside-canvas", edges: ["right"] });
    expect(describeSafeAreaIssue(issue!)).toBe("超出画布：右侧");
  });

  it("ignores full-screen backgrounds, containers and scroll content", () => {
    const issues = findSafeAreaIssues([
      node("bg", "Image", { left: 0, top: 0, width: 720, height: 1280 }),
      node("header", "Panel", { left: 0, top: 0, width: 720, height: 160 }, { hasChildren: true }),
      node("row", "Label", { left: 0, top: 1300, width: 200, height: 40 }, { insideScroll: true }),
      node("edge", "Label", { left: 0, top: 79.5, width: 200, height: 40 })
    ], canvas, insets);
    expect(issues).toEqual([]);
  });
});
