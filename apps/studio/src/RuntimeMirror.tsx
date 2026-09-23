import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { BoxSelect, CirclePlay, Crosshair, Magnet, MonitorUp, MousePointer2, Move, RefreshCw, RotateCw, Scaling, Unplug, WandSparkles } from "lucide-react";
import type { UiNode, UiSnapshot, UiValue, WorkspaceMode } from "@tapmakerwork/protocol";
import { angleBetween, groupCenter, rectCenter, resizeRect, rotatePoint, scaleRatio, snapValue, toolForShortcut, type Point, type Rect, type TransformTool } from "./runtime-transform";
import { clipRectToSpace, runtimeCoordinateSpace, runtimeHitCandidates, stagePoint } from "./runtime-hit-test";
import { CoachMark } from "./NewbieGuide";

interface RuntimeMirrorProps {
  runtimeLive: boolean;
  runtimeBusy: boolean;
  runtimeConnected: boolean;
  adapterInstalled: boolean;
  installBusy: boolean;
  projectName: string;
  orientation: "portrait" | "landscape";
  snapshot?: UiSnapshot | undefined;
  snapshotSource?: "conversion" | "sidecar" | "runtime" | "empty" | undefined;
  selectedIds: string[];
  editRevision: number;
  mode: WorkspaceMode;
  coachRuntimeStart?: boolean;
  onCoachRuntimeStartDone?: () => void;
  onModeChange: (mode: WorkspaceMode) => void;
  onStart: () => void;
  onInstallAdapter: () => void;
  onSelect: (nodeId: string, additive?: boolean) => void;
  onContextMenu: (nodeId: string, x: number, y: number) => void;
  onPatch: (nodeId: string, props: Record<string, UiValue>, options?: { historyGroup?: string }) => Promise<void>;
  onToast: (message: string, kind?: "info" | "success" | "error" | "warn") => void;
  /** Project UI backend: NanoVG draw proxies vs Yoga declarative widgets. */
  uiBackend?: "yoga" | "nanovg" | undefined;
}

type Candidate = { id: string; name: string };
type RuntimeBox = Rect & { id: string; name: string; type: string; depth: number; layer: number; order: number; parentId?: string | undefined; props: Record<string, UiValue> };
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type TransformDraft = { rect: Rect; rotate: number; scale: number };
type StageSize = { width: number; height: number };
type DragState = {
  historyGroup: string;
  kind: "move" | "rotate" | "scale" | "resize";
  handle?: Handle | undefined;
  boxes: Array<{ box: RuntimeBox; parent?: RuntimeBox | undefined; start: TransformDraft }>;
  center: Point;
  startPoint: Point;
  startX: number;
  startY: number;
};

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function asRect(value: UiValue | undefined): Rect | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, UiValue>;
  const x = Number(record.x);
  const y = Number(record.y);
  const w = Number(record.w);
  const h = Number(record.h);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return undefined;
  return { x, y, w, h };
}

function isContainer(rect: Rect, screen: Rect): boolean {
  const area = (rect.w * rect.h) / (screen.w * screen.h);
  if (area >= 0.28) return true;
  return rect.w >= screen.w * 0.72 && rect.h >= screen.h * 0.18;
}

function overlayRootId(root: UiNode, screen: Rect | undefined): string | undefined {
  if (!screen) return undefined;
  const children = Array.isArray(root.children) ? root.children : [];
  const only = children[0];
  if (children.length === 1 && only) return overlayRootId(only, screen);
  for (let index = children.length - 1; index >= 1; index -= 1) {
    const child = children[index];
    if (!child) continue;
    const rect = asRect(child.props.$screen);
    if (rect && isContainer(rect, screen)) return child.id;
  }
  return undefined;
}

export function collectRuntimeBoxes(root: UiNode): RuntimeBox[] {
  const boxes: RuntimeBox[] = [];
  const screen = asRect(root.props.$screen);
  const overlayId = overlayRootId(root, screen);
  const visit = (node: UiNode, depth: number, parentId: string | undefined, insideOverlay: boolean) => {
    const rect = asRect(node.props.$screen);
    const inOverlay = insideOverlay || node.id === overlayId;
    if (rect && node.props.visible !== false) {
      const container = screen ? isContainer(rect, screen) : false;
      const layer = inOverlay && !container ? 8000 + depth : depth;
      boxes.push({ ...rect, id: node.id, name: node.name, type: node.type, depth, layer, order: boxes.length, parentId, props: node.props });
    }
    for (const child of Array.isArray(node.children) ? node.children : []) visit(child, depth + 1, node.id, inOverlay);
  };
  visit(root, 0, undefined, false);
  return boxes;
}

function numeric(value: UiValue | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function transformScale(props: Record<string, UiValue>): number {
  const transform = props.transform;
  if (!transform || typeof transform !== "object" || Array.isArray(transform)) return 1;
  return numeric((transform as Record<string, UiValue>).scale, 1);
}

function transformPatch(
  item: DragState["boxes"][number],
  current: TransformDraft,
  kind: DragState["kind"],
  logicalScale: Point
): Record<string, UiValue> {
  const props: Record<string, UiValue> = {
    position: "absolute",
    left: Math.round((current.rect.x - (item.parent?.x || 0)) * logicalScale.x),
    top: Math.round((current.rect.y - (item.parent?.y || 0)) * logicalScale.y)
  };
  if (kind === "move" || kind === "resize") {
    props.width = Math.round(current.rect.w * logicalScale.x);
    props.height = Math.round(current.rect.h * logicalScale.y);
  }
  if (kind === "rotate") props.rotate = Math.round(current.rotate * 10) / 10;
  if (kind === "scale") {
    const existing = item.box.props.transform;
    const transform = existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, UiValue>) }
      : {};
    props.transform = { ...transform, scale: Math.round(current.scale * 1000) / 1000 };
  }
  return props;
}

export function RuntimeMirror({
  runtimeLive,
  runtimeBusy,
  runtimeConnected,
  adapterInstalled,
  installBusy,
  projectName,
  orientation,
  snapshot,
  snapshotSource,
  selectedIds,
  editRevision,
  mode,
  coachRuntimeStart = false,
  onCoachRuntimeStartDone,
  onModeChange,
  onStart,
  onInstallAdapter,
  onSelect,
  onContextMenu,
  onPatch,
  onToast,
  uiBackend
}: RuntimeMirrorProps) {
  const [frame, setFrame] = useState("");
  const [liveFrame, setLiveFrame] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState("");
  const [permission, setPermission] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [tool, setTool] = useState<TransformTool>("move");
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, TransformDraft>>({});
  const draftsRef = useRef<Record<string, TransformDraft>>({});
  const captureInFlight = useRef(false);
  const frameRef = useRef("");
  const stageRef = useRef<HTMLDivElement | null>(null);
  const editorViewportRef = useRef<HTMLDivElement | null>(null);
  const liveViewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const livePatchTimerRef = useRef<number | null>(null);
  const livePatchChainRef = useRef<Promise<void>>(Promise.resolve());
  const [stageSizes, setStageSizes] = useState<{ editor?: StageSize; live?: StageSize }>({});
  const [frameAspect, setFrameAspect] = useState(0);
  const [hoveredId, setHoveredId] = useState<string>();
  const [hitCount, setHitCount] = useState(0);
  const hitCycleRef = useRef<{ x: number; y: number; ids: string[]; index: number; at: number } | undefined>(undefined);

  const boxes = useMemo(() => snapshot && snapshotSource === "runtime" ? collectRuntimeBoxes(snapshot.root) : [], [snapshot, snapshotSource]);
  const boxMap = useMemo(() => new Map(boxes.map((box) => [box.id, box])), [boxes]);
  const selected = snapshot?.selectedId ? boxMap.get(snapshot.selectedId) : undefined;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const rootRect = asRect(snapshot?.root.props.$screen);
  const coordinateSpace = runtimeCoordinateSpace(snapshot, rootRect);
  const viewport = { width: coordinateSpace.width, height: coordinateSpace.height };
  const logicalScale = {
    x: snapshot?.viewport?.width ? snapshot.viewport.width / Math.max(1, coordinateSpace.width) : 1,
    y: snapshot?.viewport?.height ? snapshot.viewport.height / Math.max(1, coordinateSpace.height) : 1
  };
  const editable = runtimeLive && runtimeConnected && snapshotSource === "runtime" && boxes.length > 0;
  const stageRatio = snapshotSource === "runtime" && viewport.height > 0
    ? viewport.width / viewport.height
    : frameAspect > 0 ? frameAspect : viewport.width / Math.max(1, viewport.height);

  useEffect(() => {
    const fit = (element: HTMLDivElement | null): StageSize | undefined => {
      if (!element || stageRatio <= 0) return undefined;
      const availableWidth = Math.max(1, element.clientWidth - 20);
      const availableHeight = Math.max(1, element.clientHeight - 34);
      let width = availableWidth;
      let height = width / stageRatio;
      if (height > availableHeight) {
        height = availableHeight;
        width = height * stageRatio;
      }
      return {
        width: Math.max(1, Math.floor(width)),
        height: Math.max(1, Math.floor(height))
      };
    };
    const update = () => {
      const next: { editor?: StageSize; live?: StageSize } = {};
      const editor = fit(editorViewportRef.current);
      const live = mode === "live-edit" ? fit(liveViewportRef.current) : undefined;
      if (editor) next.editor = editor;
      if (live) next.live = live;
      setStageSizes((current) => {
        const same = current.editor?.width === next.editor?.width
          && current.editor?.height === next.editor?.height
          && current.live?.width === next.live?.width
          && current.live?.height === next.live?.height;
        return same ? current : next;
      });
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    if (editorViewportRef.current) observer?.observe(editorViewportRef.current);
    if (liveViewportRef.current) observer?.observe(liveViewportRef.current);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [frameAspect, mode, snapshotSource, stageRatio, viewport.height, viewport.width]);

  const setDraftValues = (value: Record<string, TransformDraft>) => {
    draftsRef.current = value;
    setDrafts(value);
  };

  const capture = useCallback(async (requestedSourceId = sourceId, announce = false, syncEditorFrame = true, background = false) => {
    const captureRuntime = window.tapMakerWork?.captureRuntime || window.tapMakerWork?.runtime?.capture;
    if (!captureRuntime || captureInFlight.current) return;
    captureInFlight.current = true;
    if (!background) setCapturing(true);
    try {
      const result = await captureRuntime({
        projectName,
        ...(requestedSourceId ? { sourceId: requestedSourceId } : {}),
        orientation,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height
      });
      setCandidates(result.candidates ?? []);
      setPermission(result.permission || "");
      if (result.ok && result.dataUrl) {
        setLiveFrame(result.dataUrl);
        if (result.width && result.height) setFrameAspect(result.width / result.height);
        if (syncEditorFrame || !frameRef.current) {
          frameRef.current = result.dataUrl;
          setFrame(result.dataUrl);
        }
        setSourceId(result.sourceId || requestedSourceId);
        setSourceName(result.sourceName || "Maker Runtime");
        setError("");
        if (announce) onToast("已同步真实 Runtime 画面", "success");
      } else {
        setError(result.error || "runtime_capture_failed");
        if (result.error === "runtime_window_not_found") setSourceId("");
      }
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : String(captureError));
    } finally {
      captureInFlight.current = false;
      if (!background) setCapturing(false);
    }
  }, [onToast, orientation, projectName, sourceId, viewport.height, viewport.width]);

  useEffect(() => {
    if (!runtimeLive) return;
    if (!window.tapMakerWork?.captureRuntime && !window.tapMakerWork?.runtime) {
      setError("runtime_capture_unavailable");
      return;
    }
    void capture(sourceId, false, true);
    // Keep both panes on the newest engine frame so property edits and
    // transform commits are visible in the edit view as soon as Runtime paints.
    const timer = window.setInterval(
      () => void capture(sourceId, false, true, true),
      mode === "live-edit" ? 220 : 800
    );
    return () => window.clearInterval(timer);
  }, [capture, mode, runtimeLive, sourceId]);

  useEffect(() => {
    if (!runtimeLive || mode !== "live-edit" || editRevision <= 0) return;
    const timer = window.setTimeout(() => void capture(sourceId, false, true, true), 60);
    return () => window.clearTimeout(timer);
  }, [capture, editRevision, mode, runtimeLive, sourceId]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      const stage = stageRef.current;
      if (!drag || !stage) return;
      const bounds = stage.getBoundingClientRect();
      const rawDx = (event.clientX - drag.startX) / Math.max(1, bounds.width) * viewport.width;
      const rawDy = (event.clientY - drag.startY) / Math.max(1, bounds.height) * viewport.height;
      const snapping = snapEnabled || event.ctrlKey || event.metaKey;
      const dx = snapping ? snapValue(rawDx, 10) : rawDx;
      const dy = snapping ? snapValue(rawDy, 10) : rawDy;
      const currentPoint = {
        x: (event.clientX - bounds.left) / Math.max(1, bounds.width) * viewport.width,
        y: (event.clientY - bounds.top) / Math.max(1, bounds.height) * viewport.height
      };
      const rawAngleDelta = angleBetween(drag.center, currentPoint) - angleBetween(drag.center, drag.startPoint);
      const angleDelta = snapping ? snapValue(rawAngleDelta * 180 / Math.PI, 15) * Math.PI / 180 : rawAngleDelta;
      const rawRatio = scaleRatio(drag.center, drag.startPoint, currentPoint);
      const ratio = snapping ? snapValue(rawRatio, 0.1) : rawRatio;
      const next: Record<string, TransformDraft> = {};
      for (const item of drag.boxes) {
        const start = item.start;
        if (drag.kind === "move") {
          next[item.box.id] = { ...start, rect: { ...start.rect, x: start.rect.x + dx, y: start.rect.y + dy } };
        } else if (drag.kind === "resize") {
          next[item.box.id] = { ...start, rect: resizeRect(start.rect, drag.handle || "se", dx, dy) };
        } else if (drag.kind === "rotate") {
          const center = rotatePoint(rectCenter(start.rect), drag.center, angleDelta);
          next[item.box.id] = {
            ...start,
            rect: { ...start.rect, x: center.x - start.rect.w / 2, y: center.y - start.rect.h / 2 },
            rotate: start.rotate + angleDelta * 180 / Math.PI
          };
        } else {
          const originalCenter = rectCenter(start.rect);
          const center = {
            x: drag.center.x + (originalCenter.x - drag.center.x) * ratio,
            y: drag.center.y + (originalCenter.y - drag.center.y) * ratio
          };
          next[item.box.id] = {
            ...start,
            rect: { ...start.rect, x: center.x - start.rect.w / 2, y: center.y - start.rect.h / 2 },
            scale: start.scale * ratio
          };
        }
      }
      setDraftValues(next);
      if (livePatchTimerRef.current == null) {
        livePatchTimerRef.current = window.setTimeout(() => {
          livePatchTimerRef.current = null;
          const activeDrag = dragRef.current;
          if (!activeDrag) return;
          const latestDrafts = draftsRef.current;
          livePatchChainRef.current = livePatchChainRef.current
            .catch(() => undefined)
            .then(async () => {
              for (const item of activeDrag.boxes) {
                const current = latestDrafts[item.box.id] || item.start;
                await onPatch(item.box.id, transformPatch(item, current, activeDrag.kind, logicalScale), { historyGroup: activeDrag.historyGroup });
              }
            })
            .catch((error) => onToast(`实时变换失败：${error instanceof Error ? error.message : String(error)}`, "error"));
        }, 40);
      }
    };
    const onUp = async () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      if (livePatchTimerRef.current != null) {
        window.clearTimeout(livePatchTimerRef.current);
        livePatchTimerRef.current = null;
      }
      try {
        await livePatchChainRef.current.catch(() => undefined);
        for (const item of drag.boxes) {
          const current = draftsRef.current[item.box.id] || item.start;
          const changed = Math.abs(current.rect.x - item.start.rect.x) > 0.5
            || Math.abs(current.rect.y - item.start.rect.y) > 0.5
            || Math.abs(current.rect.w - item.start.rect.w) > 0.5
            || Math.abs(current.rect.h - item.start.rect.h) > 0.5
            || Math.abs(current.rotate - item.start.rotate) > 0.1
            || Math.abs(current.scale - item.start.scale) > 0.005;
          if (!changed) continue;
          await onPatch(item.box.id, transformPatch(item, current, drag.kind, logicalScale), { historyGroup: drag.historyGroup });
        }
        window.setTimeout(() => {
          if (!dragRef.current) setDraftValues({});
        }, 650);
      } catch (patchError) {
        setDraftValues({});
        onToast(`实时修改失败：${patchError instanceof Error ? patchError.message : String(patchError)}`, "error");
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (livePatchTimerRef.current != null) window.clearTimeout(livePatchTimerRef.current);
    };
  }, [logicalScale.x, logicalScale.y, onPatch, onToast, snapEnabled, viewport.height, viewport.width]);

  const beginDrag = (box: RuntimeBox, event: ReactPointerEvent, requestedKind?: DragState["kind"], handle?: Handle) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) {
      onSelect(box.id, true);
      return;
    }
    if (!selectedSet.has(box.id)) onSelect(box.id);
    if (mode !== "live-edit") return;
    const kind = requestedKind || (tool === "rotate" ? "rotate" : tool === "scale" ? "scale" : tool === "rect" ? "move" : tool === "move" ? "move" : undefined);
    if (!kind) return;
    const activeIds = selectedSet.has(box.id) ? selectedIds : [box.id];
    const activeBoxes = activeIds.map((id) => boxMap.get(id)).filter((item): item is RuntimeBox => Boolean(item));
    if (!activeBoxes.length) activeBoxes.push(box);
    const stage = stageRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    const startPoint = {
      x: (event.clientX - bounds.left) / Math.max(1, bounds.width) * viewport.width,
      y: (event.clientY - bounds.top) / Math.max(1, bounds.height) * viewport.height
    };
    const startDrafts = Object.fromEntries(activeBoxes.map((item) => [item.id, {
      rect: { x: item.x, y: item.y, w: item.w, h: item.h },
      rotate: numeric(item.props.rotate),
      scale: transformScale(item.props)
    } satisfies TransformDraft]));
    dragRef.current = {
      historyGroup: crypto.randomUUID(),
      kind,
      ...(handle ? { handle } : {}),
      boxes: activeBoxes.map((item) => ({
        box: item,
        ...(item.parentId ? { parent: boxMap.get(item.parentId) } : {}),
        start: startDrafts[item.id]!
      })),
      center: groupCenter(activeBoxes),
      startPoint,
      startX: event.clientX,
      startY: event.clientY
    };
    setDraftValues(startDrafts);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const hitCandidatesForEvent = (event: { clientX: number; clientY: number }): RuntimeBox[] => {
    const stage = stageRef.current;
    if (!stage) return [];
    const bounds = stage.getBoundingClientRect();
    const point = stagePoint(event.clientX, event.clientY, {
      x: bounds.left,
      y: bounds.top,
      w: bounds.width,
      h: bounds.height
    }, coordinateSpace);
    const tolerance = Math.max(
      coordinateSpace.width / Math.max(1, bounds.width) * 7,
      coordinateSpace.height / Math.max(1, bounds.height) * 7
    );
    return runtimeHitCandidates(boxes, point, coordinateSpace, tolerance) as RuntimeBox[];
  };

  const chooseHitForEvent = (event: { clientX: number; clientY: number }): RuntimeBox | undefined => {
    const candidates = hitCandidatesForEvent(event);
    setHitCount(candidates.length);
    if (!candidates.length) return undefined;
    const ids = candidates.map((candidate) => candidate.id);
    const previous = hitCycleRef.current;
    const samePoint = previous
      && performance.now() - previous.at < 1_200
      && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 5
      && previous.ids.length === ids.length
      && previous.ids.every((id, index) => id === ids[index]);
    const index = samePoint ? (previous.index + 1) % candidates.length : 0;
    hitCycleRef.current = { x: event.clientX, y: event.clientY, ids, index, at: performance.now() };
    return candidates[index];
  };

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true'], .monaco-editor *")) return;
      const nextTool = toolForShortcut(event.key);
      if (nextTool && mode === "live-edit") {
        event.preventDefault();
        setTool(nextTool);
        return;
      }
      const amount = event.shiftKey ? 10 : 1;
      const delta: [number, number] | undefined = event.key === "ArrowLeft" ? [-amount, 0]
        : event.key === "ArrowRight" ? [amount, 0]
          : event.key === "ArrowUp" ? [0, -amount]
            : event.key === "ArrowDown" ? [0, amount]
              : undefined;
      if (!delta || mode !== "live-edit" || !editable) return;
      event.preventDefault();
      void (async () => {
        for (const id of selectedIds) {
          const item = boxMap.get(id);
          if (!item) continue;
          const parent = item.parentId ? boxMap.get(item.parentId) : undefined;
          await onPatch(id, {
            position: "absolute",
            left: Math.round((item.x - (parent?.x || 0)) * logicalScale.x + delta[0]),
            top: Math.round((item.y - (parent?.y || 0)) * logicalScale.y + delta[1]),
            width: Math.round(item.w * logicalScale.x),
            height: Math.round(item.h * logicalScale.y)
          });
        }
      })().catch((error) => onToast(`移动节点失败：${error instanceof Error ? error.message : String(error)}`, "error"));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [boxMap, editable, logicalScale.x, logicalScale.y, mode, onPatch, onToast, selectedIds]);

  const permissionBlocked = Boolean(permission && permission !== "granted");
  const selectedDraft = selected ? drafts[selected.id] : undefined;
  const selectedRect = selectedDraft?.rect || selected || { x: 0, y: 0, w: 0, h: 0 };
  const resolvedBackend = uiBackend
    || (snapshot?.backend === "nanovg" || snapshot?.backend === "yoga" ? snapshot.backend : undefined);
  const backendTip = resolvedBackend === "nanovg"
    ? { kind: "nanovg" as const, label: "NanoVG 绘制：只编辑展示，不回写代码" }
    : resolvedBackend === "yoga"
      ? { kind: "yoga" as const, label: "Yoga 声明式 UI" }
      : undefined;

  return (
    <div className="runtime-mirror runtime-editor">
      <header className="runtime-mirror-toolbar">
        <div>
          <strong>
            <MonitorUp size={14} aria-hidden="true" />运行时场景编辑
            {backendTip && (
              <span
                className={`runtime-backend-tip ${backendTip.kind}`}
                title={backendTip.kind === "nanovg"
                  ? "当前项目用 NanoVG 即时绘制。IDE 改动能在预览里看到，默认只存旁路覆盖，不会改写你的游戏 Lua。"
                  : "当前项目使用 Yoga / UILoader 声明式控件树，编辑可同步到运行时控件与视觉旁路。"}
              >
                {backendTip.label}
              </span>
            )}
          </strong>
          <small>{frame ? `${sourceName} · 最终渲染帧` : "Maker Runtime 独立窗口"}</small>
        </div>
        <div className="runtime-edit-modes" aria-label="运行时画布模式">
          <button type="button" className={mode === "inspect" ? "active" : ""} onClick={() => onModeChange("inspect")}><Crosshair size={13} />检查</button>
          <button
            type="button"
            className={mode === "live-edit" ? "active" : ""}
            disabled={!frame || installBusy || runtimeBusy}
            title={editable ? "编辑真实 Runtime 控件" : "重新接入编辑桥并连接 Runtime"}
            onClick={() => editable ? onModeChange("live-edit") : onInstallAdapter()}
          ><Move size={13} />编辑</button>
        </div>
        {mode === "live-edit" && <div className="runtime-transform-tools" role="toolbar" aria-label="变换工具">
          <button type="button" className={tool === "select" ? "active" : ""} aria-pressed={tool === "select"} aria-label="选择工具，快捷键 Q" title="选择 (Q)" onClick={() => setTool("select")}><MousePointer2 size={14} aria-hidden="true" /><kbd>Q</kbd></button>
          <button type="button" className={tool === "move" ? "active" : ""} aria-pressed={tool === "move"} aria-label="移动工具，快捷键 W" title="移动 (W)" onClick={() => setTool("move")}><Move size={14} aria-hidden="true" /><kbd>W</kbd></button>
          <button type="button" className={tool === "rotate" ? "active" : ""} aria-pressed={tool === "rotate"} aria-label="旋转工具，快捷键 E" title="旋转 (E)" onClick={() => setTool("rotate")}><RotateCw size={14} aria-hidden="true" /><kbd>E</kbd></button>
          <button type="button" className={tool === "scale" ? "active" : ""} aria-pressed={tool === "scale"} aria-label="缩放工具，快捷键 R" title="缩放 (R)" onClick={() => setTool("scale")}><Scaling size={14} aria-hidden="true" /><kbd>R</kbd></button>
          <button type="button" className={tool === "rect" ? "active" : ""} aria-pressed={tool === "rect"} aria-label="矩形工具，快捷键 T" title="矩形变换 (T)" onClick={() => setTool("rect")}><BoxSelect size={14} aria-hidden="true" /><kbd>T</kbd></button>
          <button type="button" className={snapEnabled ? "active snap" : "snap"} aria-pressed={snapEnabled} aria-label="增量吸附；拖动时也可按住 Ctrl 或 Command 临时启用" title="增量吸附 (Ctrl/Cmd 临时启用)" onClick={() => setSnapEnabled((enabled) => !enabled)}><Magnet size={14} aria-hidden="true" /></button>
          {selectedIds.length > 1 && <span className="runtime-selection-count">{selectedIds.length} 个节点</span>}
        </div>}
        {candidates.length > 1 && (
          <label>
            <span>窗口</span>
            <select value={sourceId} onChange={(event) => {
              const next = event.target.value;
              setSourceId(next);
              void capture(next, true);
            }}>
              <option value="">自动识别</option>
              {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
            </select>
          </label>
        )}
        <button type="button" disabled={!runtimeLive || capturing} onClick={() => void capture(sourceId, true)}><RefreshCw size={13} aria-hidden="true" />刷新画面</button>
      </header>

      <div className={`runtime-editor-shell ${mode === "live-edit" ? "runtime-editor-split" : ""}`}>
        <section className="runtime-editor-pane">
          <header><strong>{mode === "live-edit" ? "编辑视图" : "Runtime 场景"}</strong><span>{mode === "live-edit" ? "移动、旋转、缩放、Shift 多选" : "单击检查节点"}</span></header>
          <div className="runtime-stage-viewport" ref={editorViewportRef}>
            <div
              ref={stageRef}
              className={`runtime-mirror-stage runtime-editor-stage orientation-${orientation} tool-${tool} ${mode === "live-edit" ? "is-editing" : "is-inspecting"}`}
              style={{
                aspectRatio: `${stageRatio}`,
                ...(stageSizes.editor ? { width: stageSizes.editor.width, height: stageSizes.editor.height } : {})
              }}
              onPointerMove={(event) => {
                if (dragRef.current) return;
                const candidates = hitCandidatesForEvent(event);
                setHoveredId(candidates[0]?.id);
                setHitCount(candidates.length);
              }}
              onPointerLeave={() => { setHoveredId(undefined); setHitCount(0); }}
              onPointerDown={(event) => {
                if ((event.target as HTMLElement).closest(".runtime-transform-handle, .runtime-resize-handle")) return;
                const hit = chooseHitForEvent(event);
                if (hit) beginDrag(hit, event);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                const candidates = hitCandidatesForEvent(event);
                setHitCount(candidates.length);
                const hit = candidates[0];
                if (!hit) return;
                onSelect(hit.id);
                onContextMenu(hit.id, event.clientX, event.clientY);
              }}
            >
          {frame ? <img src={frame} alt={`Maker Runtime 实际运行画面：${sourceName}`} draggable={false} /> : (
            <div className="runtime-mirror-empty">
              <MonitorUp size={36} aria-hidden="true" />
              <strong>{runtimeLive ? "等待捕获 Runtime 窗口" : "Runtime 尚未启动"}</strong>
              <p>
                {permissionBlocked || error === "screen_recording_permission_required"
                  ? "macOS 未允许录屏。请在“系统设置 → 隐私与安全性 → 屏幕与系统音频录制”中允许 TapMakerWork。"
                  : error === "runtime_window_not_found"
                    ? "未自动识别到游戏窗口；请确认窗口已出现，或从上方窗口列表手动选择。"
                    : error === "runtime_frame_empty"
                      ? "找到了 Runtime 窗口，但画面是空的。请让游戏窗口保持可见且不要最小化，然后再试。"
                      : error === "runtime_capture_unavailable"
                        ? "当前不是支持窗口采样的桌面版本；请重启或更新 TapMakerWork。"
                        : error ? `窗口采样失败：${error}` : "启动运行器后，这里直接编辑最终渲染画面。"}
              </p>
              {!runtimeLive && (
                <CoachMark label="② 启动 Runtime" active={coachRuntimeStart}>
                  <button
                    type="button"
                    disabled={runtimeBusy}
                    onClick={() => {
                      onStart();
                      onCoachRuntimeStartDone?.();
                    }}
                  ><CirclePlay size={14} aria-hidden="true" />{runtimeBusy ? "启动中…" : "启动 Maker Runtime"}</button>
                </CoachMark>
              )}
            </div>
          )}

          {editable && boxes.map((box) => {
            const currentDraft = drafts[box.id];
            const baseRect = currentDraft?.rect || box;
            const rotation = currentDraft?.rotate ?? numeric(box.props.rotate);
            const scale = currentDraft?.scale ?? transformScale(box.props);
            const draftScaleRatio = currentDraft ? scale / Math.max(.001, transformScale(box.props)) : 1;
            const rect = currentDraft && Math.abs(draftScaleRatio - 1) > .001
              ? {
                  x: baseRect.x + baseRect.w * (1 - draftScaleRatio) / 2,
                  y: baseRect.y + baseRect.h * (1 - draftScaleRatio) / 2,
                  w: baseRect.w * draftScaleRatio,
                  h: baseRect.h * draftScaleRatio
                }
              : baseRect;
            const renderRect = clipRectToSpace(rect, coordinateSpace);
            const isSelected = selectedSet.has(box.id);
            const isPrimary = snapshot?.selectedId === box.id;
            const resizeHandles = rect.w < 72 || rect.h < 72 ? (["se"] as Handle[]) : HANDLES;
            return (
              <div
                key={box.id}
                className={`runtime-hit-box tool-${tool} ${isSelected ? "selected" : ""} ${isPrimary ? "primary" : ""} ${hoveredId === box.id ? "hovered" : ""}`}
                data-node-id={box.id}
                tabIndex={isPrimary ? 0 : -1}
                aria-selected={isSelected}
                aria-label={`${box.name || box.type}，${isSelected ? "已选择" : "未选择"}${mode === "live-edit" ? "，按住 Shift 可多选" : ""}`}
                style={{
                  left: `${renderRect.x / coordinateSpace.width * 100}%`,
                  top: `${renderRect.y / coordinateSpace.height * 100}%`,
                  width: `${renderRect.w / coordinateSpace.width * 100}%`,
                  height: `${renderRect.h / coordinateSpace.height * 100}%`,
                  zIndex: 20 + box.layer
                }}
              >
                {isPrimary && <span className="runtime-selection-label">{box.name || box.type}<small>{Math.round(rect.w * logicalScale.x)} × {Math.round(rect.h * logicalScale.y)}{rotation ? ` · ${Math.round(rotation)}°` : ""}{scale !== 1 ? ` · ${scale.toFixed(2)}×` : ""}</small></span>}
                {isPrimary && mode === "live-edit" && tool === "move" && <button type="button" className="runtime-move-handle" aria-label="拖动移动选中节点" onPointerDown={(event) => beginDrag(box, event, "move")}><Move size={13} /></button>}
                {isPrimary && mode === "live-edit" && tool === "rotate" && <button type="button" className="runtime-rotate-handle" aria-label="拖动旋转选中节点" onPointerDown={(event) => beginDrag(box, event, "rotate")}><RotateCw size={12} /></button>}
                {isPrimary && mode === "live-edit" && tool === "scale" && <button type="button" className="runtime-scale-handle" aria-label="拖动等比缩放选中节点" onPointerDown={(event) => beginDrag(box, event, "scale")}><Scaling size={12} /></button>}
                {isPrimary && mode === "live-edit" && tool === "rect" && resizeHandles.map((handle) => (
                  <button
                    type="button"
                    key={handle}
                    className={`runtime-resize-handle handle-${handle}`}
                    aria-label={`从 ${handle} 方向调整大小`}
                    onPointerDown={(event) => beginDrag(box, event, "resize", handle)}
                  />
                ))}
              </div>
            );
          })}

            {editable && <span className="runtime-mirror-badge">{frame ? "真实帧" : "Runtime 布局"} · {mode === "live-edit" ? `编辑视图实时同步${hitCount > 1 ? ` · ${hitCount} 个候选，再点轮换` : " · Shift 多选"}` : "控件树已对齐"}</span>}
            </div>
          </div>
        </section>

        {mode === "live-edit" && (
          <section className="runtime-editor-pane runtime-live-pane" aria-label="实际 Runtime 实时画面">
            <header><strong>实际 Runtime</strong><span><i />约 220ms 刷新</span></header>
            <div className="runtime-stage-viewport" ref={liveViewportRef}>
              <div
                className={`runtime-live-stage orientation-${orientation}`}
                style={{
                  aspectRatio: `${stageRatio}`,
                  ...(stageSizes.live ? { width: stageSizes.live.width, height: stageSizes.live.height } : {})
                }}
                aria-label="实际 Runtime 只读画面"
                title="点击请直接操作独立的 Runtime 窗口"
              >
                {liveFrame || frame
                  ? <img src={liveFrame || frame} alt={`实际 Runtime 实时画面：${sourceName}`} draggable={false} />
                  : <div className="runtime-live-empty"><MonitorUp size={30} /><strong>实际窗口暂不可采样</strong><small>Runtime 活树仍可编辑；允许 macOS 屏幕录制后会自动恢复画面。</small></div>}
                {(liveFrame || frame) && <span>只读画面</span>}
              </div>
            </div>
          </section>
        )}

        {frame && !editable && (
          <div className="runtime-editor-gate">
            {adapterInstalled ? <Unplug size={22} aria-hidden="true" /> : <WandSparkles size={22} aria-hidden="true" />}
            <div>
              <strong>{adapterInstalled ? "运行时编辑桥尚未连接" : "启用所见即所得编辑"}</strong>
              <p>{adapterInstalled
                ? "将重新校验客户端入口并重启 Runtime；连接成功后即可读取真实绘制/控件树并拖拽编辑。"
                : "安装项目内编辑桥后，画面上的选择框来自引擎实际布局。Yoga 走控件树；NanoVG 项目会自动注入绘制代理，无需改游戏业务代码。"}</p>
            </div>
            <button type="button" disabled={installBusy || runtimeBusy} onClick={onInstallAdapter}>
              {adapterInstalled ? <RefreshCw size={14} /> : <BoxSelect size={14} />}
              {installBusy ? "接入中…" : adapterInstalled ? "重新接入并连接" : "接入当前项目"}
            </button>
            {adapterInstalled && !editable && (
              <p className="runtime-editor-gate-hint">因为项目众多，如果启动注入失败，请自行点击这里「重新接入并连接」再注入一次。</p>
            )}
          </div>
        )}
      </div>

      {selected && editable && (
        <footer className="runtime-editor-status">
          <span><BoxSelect size={13} />{selected.name || selected.type}{selectedIds.length > 1 ? ` +${selectedIds.length - 1}` : ""}</span>
          <span>{selected.type}</span>
          <span>x {Math.round(selectedRect.x * logicalScale.x)}</span>
          <span>y {Math.round(selectedRect.y * logicalScale.y)}</span>
          <span>w {Math.round(selectedRect.w * logicalScale.x)}</span>
          <span>h {Math.round(selectedRect.h * logicalScale.y)}</span>
        </footer>
      )}
    </div>
  );
}
