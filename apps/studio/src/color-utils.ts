import type { UiValue } from "@tapmakerwork/protocol";

export type RgbaColor = [number, number, number, number];

function channel(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(255, Math.round(numeric))) : fallback;
}

export function rgbaFromValue(value: UiValue | undefined, fallback: RgbaColor = [255, 255, 255, 255]): RgbaColor {
  if (Array.isArray(value)) {
    return [channel(value[0], fallback[0]), channel(value[1], fallback[1]), channel(value[2], fallback[2]), channel(value[3], fallback[3])];
  }
  if (typeof value === "string") return rgbaFromHex(value, fallback);
  return [...fallback];
}

export function rgbaFromHex(value: string, fallback: RgbaColor = [255, 255, 255, 255]): RgbaColor {
  const hex = value.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return [...fallback];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
    hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) : fallback[3]
  ];
}

export function rgbaToHex(color: RgbaColor, includeAlpha = false): string {
  const body = color.slice(0, includeAlpha ? 4 : 3).map((value) => channel(value, 255).toString(16).padStart(2, "0")).join("");
  return `#${body.toUpperCase()}`;
}

export function rgbaCss(color: RgbaColor): string {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${Math.round(color[3] / 255 * 1000) / 1000})`;
}
