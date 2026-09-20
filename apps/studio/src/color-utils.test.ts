import { describe, expect, it } from "vitest";
import { rgbaCss, rgbaFromHex, rgbaFromValue, rgbaToHex } from "./color-utils.js";

describe("inspector colors", () => {
  it("normalizes RGBA arrays and clamps channels", () => {
    expect(rgbaFromValue([300, -2, 127.6, 128])).toEqual([255, 0, 128, 128]);
  });

  it("round trips hexadecimal colors with alpha", () => {
    expect(rgbaFromHex("#33669980")).toEqual([51, 102, 153, 128]);
    expect(rgbaToHex([51, 102, 153, 128], true)).toBe("#33669980");
  });

  it("creates a CSS preview with normalized alpha", () => {
    expect(rgbaCss([255, 128, 0, 128])).toBe("rgba(255, 128, 0, 0.502)");
  });
});
