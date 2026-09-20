import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { BoxSelect, CirclePlay, Crosshair, Magnet, MonitorUp, MousePointer2, Move, RefreshCw, RotateCw, Scaling, Unplug, WandSparkles } from "lucide-react";
import type { UiNode, UiSnapshot, UiValue, WorkspaceMode } from "@tapmakerwork/protocol";
import { angleBetween, groupCenter, rectCenter, resizeRect, rotatePoint, scaleRatio, snapValue, toolForShortcut, type Point, type Rect, type TransformTool } from "./runtime-transform";

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
  onModeChange: (mode: WorkspaceMode) => void;
  onStart: () => void;
  onRefreshRuntime: () => void;
  onInstallAdapter: () => void;
  onSelect: (nodeId: string, additive?: boolean) => void;
  onContextMenu: (nodeId: string, x: number, y: number) => void;
  onPatch: (nodeId: string, props: Record<string, UiValue>, options?: { historyGroup?: string }) => Promise<void>;
  onToast: (message: string, kind?: "info" | "success" | "error" | "warn") => void;
}

type Candidate = { id: string; name: string };
type RuntimeBox = Rect & { id: string; name: string; type: string; depth: number; parentId?: string | undefined; props: Record<string, UiValue> };
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type TransformDraft = { rect: Rect; rotate: number; scale: number };
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

function collectRuntimeBoxes(root: UiNode): RuntimeBox[] {
  const boxes: RuntimeBox[] = [];
  const visit = (node: UiNode, depth: number, parentId?: string) => {
    const rect = asRect(node.props.$screen);
    if (rect && node.props.visible !== false) boxes.push({ ...rect, id: node.id, name: node.name, type: node.type, depth, parentId, props: node.props });
    for (const child of Array.isArray(node.children) ? node.children : []) visit(child, depth + 1, node.id);
  };
  visit(root, 0);
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
  kind: DragState["kind"]
): Record<string, UiValue> {
  const props: Record<string, UiValue> = {
    position: "absolute",
    left: Math.round(current.rect.x - (item.parent?.x || 0)),
    top: Math.round(current.rect.y - (item.parent?.y || 0))
  };
  if (kind === "move" || kind === "resize") {
    props.width = Math.round(current.rect.w);
    props.height = Math.round(current.rect.h);
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
  onModeChange,
  onStart,
  onRefreshRuntime,
  onInstallAdapter,
  onSelect,
  onContextMenu,
  onPatch,
  onToast
}: RuntimeMirrorProps) {
  const [frame, setFrame] = useState("");
  const [liveFrame, setLiveFrame] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState("");
  const [permission, setPermission] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [inputSending, setInputSending] = useState(false);
  const [inputError, setInputError] = useState("");
  const [tool, setTool] = useState<TransformTool>("move");
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, TransformDraft>>({});
  const draftsRef = useRef<Record<string, TransformDraft>>({});
  const captureInFlight = useRef(false);
  const frameRef = useRef("");
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const livePatchTimerRef = useRef<number | null>(null);
  const livePatchChainRef = useRef<Promise<void>>(Promise.resolve());

  const boxes = useMemo(() => snapshot && snapshotSource === "runtime" ? collectRuntimeBoxes(snapshot.root) : [], [snapshot, snapshotSource]);
  const boxMap = useMemo(() => new Map(boxes.map((box) => [box.id, box])), [boxes]);
  const selected = snapshot?.selectedId ? boxMap.get(snapshot.selectedId) : undefined;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const rootRect = asRect(snapshot?.root.props.$screen);
  const viewport = {
    width: snapshot?.viewport?.width || rootRect?.w || (orientation === "portrait" ? 390 : 844),
    height: snapshot?.viewport?.height || rootRect?.h || (orientation === "portrait" ? 844 : 390)
  };
  const editable = runtimeLive && runtimeConnected && snapshotSource === "runtime" && boxes.length > 0;

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
                await onPatch(item.box.id, transformPatch(item, current, activeDrag.kind), { historyGroup: activeDrag.historyGroup });
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
          await onPatch(item.box.id, transformPatch(item, current, drag.kind), { historyGroup: drag.historyGroup });
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
  }, [onPatch, onToast, snapEnabled, viewport.height, viewport.width]);

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
            left: Math.round(item.x - (parent?.x || 0) + delta[0]),
            top: Math.round(item.y - (parent?.y || 0) + delta[1]),
            width: Math.round(item.w),
            height: Math.round(item.h)
          });
        }
      })().catch((error) => onToast(`移动节点失败：${error instanceof Error ? error.message : String(error)}`, "error"));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [boxMap, editable, mode, onPatch, onToast, selectedIds]);

  const permissionBlocked = Boolean(permission && permission !== "granted");
  const selectedDraft = selected ? drafts[selected.id] : undefined;
  const selectedRect = selectedDraft?.rect || selected || { x: 0, y: 0, w: 0, h: 0 };

  const interactWithRuntime = async (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!sourceName || !sourceId || !window.tapMakerWork?.runtime?.interact || inputSending) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    setInputSending(true);
    setInputError("");
    try {
      const result = await window.tapMakerWork.runtime.interact({
        sourceName,
        sourceId,
        normalizedX: (event.clientX - bounds.left) / bounds.width,
        normalizedY: (event.clientY - bounds.top) / bounds.height,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height
      });
      if (!result.ok) throw new Error(result.error || "runtime_input_failed");
      window.setTimeout(() => void capture(sourceId, false, true, true), 55);
    } catch (interactionError) {
      const message = interactionError instanceof Error ? interactionError.message : String(interactionError);
      setInputError(message);
      onToast(message.includes("accessibility_permission_required") || message.includes("not authorized") || message.includes("不被允许")
        ? "需要在系统设置中允许 TapMakerWork 控制电脑，才能把点击传给 Runtime"
        : `Runtime 点击转发失败：${message}`, "error");
    } finally {
      setInputSending(false);
    }
  };

  return (
    <div className="runtime-mirror runtime-editor">
      <header className="runtime-mirror-toolbar">
        <div>
          <strong><MonitorUp size={14} aria-hidden="true" />运行时场景编辑</strong>
          <small>{frame ? `${sourceName} · 最终渲染帧` : "Maker Runtime 独立窗口"}</small>
        </div>
        <div className="runtime-edit-modes" aria-label="运行时画布模式">
          <button type="button" className={mode === "play" ? "active" : ""} disabled={!frame} onClick={() => onModeChange("play")}><CirclePlay size={13} />游玩</button>
          <button type="button" className={mode === "inspect" ? "active" : ""} onClick={() => onModeChange("inspect")}><Crosshair size={13} />检查</button>
          <button type="button" className={mode === "live-edit" ? "active" : ""} disabled={!editable} onClick={() => onModeChange("live-edit")}><Move size={13} />编辑</button>
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
          <header><strong>{mode === "live-edit" ? "编辑视图" : mode === "play" ? "实际 Runtime" : "Runtime 场景"}</strong><span>{mode === "live-edit" ? "移动、旋转、缩放、Shift 多选" : mode === "play" ? "点击会传入真正的游戏窗口" : "单击检查节点"}</span></header>
          <div
            ref={stageRef}
            className={`runtime-mirror-stage runtime-editor-stage orientation-${orientation} ${mode === "live-edit" ? "is-editing" : mode === "play" ? "is-playing runtime-live-interactive" : "is-inspecting"}`}
            style={{ aspectRatio: `${viewport.width}/${viewport.height}` }}
            role={mode === "play" ? "application" : undefined}
            tabIndex={mode === "play" ? 0 : undefined}
            aria-label={mode === "play" ? "实际 Runtime，可直接点击游玩" : undefined}
            onPointerUp={mode === "play" ? (event) => void interactWithRuntime(event) : undefined}
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
                      ? "找到了 Runtime 窗口，但系统返回了空画面；授权录屏后请重启 TapMakerWork。"
                      : error === "runtime_capture_unavailable"
                        ? "当前不是支持窗口采样的桌面版本；请重启或更新 TapMakerWork。"
                        : error ? `窗口采样失败：${error}` : "启动运行器后，这里直接编辑最终渲染画面。"}
              </p>
              {!runtimeLive && <button type="button" disabled={runtimeBusy} onClick={onStart}><CirclePlay size={14} aria-hidden="true" />{runtimeBusy ? "启动中…" : "启动 Maker Runtime"}</button>}
            </div>
          )}

          {editable && boxes.map((box) => {
            const currentDraft = drafts[box.id];
            const rect = currentDraft?.rect || box;
            const rotation = currentDraft?.rotate ?? numeric(box.props.rotate);
            const scale = currentDraft?.scale ?? transformScale(box.props);
            const isSelected = selectedSet.has(box.id);
            const isPrimary = snapshot?.selectedId === box.id;
            const resizeHandles = rect.w < 72 || rect.h < 72 ? (["se"] as Handle[]) : HANDLES;
            return (
              <div
                key={box.id}
                className={`runtime-hit-box tool-${tool} ${isSelected ? "selected" : ""} ${isPrimary ? "primary" : ""}`}
                data-node-id={box.id}
                tabIndex={isPrimary ? 0 : -1}
                aria-selected={isSelected}
                aria-label={`${box.name || box.type}，${isSelected ? "已选择" : "未选择"}${mode === "live-edit" ? "，按住 Shift 可多选" : ""}`}
                style={{
                  left: `${rect.x / viewport.width * 100}%`,
                  top: `${rect.y / viewport.height * 100}%`,
                  width: `${rect.w / viewport.width * 100}%`,
                  height: `${rect.h / viewport.height * 100}%`,
                  zIndex: 20 + box.depth,
                  transform: `rotate(${rotation}deg) scale(${scale})`,
                  transformOrigin: "center"
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelect(box.id);
                  onContextMenu(box.id, event.clientX, event.clientY);
                }}
                onPointerDown={(event) => beginDrag(box, event)}
              >
                {isPrimary && <span className="runtime-selection-label">{box.name || box.type}<small>{Math.round(rect.w)} × {Math.round(rect.h)}{rotation ? ` · ${Math.round(rotation)}°` : ""}{scale !== 1 ? ` · ${scale.toFixed(2)}×` : ""}</small></span>}
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

          {(editable || mode === "play") && <span className="runtime-mirror-badge">{frame ? "真实帧" : "Runtime 布局"} · {mode === "live-edit" ? "编辑视图实时同步 · Shift 多选" : mode === "play" ? inputSending ? "正在传入点击…" : "点击直接游玩" : "控件树已对齐"}</span>}
          </div>
        </section>

        {mode === "live-edit" && (
          <section className="runtime-editor-pane runtime-live-pane" aria-label="实际 Runtime 实时画面">
            <header><strong>实际 Runtime</strong><span><i />约 220ms 刷新</span></header>
            <div
              className={`runtime-live-stage runtime-live-interactive orientation-${orientation} ${inputSending ? "is-sending" : ""}`}
              style={{ aspectRatio: `${viewport.width}/${viewport.height}` }}
              role="application"
              tabIndex={0}
              aria-label="实际 Runtime，可直接点击游玩"
              title="点击会转发到真正的 Runtime 窗口"
              onPointerUp={(event) => void interactWithRuntime(event)}
            >
              {liveFrame || frame
                ? <img src={liveFrame || frame} alt={`实际 Runtime 实时画面：${sourceName}`} draggable={false} />
                : <div className="runtime-live-empty"><MonitorUp size={30} /><strong>实际窗口暂不可采样</strong><small>Runtime 活树仍可编辑；允许 macOS 屏幕录制后会自动恢复画面。</small></div>}
              {(liveFrame || frame) && <span>{inputSending ? "正在传入点击…" : inputError ? "点击转发需授权" : "可交互 · 点击游玩"}</span>}
            </div>
          </section>
        )}

        {frame && !editable && (
          <div className="runtime-editor-gate">
            {adapterInstalled ? <Unplug size={22} aria-hidden="true" /> : <WandSparkles size={22} aria-hidden="true" />}
            <div>
              <strong>{adapterInstalled ? "运行时编辑桥尚未连接" : "启用所见即所得编辑"}</strong>
              <p>{adapterInstalled
                ? "适配器已经写入项目，刷新一次 Runtime 后即可读取真实控件树并拖拽编辑。"
                : "安装项目内编辑桥后，画面上的选择框来自引擎实际布局，不再使用 HTML 模拟布局。"}</p>
            </div>
            <button type="button" disabled={installBusy || runtimeBusy} onClick={adapterInstalled ? onRefreshRuntime : onInstallAdapter}>
              {adapterInstalled ? <RefreshCw size={14} /> : <BoxSelect size={14} />}
              {installBusy ? "接入中…" : adapterInstalled ? "刷新并连接" : "接入当前项目"}
            </button>
          </div>
        )}
      </div>

      {selected && editable && (
        <footer className="runtime-editor-status">
          <span><BoxSelect size={13} />{selected.name || selected.type}{selectedIds.length > 1 ? ` +${selectedIds.length - 1}` : ""}</span>
          <span>{selected.type}</span>
          <span>x {Math.round(selectedRect.x)}</span>
          <span>y {Math.round(selectedRect.y)}</span>
          <span>w {Math.round(selectedRect.w)}</span>
          <span>h {Math.round(selectedRect.h)}</span>
        </footer>
      )}
    </div>
  );
}
