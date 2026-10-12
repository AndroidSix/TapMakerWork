import type { CSSProperties } from "react";
import { findUiNode, type UiNode, type UiSnapshot, type UiValue } from "@tapmakerwork/protocol";
import { API } from "../bridge-api";

export function labelForType(type: string): string {
  if (type === "Button") return "按钮";
  if (type === "Label") return "文字";
  if (type === "Panel") return "容器";
  if (type === "Node") return "空节点";
  return type;
}

export function rgba(value: UiValue | undefined, fallback = "transparent"): string {
  if (!Array.isArray(value) || value.length < 3) return typeof value === "string" ? value : fallback;
  const [r, g, b, a = 255] = value as number[];
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

export function displayValue(value: UiValue | undefined, fallback = ""): string {
  if (value == null) return fallback;
  if (typeof value === "object" && !Array.isArray(value) && "$expression" in value) {
    return `{${String(value.$expression)}}`;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function concreteValue(value: UiValue | undefined): UiValue | undefined {
  if (value && typeof value === "object" && !Array.isArray(value) && "$expression" in value) return undefined;
  return value;
}

export function dimension(value: UiValue | undefined): CSSProperties["width"] {
  if (typeof value === "number") return `${value}px`;
  if (typeof value === "string") return value;
  return undefined;
}

export function edgeValue(value: UiValue | undefined): string | number | undefined {
  if (typeof value === "number" || typeof value === "string") return value;
  if (Array.isArray(value) && value.every((part) => typeof part === "number" || typeof part === "string")) return value.map((part) => typeof part === "number" ? `${part}px` : part).join(" ");
  if (value && typeof value === "object") {
    const record = value as Record<string, UiValue>;
    const top = record.top ?? 0;
    const right = record.right ?? 0;
    const bottom = record.bottom ?? 0;
    const left = record.left ?? 0;
    return [top, right, bottom, left].map((part) => typeof part === "number" ? `${part}px` : String(part)).join(" ");
  }
  return undefined;
}

export function shadowValue(value: UiValue | undefined): string | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((shadow) => {
    if (!shadow || typeof shadow !== "object" || Array.isArray(shadow)) return "";
    const item = shadow as Record<string, UiValue>;
    return `${Number(item.x ?? 0)}px ${Number(item.y ?? 0)}px ${Number(item.blur ?? 0)}px ${rgba(item.color, "#000")}`;
  }).filter(Boolean).join(", ") || undefined;
}

export function runtimeLayoutBox(props: Record<string, UiValue>): { w?: number | undefined; h?: number | undefined; x?: number | undefined; y?: number | undefined } {
  const layout = props.$layout;
  if (layout && typeof layout === "object" && !Array.isArray(layout)) {
    const record = layout as Record<string, UiValue>;
    const num = (key: string) => typeof record[key] === "number" ? record[key] as number : undefined;
    const w = num("w");
    const h = num("h");
    const x = num("x");
    const y = num("y");
    // Yoga 未布局时全是 0，用 0 宽高会把画布压黑，忽略这类 layout
    const usable = (w != null && w > 0) || (h != null && h > 0) || (x != null && x !== 0) || (y != null && y !== 0);
    if (!usable) return {};
    return { x, y, w, h };
  }
  return {};
}

export function runtimeStyle(node: UiNode): CSSProperties {
  const props = node.props;
  const box = runtimeLayoutBox(props);
  const transform = props.transform && typeof props.transform === "object" && !Array.isArray(props.transform)
    ? props.transform as Record<string, UiValue>
    : {};
  const rotation = typeof props.rotate === "number" ? props.rotate : 0;
  const scale = typeof transform.scale === "number" ? transform.scale : 1;
  const backgroundImage = concreteValue(props.backgroundImage);
  const width = box.w != null && box.w > 0 ? `${box.w}px` : dimension(props.width);
  const height = box.h != null && box.h > 0 ? `${box.h}px` : dimension(props.height);
  const isEmptyFactory = Boolean(props.$factory) && uiChildren(node).length === 0;
  const isSlot = node.type === "Slot";
  return {
    width,
    height,
    minWidth: dimension(props.minWidth) ?? (isEmptyFactory || isSlot ? "72px" : "8px"),
    minHeight: dimension(props.minHeight) ?? (isEmptyFactory || isSlot ? "28px" : "12px"),
    maxWidth: dimension(props.maxWidth),
    maxHeight: dimension(props.maxHeight),
    display: "flex",
    flexDirection: props.flexDirection === "row" ? "row" : "column",
    justifyContent: typeof props.justifyContent === "string" ? props.justifyContent as CSSProperties["justifyContent"] : undefined,
    alignItems: typeof props.alignItems === "string" ? props.alignItems as CSSProperties["alignItems"] : undefined,
    alignSelf: typeof props.alignSelf === "string" ? props.alignSelf as CSSProperties["alignSelf"] : undefined,
    gap: typeof props.gap === "number" ? props.gap : undefined,
    padding: edgeValue(props.padding) ?? (isEmptyFactory ? 8 : undefined),
    paddingLeft: typeof props.paddingLeft === "number" ? props.paddingLeft : typeof props.paddingHorizontal === "number" ? props.paddingHorizontal : undefined,
    paddingRight: typeof props.paddingRight === "number" ? props.paddingRight : typeof props.paddingHorizontal === "number" ? props.paddingHorizontal : undefined,
    paddingTop: typeof props.paddingTop === "number" ? props.paddingTop : undefined,
    paddingBottom: typeof props.paddingBottom === "number" ? props.paddingBottom : undefined,
    margin: edgeValue(props.margin),
    marginLeft: typeof props.marginLeft === "number" ? props.marginLeft : undefined,
    marginRight: typeof props.marginRight === "number" ? props.marginRight : undefined,
    marginTop: typeof props.marginTop === "number" ? props.marginTop : undefined,
    marginBottom: typeof props.marginBottom === "number" ? props.marginBottom : undefined,
    background: rgba(props.backgroundColor, isEmptyFactory ? "#1a2233cc" : "transparent"),
    backgroundImage: typeof backgroundImage === "string" ? `url("${API}/api/project/asset?path=${encodeURIComponent(backgroundImage)}")` : undefined,
    backgroundBlendMode: typeof backgroundImage === "string" && props.color != null ? "multiply" : undefined,
    ...(typeof backgroundImage === "string" && props.color != null ? { backgroundColor: rgba(props.color, "#fff") } : {}),
    backgroundSize: props.backgroundFit === "cover" ? "cover" : props.backgroundFit === "contain" ? "contain" : undefined,
    backgroundPosition: "center",
    borderRadius: typeof props.borderRadius === "number" ? props.borderRadius : undefined,
    borderStyle: props.borderWidth != null || isEmptyFactory || isSlot ? "solid" : undefined,
    borderWidth: edgeValue(props.borderWidth) ?? (isEmptyFactory || isSlot ? 1 : undefined),
    borderColor: rgba(props.borderColor, isEmptyFactory || isSlot ? "#4b6288" : undefined),
    boxShadow: shadowValue(props.boxShadow),
    color: rgba(props.fontColor ?? props.textColor ?? props.color, "#e8edf5"),
    fontSize: typeof props.fontSize === "number" ? props.fontSize : undefined,
    fontWeight: props.fontWeight === "bold" ? 700 : undefined,
    textAlign: typeof props.textAlign === "string" ? props.textAlign as CSSProperties["textAlign"] : undefined,
    position: (box.x != null && box.x !== 0) || (box.y != null && box.y !== 0) || props.position === "absolute" ? "absolute" : "relative",
    left: box.x != null && (box.x !== 0 || box.y != null && box.y !== 0) ? box.x : typeof props.left === "number" ? props.left : undefined,
    top: box.y != null && (box.y !== 0 || box.x != null && box.x !== 0) ? box.y : typeof props.top === "number" ? props.top : undefined,
    right: typeof props.right === "number" ? props.right : undefined,
    bottom: typeof props.bottom === "number" ? props.bottom : undefined,
    flexGrow: typeof props.flexGrow === "number" ? props.flexGrow : (props.position !== "absolute" && !box.x && !box.y ? undefined : undefined),
    flexShrink: typeof props.flexShrink === "number" ? props.flexShrink : 1,
    boxSizing: "border-box",
    opacity: typeof props.opacity === "number" ? props.opacity : undefined,
    overflow: props.overflow === "hidden" ? "hidden" : "visible",
    pointerEvents: "auto",
    cursor: "pointer",
    transform: rotation || scale !== 1 ? `rotate(${rotation}deg) scale(${scale})` : undefined,
    transformOrigin: "center"
  };
}

export function uiChildren(node: UiNode): UiNode[] {
  return Array.isArray(node.children) ? node.children : [];
}

export function visualWeight(node: UiNode): number {
  if (!node || typeof node !== "object") return 0;
  if (node.props?.visible === false) return 0;
  const type = node.type || "";
  let score = 0;
  if (type === "Button" || type === "Label" || type === "Image") score += 2;
  else if (type === "Panel") score += node.props?.backgroundColor || node.props?.backgroundImage ? 2 : 0.25;
  else if (type === "Slot" || type === "Module") score += 0.1;
  else score += 0.5;
  const kids = Array.isArray(node.children) ? node.children : [];
  return score + kids.reduce((sum, child) => sum + visualWeight(child), 0);
}

export function imagePathFromProps(props: Record<string, UiValue>): string | undefined {
  const candidates = [props.path, props.sprite, props.image, props.texture, props.fileName, props.file];
  for (const value of candidates) {
    const concrete = concreteValue(value);
    if (typeof concrete === "string" && concrete.trim()) return concrete.trim();
  }
  return undefined;
}

export function keepValidSelection(current: UiSnapshot | undefined, incoming: UiSnapshot, preferredId?: string): UiSnapshot {
  // Runtime layout snapshots are authoritative for geometry, but selection is
  // editor-owned interaction state. Keep the local selection across frequent
  // engine ticks, and only fall back when that node was actually destroyed.
  const localId = preferredId || current?.selectedId;
  if (localId && findUiNode(incoming.root, localId)) {
    return { ...incoming, selectedId: localId };
  }
  if (incoming.selectedId && findUiNode(incoming.root, incoming.selectedId)) return incoming;
  const { selectedId: _selectedId, ...withoutSelection } = incoming;
  return withoutSelection;
}
