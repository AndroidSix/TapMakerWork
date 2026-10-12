import type { DeviceProfile, Insets } from "@tapmakerwork/protocol";

export type CanvasEdge = "top" | "right" | "bottom" | "left";

export interface CanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MeasuredNode {
  id: string;
  name: string;
  type: string;
  rect: CanvasRect;
  hasChildren: boolean;
  insideScroll: boolean;
}

export interface SafeAreaIssue {
  id: string;
  name: string;
  type: string;
  kind: "outside-canvas" | "unsafe-area";
  edges: CanvasEdge[];
  rect: CanvasRect;
}

const CONTENT_TYPES = new Set(["Button", "Label", "Text", "TextField", "Input", "EditBox", "Checkbox", "CheckBox", "Toggle", "Slider"]);
const BACKGROUND_COVERAGE = 0.9;
const TOLERANCE_PX = 1;
const EDGES: CanvasEdge[] = ["top", "right", "bottom", "left"];

export const EDGE_LABEL: Record<CanvasEdge, string> = {
  top: "顶部（刘海/状态栏）",
  right: "右侧",
  bottom: "底部（Home 指示条）",
  left: "左侧"
};

export function safeInsetsInCanvas(device: DeviceProfile, canvas: { width: number; height: number }): Insets {
  return {
    top: (device.safeArea.top / device.height) * canvas.height,
    right: (device.safeArea.right / device.width) * canvas.width,
    bottom: (device.safeArea.bottom / device.height) * canvas.height,
    left: (device.safeArea.left / device.width) * canvas.width
  };
}

function isContentNode(node: MeasuredNode, canvas: { width: number; height: number }): boolean {
  if (CONTENT_TYPES.has(node.type)) return true;
  if (node.hasChildren) return false;
  return node.rect.width < canvas.width * BACKGROUND_COVERAGE && node.rect.height < canvas.height * BACKGROUND_COVERAGE;
}

function overflowEdges(rect: CanvasRect, bounds: { left: number; top: number; right: number; bottom: number }): CanvasEdge[] {
  const overflow: Record<CanvasEdge, boolean> = {
    top: rect.top < bounds.top - TOLERANCE_PX,
    right: rect.left + rect.width > bounds.right + TOLERANCE_PX,
    bottom: rect.top + rect.height > bounds.bottom + TOLERANCE_PX,
    left: rect.left < bounds.left - TOLERANCE_PX
  };
  return EDGES.filter((edge) => overflow[edge]);
}

export function findSafeAreaIssues(nodes: MeasuredNode[], canvas: { width: number; height: number }, insets: Insets): SafeAreaIssue[] {
  const issues: SafeAreaIssue[] = [];
  for (const node of nodes) {
    if (node.insideScroll || node.rect.width <= 0 || node.rect.height <= 0 || !isContentNode(node, canvas)) continue;
    const outside = overflowEdges(node.rect, { left: 0, top: 0, right: canvas.width, bottom: canvas.height });
    const unsafe = outside.length ? [] : overflowEdges(node.rect, {
      left: insets.left,
      top: insets.top,
      right: canvas.width - insets.right,
      bottom: canvas.height - insets.bottom
    });
    const edges = outside.length ? outside : unsafe;
    if (!edges.length) continue;
    issues.push({ id: node.id, name: node.name, type: node.type, kind: outside.length ? "outside-canvas" : "unsafe-area", edges, rect: node.rect });
  }
  return issues;
}

export function describeSafeAreaIssue(issue: SafeAreaIssue): string {
  const where = issue.edges.map((edge) => EDGE_LABEL[edge]).join("、");
  return issue.kind === "outside-canvas" ? `超出画布：${where}` : `进入非安全区：${where}`;
}
