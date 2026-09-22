import type { UiSnapshot } from "@tapmakerwork/protocol";
import type { Point, Rect } from "./runtime-transform";

export type RuntimeHitCandidate = Rect & {
  id: string;
  depth: number;
  layer: number;
  order: number;
};

export type RuntimeCoordinateSpace = {
  width: number;
  height: number;
  source: "logical" | "physical" | "root" | "fallback";
};

function sizeDistance(width: number, height: number, rect?: Rect): number {
  if (!rect || rect.w <= 0 || rect.h <= 0) return Number.POSITIVE_INFINITY;
  const widthRatio = Math.max(width, rect.w) / Math.max(1, Math.min(width, rect.w));
  const heightRatio = Math.max(height, rect.h) / Math.max(1, Math.min(height, rect.h));
  const aspect = width / Math.max(1, height);
  const rectAspect = rect.w / Math.max(1, rect.h);
  return Math.abs(Math.log(widthRatio)) + Math.abs(Math.log(heightRatio)) + Math.abs(Math.log(aspect / rectAspect)) * 2;
}

/** Chooses the same coordinate system used by engine hit-test rectangles. */
export function runtimeCoordinateSpace(snapshot: UiSnapshot | undefined, rootRect: Rect | undefined): RuntimeCoordinateSpace {
  const logical = snapshot?.viewport?.width && snapshot.viewport.height
    ? { width: snapshot.viewport.width, height: snapshot.viewport.height, source: "logical" as const }
    : undefined;
  const physical = snapshot?.viewport?.physicalWidth && snapshot.viewport.physicalHeight
    ? { width: snapshot.viewport.physicalWidth, height: snapshot.viewport.physicalHeight, source: "physical" as const }
    : undefined;
  if (rootRect && logical && physical) {
    return sizeDistance(physical.width, physical.height, rootRect) + .02 < sizeDistance(logical.width, logical.height, rootRect)
      ? physical
      : logical;
  }
  if (logical) return logical;
  if (physical) return physical;
  if (rootRect) return { width: rootRect.w, height: rootRect.h, source: "root" };
  return { width: 720, height: 1280, source: "fallback" };
}

export function stagePoint(clientX: number, clientY: number, bounds: Rect, space: RuntimeCoordinateSpace): Point {
  return {
    x: (clientX - bounds.x) / Math.max(1, bounds.w) * space.width,
    y: (clientY - bounds.y) / Math.max(1, bounds.h) * space.height
  };
}

function distanceToRect(point: Point, rect: Rect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - rect.x - rect.w);
  const dy = Math.max(rect.y - point.y, 0, point.y - rect.y - rect.h);
  return Math.hypot(dx, dy);
}

/**
 * Returns front-to-back selectable nodes. Large layout shells are suppressed
 * whenever a more specific control is available; tiny controls get a small
 * pointer-sized halo so labels and icons remain selectable at fitted zoom.
 */
export function runtimeHitCandidates(
  boxes: RuntimeHitCandidate[],
  point: Point,
  space: RuntimeCoordinateSpace,
  tolerance: number
): RuntimeHitCandidate[] {
  const viewportArea = Math.max(1, space.width * space.height);
  const hits = boxes.flatMap((box) => {
    const distance = distanceToRect(point, box);
    const exact = distance === 0;
    const small = box.w <= tolerance * 4 || box.h <= tolerance * 4;
    if (!exact && !(small && distance <= tolerance)) return [];
    return [{ box, exact, distance, area: box.w * box.h }];
  });
  const hasSpecific = hits.some((hit) => hit.area / viewportArea < .28);
  return hits
    .filter((hit) => !hasSpecific || hit.area / viewportArea < .72)
    .sort((left, right) => {
      if (left.box.layer !== right.box.layer) return right.box.layer - left.box.layer;
      if (left.exact !== right.exact) return left.exact ? -1 : 1;
      if (left.box.depth !== right.box.depth) return right.box.depth - left.box.depth;
      if (left.distance !== right.distance) return left.distance - right.distance;
      if (left.area !== right.area) return left.area - right.area;
      return right.box.order - left.box.order;
    })
    .map((hit) => hit.box);
}

export function clipRectToSpace(rect: Rect, space: RuntimeCoordinateSpace): Rect {
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(space.width, rect.x + rect.w);
  const bottom = Math.min(space.height, rect.y + rect.h);
  return {
    x: left,
    y: top,
    w: Math.max(0, right - left),
    h: Math.max(0, bottom - top)
  };
}
