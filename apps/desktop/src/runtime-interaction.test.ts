import { describe, expect, it } from "vitest";
import { runtimeViewportPoint } from "./runtime-interaction.js";

describe("Runtime native input coordinates", () => {
  it("removes title chrome using the same bottom-aligned crop as capture", () => {
    expect(runtimeViewportPoint(
      { x: 100, y: 50, width: 390, height: 874, pid: 42 },
      390 / 844,
      0.5,
      0
    )).toEqual({ x: 295, y: 80 });
  });

  it("centers a horizontal crop and clamps points", () => {
    expect(runtimeViewportPoint(
      { x: 10, y: 20, width: 1000, height: 500, pid: 42 },
      1,
      2,
      -1
    )).toEqual({ x: 760, y: 20 });
  });
});
