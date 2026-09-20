export type TransformTool = "select" | "move" | "rotate" | "scale" | "rect";

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export function toggleSelection(current: string[], nodeId: string, additive: boolean): string[] {
  if (!additive) return [nodeId];
  return current.includes(nodeId)
    ? current.filter((id) => id !== nodeId)
    : [...current, nodeId];
}

export function toolForShortcut(key: string): TransformTool | undefined {
  switch (key.toLocaleLowerCase()) {
    case "q": return "select";
    case "w": return "move";
    case "e": return "rotate";
    case "r": return "scale";
    case "t": return "rect";
    default: return undefined;
  }
}

export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

export function groupCenter(rects: Rect[]): Point {
  if (!rects.length) return { x: 0, y: 0 };
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.w));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.h));
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

export function angleBetween(center: Point, point: Point): number {
  return Math.atan2(point.y - center.y, point.x - center.x);
}

export function rotatePoint(point: Point, center: Point, radians: number): Point {
  const x = point.x - center.x;
  const y = point.y - center.y;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: center.x + x * cosine - y * sine,
    y: center.y + x * sine + y * cosine
  };
}

export function scaleRatio(center: Point, start: Point, current: Point): number {
  const startDistance = Math.hypot(start.x - center.x, start.y - center.y);
  if (startDistance < 1) return 1;
  const currentDistance = Math.hypot(current.x - center.x, current.y - center.y);
  return Math.min(20, Math.max(0.05, currentDistance / startDistance));
}

export function snapValue(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

export function resizeRect(start: Rect, handle: string, dx: number, dy: number): Rect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (handle.includes("w")) left = Math.min(right - 4, left + dx);
  if (handle.includes("e")) right = Math.max(left + 4, right + dx);
  if (handle.includes("n")) top = Math.min(bottom - 4, top + dy);
  if (handle.includes("s")) bottom = Math.max(top + 4, bottom + dy);
  return { x: left, y: top, w: right - left, h: bottom - top };
}
