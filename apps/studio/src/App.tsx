import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import {
  Box,
  Boxes,
  ChevronDown,
  ChevronRight,
  CirclePlay,
  Code2,
  FileCode2,
  Files,
  Folder,
  FolderOpen,
  GitBranch,
  Image,
  Layers3,
  MonitorPlay,
  PanelBottom,
  Pause,
  Play,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  Redo2,
  Undo2,
  Wifi,
  WifiOff,
  Hammer,
  QrCode,
  ExternalLink,
  Copy,
  Activity,
  Eye,
  EyeOff,
  ArrowUp,
  ArrowDown,
  Plus,
  Trash2,
  MoreHorizontal,
  Columns2
} from "lucide-react";
import {
  DEFAULT_DEVICE_PROFILES,
  findUiNode,
  findParentInfo,
  type BridgeCapabilities,
  type BridgeEvent,
  type DeviceProfile,
  type LogChannel,
  type UiNode,
  type UiPatch,
  type UiSnapshot,
  type UiTreeOp,
  type UiValue,
  type PreviewPanelState,
  type WorkspaceMode
} from "@tapmakerwork/protocol";
import { PreviewDock } from "./PreviewDock";

const API = "http://127.0.0.1:43121";

interface Health {
  ok: boolean;
  capabilities: BridgeCapabilities & { runtimeBridge?: boolean; makerBuild?: boolean; makerQrcode?: boolean };
  makerVersion?: string;
  sandbox: { available: boolean; reason: string };
  runtimeSessionId?: string;
  runtimeConnectedAt?: string;
  runtimeScene?: "idle" | "loading" | "live";
  snapshotSource?: "conversion" | "sidecar" | "runtime" | "empty";
  runtimeAdapter?: { installed: boolean; paths: string[] };
  runtimeFileChannel?: { rootType?: string; wroteSnapshot?: boolean; snapshotError?: string } | null;
  makerProjectMeta?: MakerProjectMeta | null | undefined;
}

interface MakerProjectMeta {
  title?: string | undefined;
  appId?: string | undefined;
  orientation?: string | undefined;
  publishStatus?: number | undefined;
  qrcodeUrl?: string | undefined;
  qrcodeGeneratedAt?: string | undefined;
}

interface ProjectState {
  project?: { root: string; name: string; makerBound: boolean };
  snapshot?: UiSnapshot;
  activeUiEntry?: string;
}

type RecentProject = { root: string; name: string };

interface FileEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
}

interface UiScreenSummary {
  path: string;
  name: string;
  confidence?: "static" | "hybrid" | "runtime" | "module";
  nodeCount?: number;
  error?: string;
}

interface SearchHit {
  path: string;
  line: number;
  preview: string;
}

interface AssetEntry {
  name: string;
  path: string;
  bytes: number;
}

interface GitStatusState {
  branch: string;
  ahead?: number;
  behind?: number;
  dirty?: boolean;
  changes?: Array<{ path: string; status: string }>;
}

const channels: Array<{ id: LogChannel; label: string }> = [
  { id: "runtime", label: "Runtime" },
  { id: "build", label: "构建" },
  { id: "lua", label: "Lua 检查" },
  { id: "shell", label: "Shell" },
  { id: "repl", label: "Lua REPL" },
  { id: "qrcode", label: "二维码" },
  { id: "agent", label: "Agent" }
];

const initialLogs: Record<LogChannel, string[]> = {
  runtime: ["等待 Maker 预览或 Runtime 适配器连接…"],
  build: ["暂无构建任务。"],
  lua: ["暂无 Lua 诊断。"],
  shell: ["Shell 已锁定：OS 级项目沙箱尚未通过双平台逃逸测试。"],
  repl: ["Lua REPL 将在 Runtime Dev Bridge 接入后启用。"],
  qrcode: ["暂无二维码任务。"],
  agent: ["等待 Codex / Claude / Cursor 通过项目 MCP Bridge 连接。"]
};

function iconForType(type: string): ReactNode {
  if (type === "Button") return <Box size={14} />;
  if (type === "Label") return <Code2 size={14} />;
  return <Boxes size={14} />;
}

function labelForType(type: string): string {
  if (type === "Button") return "按钮";
  if (type === "Label") return "文字";
  if (type === "Panel") return "容器";
  return type;
}

function fileName(filePath: string): string {
  return filePath.split("/").at(-1) || filePath;
}

function rgba(value: UiValue | undefined, fallback = "transparent"): string {
  if (!Array.isArray(value) || value.length < 3) return typeof value === "string" ? value : fallback;
  const [r, g, b, a = 255] = value as number[];
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

function displayValue(value: UiValue | undefined, fallback = ""): string {
  if (value == null) return fallback;
  if (typeof value === "object" && !Array.isArray(value) && "$expression" in value) {
    return `{${String(value.$expression)}}`;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function concreteValue(value: UiValue | undefined): UiValue | undefined {
  if (value && typeof value === "object" && !Array.isArray(value) && "$expression" in value) return undefined;
  return value;
}

function dimension(value: UiValue | undefined): CSSProperties["width"] {
  if (typeof value === "number") return `${value}px`;
  if (typeof value === "string") return value;
  return undefined;
}

function edgeValue(value: UiValue | undefined): string | number | undefined {
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

function shadowValue(value: UiValue | undefined): string | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((shadow) => {
    if (!shadow || typeof shadow !== "object" || Array.isArray(shadow)) return "";
    const item = shadow as Record<string, UiValue>;
    return `${Number(item.x ?? 0)}px ${Number(item.y ?? 0)}px ${Number(item.blur ?? 0)}px ${rgba(item.color, "#000")}`;
  }).filter(Boolean).join(", ") || undefined;
}

function runtimeLayoutBox(props: Record<string, UiValue>): { w?: number | undefined; h?: number | undefined; x?: number | undefined; y?: number | undefined } {
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

function runtimeStyle(node: UiNode): CSSProperties {
  const props = node.props;
  const box = runtimeLayoutBox(props);
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
    cursor: "pointer"
  };
}

type ToastKind = "info" | "success" | "error" | "warn";
interface ToastItem { id: number; kind: ToastKind; message: string }

function ToastStack({ items }: { items: ToastItem[] }) {
  if (!items.length) return null;
  return (
    <div className="toast-stack" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={`toast-item toast-${item.kind}`}>{item.message}</div>
      ))}
    </div>
  );
}

function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="tip-wrap" data-tip={label}>
      {children}
    </span>
  );
}

function uiChildren(node: UiNode): UiNode[] {
  return Array.isArray(node.children) ? node.children : [];
}

function isEmbeddablePreviewUrl(url: string): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (/\.(png|jpe?g|gif|webp|svg|bmp)(\?|#|$)/i.test(url)) return false;
  if (/\/qrco|qrcode|qr-code|test_qrcode|\/qr\//i.test(url)) return false;
  return true;
}

function visualWeight(node: UiNode): number {
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

const DEFAULT_DEVICE_HINT = "maker-portrait";

const DEFAULT_LAYOUT = {
  left: 220,
  right: 280,
  previewDock: 300,
  terminal: 120
};

type WorkspaceLayout = { left: number; right: number; previewDock: number; terminal: number };
const LAYOUT_STORAGE_KEY = "tapmakerwork.workspaceLayout";

function loadWorkspaceLayout(): WorkspaceLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT };
    const parsed = JSON.parse(raw) as Partial<WorkspaceLayout>;
    return {
      left: clamp(parsed.left ?? DEFAULT_LAYOUT.left, 160, 420),
      right: clamp(parsed.right ?? DEFAULT_LAYOUT.right, 200, 480),
      previewDock: clamp(parsed.previewDock ?? DEFAULT_LAYOUT.previewDock, 220, 520),
      terminal: clamp(parsed.terminal ?? DEFAULT_LAYOUT.terminal, 72, 360)
    };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function PanelResizer({ orientation, onPointerDown, label }: {
  orientation: "col" | "row";
  onPointerDown: (event: React.PointerEvent) => void;
  label: string;
}) {
  return (
    <div
      className={`pane-resizer pane-resizer-${orientation}`}
      role="separator"
      aria-label={label}
      aria-orientation={orientation === "col" ? "vertical" : "horizontal"}
      onPointerDown={onPointerDown}
    />
  );
}

function imagePathFromProps(props: Record<string, UiValue>): string | undefined {
  const candidates = [props.path, props.sprite, props.image, props.texture, props.fileName, props.file];
  for (const value of candidates) {
    const concrete = concreteValue(value);
    if (typeof concrete === "string" && concrete.trim()) return concrete.trim();
  }
  return undefined;
}

function RuntimeNode({ node, selectedId, onSelect, onDragStart, onPlayClick, mode }: {
  node: UiNode;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onDragStart?: ((id: string, event: React.PointerEvent) => void) | undefined;
  onPlayClick?: ((node: UiNode) => void) | undefined;
  mode: WorkspaceMode;
}) {
  if (!node || typeof node !== "object") return null;
  if (node.props?.visible === false) return null;
  const isSlot = node.type === "Slot";
  const isEmptyFactory = Boolean(node.props?.$factory) && uiChildren(node).length === 0;
  const className = [
    "runtime-node",
    `runtime-${(node.type || "widget").toLowerCase()}`,
    selectedId === node.id ? "selected" : "",
    isSlot ? "runtime-slot" : "",
    isEmptyFactory ? "runtime-factory" : "",
    mode === "play" ? "local-runtime" : ""
  ].join(" ");
  const imageSource = node.type === "Image" ? imagePathFromProps(node.props) : undefined;
  return (
    <div
      className={className}
      style={runtimeStyle(node)}
      data-node-id={node.id}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect(node.id);
        if (mode === "live-edit" && onDragStart) onDragStart(node.id, event);
        if (mode === "play" && node.type === "Button" && onPlayClick) onPlayClick(node);
      }}
    >
      {isSlot && <span className="slot-label">{displayValue(node.props?.expression, "Slot").slice(0, 24)}</span>}
      {isEmptyFactory && <span className="factory-label">{String(node.props.$factory || node.name).slice(0, 28)}</span>}
      {node.type === "Label" && <span>{concreteValue(node.props?.text) == null ? (isSlot ? "" : node.name) : String(concreteValue(node.props?.text))}</span>}
      {node.type === "Button" && <span>{concreteValue(node.props?.text) == null ? "按钮" : String(concreteValue(node.props?.text))}</span>}
      {node.type === "Image" && (
        imageSource
          ? <img className="runtime-image" alt="" src={`${API}/api/project/asset?path=${encodeURIComponent(imageSource)}`} />
          : <span className="runtime-image-fallback">{node.name || "Image"}</span>
      )}
      {node.name && !isSlot && !isEmptyFactory && node.type === "Panel" && !concreteValue(node.props?.text) && (
        <span className="panel-name">{node.name}</span>
      )}
      {uiChildren(node).map((child) => (
        <RuntimeNode key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} onDragStart={onDragStart} onPlayClick={onPlayClick} mode={mode} />
      ))}
      {selectedId === node.id && mode !== "play" && <span className="node-badge">{labelForType(node.type)}{node.source?.line ? ` :${node.source.line}` : ""}</span>}
    </div>
  );
}

function HierarchyNode({ node, selectedId, onSelect, depth = 0, renamingId, renameDraft, onRenameDraft, onCommitRename, onCancelRename, dragId, dropHint, onDragStartId, onDragOverId, onDropId }: {
  node: UiNode;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  depth?: number;
  renamingId: string | null;
  renameDraft: string;
  onRenameDraft: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  dragId: string | null;
  dropHint: { id: string; pos: "before" | "after" | "inside" } | null;
  onDragStartId: (id: string) => void;
  onDragOverId: (id: string, event: React.DragEvent) => void;
  onDropId: (id: string, event: React.DragEvent) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const kids = uiChildren(node);
  const dropClass = dropHint?.id === node.id ? `drop-${dropHint.pos}` : "";
  return (
    <>
      <div
        className={`tree-row ${selectedId === node.id ? "active" : ""} ${dropClass} ${dragId === node.id ? "dragging" : ""} ${node.props.visible === false ? "is-hidden" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable={renamingId !== node.id}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", node.id);
          onDragStartId(node.id);
        }}
        onDragOver={(event) => onDragOverId(node.id, event)}
        onDrop={(event) => onDropId(node.id, event)}
      >
        <button className="tree-expand" aria-label={expanded ? "折叠" : "展开"} onClick={() => setExpanded(!expanded)} disabled={!kids.length}>
          {kids.length ? expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <span className="tree-spacer" />}
        </button>
        {renamingId === node.id ? (
          <input
            className="tree-rename"
            value={renameDraft}
            autoFocus
            onChange={(event) => onRenameDraft(event.target.value)}
            onBlur={() => onCommitRename()}
            onKeyDown={(event) => {
              if (event.key === "Enter") onCommitRename();
              if (event.key === "Escape") onCancelRename();
            }}
          />
        ) : (
          <button
            className="tree-label"
            onClick={() => onSelect(node.id)}
            onDoubleClick={() => {
              onSelect(node.id);
              // parent will wire rename via selected; trigger custom event
              window.dispatchEvent(new CustomEvent("tapmakerwork:rename-node", { detail: { id: node.id, name: node.name } }));
            }}
            title="双击可重命名"
          >
            {iconForType(node.type)}
            <span>{node.name}</span>
            <small>{node.type}</small>
          </button>
        )}
      </div>
      {expanded && kids.map((child) => (
        <HierarchyNode
          key={child.id}
          node={child}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={depth + 1}
          renamingId={renamingId}
          renameDraft={renameDraft}
          onRenameDraft={onRenameDraft}
          onCommitRename={onCommitRename}
          onCancelRename={onCancelRename}
          dragId={dragId}
          dropHint={dropHint}
          onDragStartId={onDragStartId}
          onDragOverId={onDragOverId}
          onDropId={onDropId}
        />
      ))}
    </>
  );
}

function FileTreeEntry({ entry, depth, selectedPath, onOpen }: {
  entry: FileEntry;
  depth: number;
  selectedPath: string | undefined;
  onOpen: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>();
  const [loading, setLoading] = useState(false);
  const toggle = async () => {
    if (entry.kind === "file") { onOpen(entry.path); return; }
    const next = !expanded;
    setExpanded(next);
    if (!next || children) return;
    setLoading(true);
    try {
      const response = await fetch(`${API}/api/project/files?path=${encodeURIComponent(entry.path)}`);
      const result = await response.json() as { entries?: FileEntry[] };
      setChildren(result.entries ?? []);
    } finally {
      setLoading(false);
    }
  };
  return <>
    <button
      className={`file-row ${selectedPath === entry.path ? "active" : ""}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => void toggle()}
      aria-expanded={entry.kind === "directory" ? expanded : undefined}
    >
      {entry.kind === "directory" ? expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <span className="file-indent" />}
      {entry.kind === "directory" ? <Folder size={14} /> : <FileCode2 size={14} />}
      <span>{entry.name}</span>{loading && <small>读取中…</small>}
    </button>
    {expanded && children?.map((child) => <FileTreeEntry key={child.path} entry={child} depth={depth + 1} selectedPath={selectedPath} onOpen={onOpen} />)}
  </>;
}

function InspectorField({ label, property, value, onCommit }: {
  label: string;
  property: string;
  value: UiValue | undefined;
  onCommit: (property: string, value: UiValue) => void;
}) {
  const display = Array.isArray(value) ? value.join(", ") : value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  const [draft, setDraft] = useState(display);
  useEffect(() => setDraft(display), [display]);
  const commit = () => {
    if (draft === display) return;
    let next: UiValue = draft;
    if (/^-?\d+(\.\d+)?$/.test(draft)) next = Number(draft);
    else if (draft.includes(",") && draft.split(",").every((part) => /^\s*\d+\s*$/.test(part))) next = draft.split(",").map(Number);
    onCommit(property, next);
  };
  return (
    <label className="property-row">
      <span>{label}</span>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => event.key === "Enter" && commit()} />
    </label>
  );
}

export function App() {
  const [connected, setConnected] = useState(false);
  const [health, setHealth] = useState<Health>();
  const [project, setProject] = useState<ProjectState["project"]>();
  const [projectLoaded, setProjectLoaded] = useState(false);
  const [projectOpening, setProjectOpening] = useState(false);
  const [projectError, setProjectError] = useState("");
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("tapmakerwork.recentProjects") || "[]") as unknown;
      return Array.isArray(stored) ? stored.filter((item): item is RecentProject => Boolean(item && typeof item.root === "string" && typeof item.name === "string")) : [];
    }
    catch { return []; }
  });
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [screens, setScreens] = useState<UiScreenSummary[]>([]);
  const [activeUiPath, setActiveUiPath] = useState("scripts/ui/HomePage.lua");
  const [selectedFile, setSelectedFile] = useState("scripts/ui/HomePage.lua");
  const [snapshot, setSnapshot] = useState<UiSnapshot>();
  const [snapshotSource, setSnapshotSource] = useState<"conversion" | "sidecar" | "runtime" | "empty" | undefined>();
  const [mode, setMode] = useState<WorkspaceMode>("inspect");
  const [device, setDevice] = useState<DeviceProfile>(DEFAULT_DEVICE_PROFILES[0]!);
  const [fps, setFps] = useState(60);
  const [activeTerminal, setActiveTerminal] = useState<LogChannel>("runtime");
  const [logs, setLogs] = useState(initialLogs);
  const [leftTab, setLeftTab] = useState<"files" | "screens" | "hierarchy" | "assets">("screens");
  const [centerTab, setCenterTab] = useState<"visual" | "code">("visual");
  const [previewDockOpen, setPreviewDockOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [previewPanel, setPreviewPanel] = useState<PreviewPanelState>();
  const [inspectorTab, setInspectorTab] = useState<"properties" | "events" | "animation">("properties");
  const [code, setCode] = useState("-- 正在读取 scripts/ui/HomePage.lua…");
  const [codeDirty, setCodeDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [assets, setAssets] = useState<AssetEntry[]>([]);
  const [gitStatus, setGitStatus] = useState<GitStatusState>();
  const [systemInfo, setSystemInfo] = useState<Record<string, unknown>>();
  const [adapterExport, setAdapterExport] = useState<string>("");
  const [revealLine, setRevealLine] = useState<number | null>(null);
  const [sidecarInfo, setSidecarInfo] = useState<{ path: string; exists: boolean; savedAt?: string | undefined; dirty?: boolean | undefined }>({ path: "", exists: false });
  const [makerMeta, setMakerMeta] = useState<MakerProjectMeta>({});
  const [makerBusy, setMakerBusy] = useState<"" | "build" | "qrcode" | "doctor">("");
  const [qrOpen, setQrOpen] = useState(false);
  const [qrMenuOpen, setQrMenuOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [newNodeType, setNewNodeType] = useState<"Panel" | "Label" | "Button" | "Image">("Panel");
  const [hierDragId, setHierDragId] = useState<string | null>(null);
  const [hierDrop, setHierDrop] = useState<{ id: string; pos: "before" | "after" | "inside" } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const toast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, kind, message }]);
    window.setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), 2800);
  }, []);
  const qrCloseTimer = useRef<number | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageScale, setStageScale] = useState(1);
  const [layout, setLayout] = useState<WorkspaceLayout>(() => loadWorkspaceLayout());
  const layoutDragRef = useRef<{ key: keyof WorkspaceLayout; base: number; originX: number; originY: number } | null>(null);
  const previewWidth = typeof snapshot?.root.props.$previewDesignWidth === "number" ? snapshot.root.props.$previewDesignWidth : device.width;
  const previewHeight = device.height / device.width * previewWidth;

  const persistLayout = useCallback((next: WorkspaceLayout) => {
    setLayout(next);
    try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  const resetLayout = useCallback(() => {
    persistLayout({ ...DEFAULT_LAYOUT });
    toast("已还原默认 IDE 布局", "success");
  }, [persistLayout, toast]);

  const beginLayoutDrag = useCallback((key: keyof WorkspaceLayout, invertX = false, invertY = false) => (event: React.PointerEvent) => {
    event.preventDefault();
    layoutDragRef.current = {
      key,
      base: layout[key],
      originX: event.clientX,
      originY: event.clientY
    };
    const onMove = (moveEvent: PointerEvent) => {
      const drag = layoutDragRef.current;
      if (!drag) return;
      const dx = moveEvent.clientX - drag.originX;
      const dy = moveEvent.clientY - drag.originY;
      const delta = key === "terminal" ? dy : dx;
      const signed = (invertX || invertY) ? -delta : delta;
      setLayout((current) => {
        const raw = drag.base + signed;
        const next = { ...current, [key]: clamp(raw, key === "terminal" ? 72 : key === "previewDock" ? 220 : key === "right" ? 200 : 160, key === "terminal" ? 360 : key === "previewDock" ? 520 : key === "right" ? 480 : 420) };
        try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    };
    const onUp = () => {
      layoutDragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [layout]);

  useEffect(() => {
    if (!toolsMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".tools-menu-wrap")) return;
      setToolsMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [toolsMenuOpen]);

  useEffect(() => {
    if (mode !== "live-edit") return;
    setCenterTab("visual");
    // 仅当存在可嵌入的游戏预览 URL 时才自动打开右侧预览，避免二维码卡片抢版面
    if (previewPanel?.url && isEmbeddablePreviewUrl(previewPanel.url)) setPreviewDockOpen(true);
  }, [mode, previewPanel?.url]);

  const readFile = useCallback(async (filePath: string, reveal = true) => {
    const response = await fetch(`${API}/api/project/file?path=${encodeURIComponent(filePath)}`);
    const result = await response.json() as { text?: string; error?: string };
    if (!response.ok || result.text == null) throw new Error(result.error || "无法读取文件");
    setSelectedFile(filePath);
    setCode(result.text);
    setCodeDirty(false);
    setSaveState("idle");
    if (reveal) setCenterTab("code");
  }, []);

  const loadProjectContents = useCallback(async () => {
    const [fileResponse, screenResponse] = await Promise.all([
      fetch(`${API}/api/project/files`),
      fetch(`${API}/api/ui/screens`)
    ]);
    const fileResult = await fileResponse.json() as { entries?: FileEntry[] };
    const screenResult = await screenResponse.json() as { screens?: UiScreenSummary[]; activePath?: string };
    const allScreens = screenResult.screens ?? [];
    const isModulePath = (path: string, summary?: UiScreenSummary) =>
      summary?.confidence === "module" || summary?.error === "module_only" || /AdPrompt|EmergencyReset|CultivationDrawer/i.test(path);
    const preferred = allScreens.find((screen) => /MainShell/i.test(screen.path) && !isModulePath(screen.path, screen))
      || allScreens.find((screen) => screen.confidence === "static" && (screen.nodeCount || 0) >= 8 && !isModulePath(screen.path, screen))
      || allScreens.find((screen) => !isModulePath(screen.path, screen) && !screen.error);
    const activeCandidate = screenResult.activePath && !isModulePath(screenResult.activePath, allScreens.find((s) => s.path === screenResult.activePath))
      ? screenResult.activePath
      : undefined;
    const targetPath = activeCandidate || preferred?.path || "scripts/ui/HomePage.lua";
    setFiles(fileResult.entries ?? []);
    setScreens(allScreens);
    setActiveUiPath(targetPath);
    await readFile(targetPath, false).catch(() => undefined);
    try {
      const openRes = await fetch(`${API}/api/ui/open`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: targetPath })
      });
      const openResult = await openRes.json() as {
        snapshot?: UiSnapshot;
        sidecar?: { path?: string; exists?: boolean; savedAt?: string };
        error?: string;
      };
      if (openRes.ok && openResult.snapshot) {
        setSnapshot(openResult.snapshot);
        const opened = openResult as { snapshotSource?: "conversion" | "sidecar" | "runtime" | "empty"; note?: string };
        setSnapshotSource(opened.snapshotSource);
        setSidecarInfo({
          path: openResult.sidecar?.path || targetPath.replace(/\.lua$/i, ".ui.json"),
          exists: Boolean(openResult.sidecar?.exists),
          ...(openResult.sidecar?.savedAt ? { savedAt: openResult.sidecar.savedAt } : {}),
          dirty: false
        });
        setCenterTab("visual");
        if (/MainShell/i.test(targetPath)) {
          const maker = DEFAULT_DEVICE_PROFILES.find((profile) => profile.id === DEFAULT_DEVICE_HINT);
          if (maker) setDevice(maker);
        }
      }
    } catch {
      // keep file tree even if UI open fails
    }
  }, [readFile]);

  const saveFile = useCallback(async () => {
    if (!selectedFile || !codeDirty) return;
    setSaveState("saving");
    try {
      const response = await fetch(`${API}/api/project/file`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: selectedFile, text: code })
      });
      const result = await response.json() as { error?: string; snapshot?: UiSnapshot };
      if (!response.ok) throw new Error(result.error || "保存失败");
      if (result.snapshot) setSnapshot(result.snapshot);
      setCodeDirty(false);
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1_500);
      const screenResponse = await fetch(`${API}/api/ui/screens`);
      const screenResult = await screenResponse.json() as { screens?: UiScreenSummary[] };
      setScreens(screenResult.screens ?? []);
    } catch (error) {
      setSaveState("error");
      setLogs((current) => ({ ...current, agent: [...current.agent, `保存失败：${error instanceof Error ? error.message : String(error)}`] }));
    }
  }, [code, codeDirty, selectedFile]);

  const jumpToSource = useCallback(async (node: UiNode) => {
    const file = node.source?.file;
    const line = node.source?.line;
    if (!file) {
      setLogs((current) => ({ ...current, agent: [...current.agent, `节点 ${node.name} 没有源码位置（运行时合成节点）`] }));
      return;
    }
    if (line) setRevealLine(line);
    try {
      await readFile(file, true);
      setLogs((current) => ({
        ...current,
        agent: [...current.agent, `定位源码 ${file}${line ? `:${line}` : ""} ← ${node.name} (${node.type})`]
      }));
    } catch (error) {
      setLogs((current) => ({ ...current, agent: [...current.agent, `打开源码失败：${error instanceof Error ? error.message : String(error)}`] }));
    }
  }, [readFile]);

  const openUiScreen = useCallback(async (screenPath: string, options?: { silentModule?: boolean }) => {
    const summary = screens.find((item) => item.path === screenPath);
    const isModule = summary?.confidence === "module" || summary?.error === "module_only" || /AdPrompt|EmergencyReset|CultivationDrawer/i.test(screenPath);
    if (isModule && !options?.silentModule) {
      toast(`${fileName(screenPath)} 是逻辑模块，没有可编辑控件树`, "warn");
      const fallback = screens.find((item) => /MainShell/i.test(item.path) && !item.error)
        || screens.find((item) => item.confidence === "static" && (item.nodeCount || 0) >= 8 && !item.error);
      if (fallback && fallback.path !== screenPath) {
        await openUiScreen(fallback.path, { silentModule: true });
        return;
      }
    }
    const response = await fetch(`${API}/api/ui/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: screenPath })
    });
    const result = await response.json() as {
      snapshot?: UiSnapshot;
      error?: string;
      sidecar?: { path?: string; exists?: boolean; savedAt?: string };
    };
    if (!response.ok || !result.snapshot) {
      setLogs((current) => ({ ...current, agent: [...current.agent, `界面无法预览：${result.error ?? "转换失败"}`] }));
      await readFile(screenPath);
      return;
    }
    setSnapshot(result.snapshot);
    const opened = result as { snapshotSource?: "conversion" | "sidecar" | "runtime" | "empty"; note?: string };
    setSnapshotSource(opened.snapshotSource);
    if (opened.note === "runtime_is_loading_screen") {
      toast("真机正在加载画面；画布显示的是该界面结构（与运行画面不同属正常）", "info");
    } else if (opened.note === "canvas_from_runtime") {
      toast("画布已同步真机活树，与运行界面结构一致", "success");
    }
    setActiveUiPath(screenPath);
    setSidecarInfo({
      path: result.sidecar?.path || screenPath.replace(/\.lua$/i, ".ui.json"),
      exists: Boolean(result.sidecar?.exists),
      ...(result.sidecar?.savedAt ? { savedAt: result.sidecar.savedAt } : {}),
      dirty: false
    });
    if (/MainShell|HomePage|LoadingScreen/i.test(screenPath)) {
      const maker = DEFAULT_DEVICE_PROFILES.find((profile) => profile.id === DEFAULT_DEVICE_HINT);
      if (maker) setDevice(maker);
    }
    await readFile(screenPath, false);
    setCenterTab("visual");
  }, [readFile, screens, toast]);

  const selectNodeAndLocate = useCallback((nodeId: string) => {
    setSnapshot((current) => {
      if (!current) return current;
      return { ...current, selectedId: nodeId };
    });
    const node = snapshot ? findUiNode(snapshot.root, nodeId) : undefined;
    if (node) void jumpToSource(node);
  }, [snapshot, jumpToSource]);

  const patchNode = async (property: string, value: UiValue) => {
    await patchNodeProps({ [property]: value });
  };

  const patchNodeProps = async (props: Record<string, UiValue>) => {
    if (!snapshot || !snapshot.selectedId) return;
    const patch: UiPatch = {
      requestId: crypto.randomUUID(),
      baseRevision: snapshot.revision,
      nodeId: snapshot.selectedId,
      props
    };
    const response = await fetch(`${API}/api/ui/patch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch)
    });
    const result = await response.json() as UiSnapshot | { error: string };
    if (response.ok) {
      const next = result as UiSnapshot;
      setSnapshot(next);
      if (mode === "live-edit") {
        setSidecarInfo((current) => ({ ...current, dirty: true }));
      }
    } else {
      setLogs((current) => ({ ...current, agent: [...current.agent, `补丁失败：${(result as { error: string }).error}`] }));
    }
  };

  const openProjectPath = useCallback(async (projectPath: string) => {
    setProjectOpening(true);
    setProjectError("");
    try {
      const response = await fetch(`${API}/api/project/open`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: projectPath })
      });
      const result = await response.json() as ProjectState & { error?: string };
      if (!response.ok || !result.project) throw new Error(result.error || "无法打开项目");
      setProject(result.project);
      if (result.snapshot) setSnapshot(result.snapshot);
      await loadProjectContents();
      // 这些回调在函数体调用时已初始化；依赖数组不可提前引用（TDZ）
      void loadAssets();
      void loadGitStatus();
      void loadMakerMeta();
      void loadPreviewPanel();
      setRecentProjects((current) => {
        const next = [{ root: result.project!.root, name: result.project!.name }, ...current.filter((item) => item.root !== result.project!.root)].slice(0, 8);
        localStorage.setItem("tapmakerwork.recentProjects", JSON.stringify(next));
        return next;
      });
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectLoaded(true);
      setProjectOpening(false);
    }
  }, [loadProjectContents]);

  const chooseProject = useCallback(async () => {
    if (window.tapMakerWork?.chooseProject) {
      const projectPath = await window.tapMakerWork.chooseProject();
      if (projectPath) await openProjectPath(projectPath);
      return;
    }
    setProjectError("请使用桌面版的“文件 → 打开项目…”选择项目目录。");
  }, [openProjectPath]);

  const refreshRuntimeLogs = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/maker/preview/logs`);
      const result = await response.json() as { lines?: string[]; error?: string };
      const lines = result.lines?.length ? result.lines : result.error ? [`日志：${result.error}`] : ["暂无 Runtime 日志。"];
      setLogs((current) => ({ ...current, runtime: lines.slice(-200) }));
    } catch (error) {
      setLogs((current) => ({ ...current, runtime: [...current.runtime, `读取日志失败：${error instanceof Error ? error.message : String(error)}`] }));
    }
  }, []);

  const runSearch = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) return;
    setSearchBusy(true);
    try {
      const response = await fetch(`${API}/api/project/search?q=${encodeURIComponent(query)}`);
      const result = await response.json() as { hits?: SearchHit[] };
      setSearchHits(result.hits ?? []);
    } catch {
      setSearchHits([]);
    } finally {
      setSearchBusy(false);
    }
  }, [searchQuery]);

  const loadAssets = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/project/assets`);
      const result = await response.json() as { assets?: AssetEntry[] };
      setAssets(result.assets ?? []);
    } catch {
      setAssets([]);
    }
  }, []);

  const loadGitStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/git/status`);
      if (!response.ok) return;
      setGitStatus(await response.json() as GitStatusState);
    } catch {
      setGitStatus(undefined);
    }
  }, []);

  const loadSystemInfo = useCallback(async () => {
    try {
      const [healthRes, infoRes, adapterRes] = await Promise.all([
        fetch(`${API}/api/health`),
        fetch(`${API}/api/system/info`),
        fetch(`${API}/api/runtime/adapter`)
      ]);
      if (healthRes.ok) setHealth(await healthRes.json() as Health);
      if (infoRes.ok) setSystemInfo(await infoRes.json() as Record<string, unknown>);
      if (adapterRes.ok) {
        const adapter = await adapterRes.json() as { installed: boolean; paths: string[] };
        setAdapterExport(adapter.installed ? `项目内已安装：${adapter.paths.join(", ")}` : "项目内未安装 Runtime 适配器");
      }
    } catch {
      // ignore settings load errors
    }
  }, []);

  const exportRuntimeAdapter = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/runtime/adapter/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectName: project?.name })
      });
      const result = await response.json() as { outputDir?: string; files?: string[]; error?: string; nextSteps?: string[] };
      if (!response.ok) {
        setAdapterExport(result.error || "导出失败");
        return;
      }
      setAdapterExport(`已导出到 ${result.outputDir}\n${(result.files || []).join("\n")}\n\n${(result.nextSteps || []).join("\n")}`);
      setLogs((current) => ({ ...current, agent: [...current.agent, `Runtime 适配器包已导出：${result.outputDir}`] }));
    } catch (error) {
      setAdapterExport(error instanceof Error ? error.message : String(error));
    }
  }, [project?.name]);

  const loadPreviewPanel = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/preview/panel`);
      const result = await response.json() as { panel?: PreviewPanelState; error?: string };
      if (result.panel) setPreviewPanel(result.panel);
    } catch {
      // bridge may be offline
    }
  }, []);

  const loadMakerMeta = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/maker/project-meta`);
      if (!response.ok) return;
      const result = await response.json() as { meta?: MakerProjectMeta };
      if (result.meta) {
        setMakerMeta(result.meta);
        setHealth((current) => (current ? { ...current, makerProjectMeta: result.meta ?? null } : current));
        const orientation = result.meta.orientation;
        const preferred = orientation === "landscape"
          ? DEFAULT_DEVICE_PROFILES.find((item) => item.id === "phone-landscape") ?? DEFAULT_DEVICE_PROFILES[0]!
          : DEFAULT_DEVICE_PROFILES.find((item) => item.id === "maker-portrait") ?? DEFAULT_DEVICE_PROFILES[0]!;
        setDevice(preferred);
      }
    } catch {
      // ignore
    }
  }, []);

  const openQrPopover = useCallback(() => {
    if (qrCloseTimer.current) {
      window.clearTimeout(qrCloseTimer.current);
      qrCloseTimer.current = null;
    }
    setQrMenuOpen(true);
    void loadMakerMeta();
  }, [loadMakerMeta]);

  const scheduleQrClose = useCallback(() => {
    if (qrCloseTimer.current) window.clearTimeout(qrCloseTimer.current);
    qrCloseTimer.current = window.setTimeout(() => {
      setQrMenuOpen(false);
      qrCloseTimer.current = null;
    }, 220);
  }, []);

  useEffect(() => () => {
    if (qrCloseTimer.current) window.clearTimeout(qrCloseTimer.current);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; name?: string }>).detail;
      if (!detail?.id) return;
      setRenamingId(detail.id);
      setRenameDraft(detail.name || "");
    };
    window.addEventListener("tapmakerwork:rename-node", handler);
    return () => window.removeEventListener("tapmakerwork:rename-node", handler);
  }, []);

  const runMakerBuild = useCallback(async () => {
    setMakerBusy("build");
    setActiveTerminal("build");
    setLogs((current) => ({ ...current, build: [...current.build, "请求官方 Maker 构建…"] }));
    try {
      const response = await fetch(`${API}/api/maker/build`, { method: "POST" });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        setLogs((current) => ({ ...current, build: [...current.build, `构建失败：${result.error ?? response.statusText}`] }));
      } else {
        setLogs((current) => ({ ...current, build: [...current.build, "构建请求已完成，详情见构建终端。"] }));
        void refreshRuntimeLogs();
      }
    } catch (error) {
      setLogs((current) => ({ ...current, build: [...current.build, `构建异常：${error instanceof Error ? error.message : String(error)}`] }));
    } finally {
      setMakerBusy("");
    }
  }, [refreshRuntimeLogs]);

  const runMakerQrcode = useCallback(async () => {
    setMakerBusy("qrcode");
    setActiveTerminal("qrcode");
    setLogs((current) => ({ ...current, qrcode: [...current.qrcode, "请求生成测试二维码…"] }));
    try {
      const response = await fetch(`${API}/api/maker/qrcode`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmedScreenOrientation: makerMeta.orientation === "portrait" || makerMeta.orientation === "landscape"
            ? makerMeta.orientation
            : undefined
        })
      });
      const result = await response.json() as { error?: string; meta?: MakerProjectMeta };
      if (result.meta) setMakerMeta(result.meta);
      if (!response.ok) {
        setLogs((current) => ({ ...current, qrcode: [...current.qrcode, `二维码失败：${result.error ?? response.statusText}`] }));
        if (result.meta?.qrcodeUrl) setQrOpen(true);
      } else {
        setLogs((current) => ({ ...current, qrcode: [...current.qrcode, "二维码已生成/刷新。"] }));
        setQrOpen(true);
        void loadMakerMeta();
      }
    } catch (error) {
      setLogs((current) => ({ ...current, qrcode: [...current.qrcode, `二维码异常：${error instanceof Error ? error.message : String(error)}`] }));
    } finally {
      setMakerBusy("");
    }
  }, [makerMeta.orientation, loadMakerMeta]);

  const runMakerDoctor = useCallback(async () => {
    setMakerBusy("doctor");
    setActiveTerminal("build");
    try {
      const response = await fetch(`${API}/api/maker/doctor`);
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        setLogs((current) => ({ ...current, build: [...current.build, `doctor 失败：${result.error ?? response.statusText}`] }));
      }
    } finally {
      setMakerBusy("");
    }
  }, []);

  const openExternalUrl = useCallback((url: string) => {
    if (!url) {
      toast("没有可打开的链接", "warn");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    toast("已在浏览器打开链接", "success");
  }, [toast]);

  const copyText = useCallback(async (text: string) => {
    if (!text) {
      toast("没有可复制的内容", "warn");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast("已复制到剪贴板", "success");
      setLogs((current) => ({ ...current, qrcode: [...current.qrcode, `已复制：${text}`] }));
    } catch {
      toast("复制失败，请手动选择", "error");
      setLogs((current) => ({ ...current, qrcode: [...current.qrcode, `复制失败：${text}`] }));
    }
  }, [toast]);

  const runTreeOp = useCallback(async (op: UiTreeOp, label: string) => {
    if (!snapshot) {
      toast("请先打开界面节点", "warn");
      return;
    }
    try {
      const response = await fetch(`${API}/api/ui/tree-op`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op })
      });
      const result = await response.json() as UiSnapshot | { error: string };
      if (!response.ok) {
        toast(`${label}失败：${(result as { error: string }).error}`, "error");
        return;
      }
      setSnapshot(result as UiSnapshot);
      if (mode === "live-edit") setSidecarInfo((current) => ({ ...current, dirty: true }));
      toast(`${label}成功`, "success");
      setLeftTab("hierarchy");
    } catch (error) {
      toast(`${label}失败：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }, [snapshot, mode, toast]);

  const beginRenameSelected = useCallback(() => {
    const node = snapshot?.selectedId ? findUiNode(snapshot.root, snapshot.selectedId) : undefined;
    if (!node) {
      toast("请先选择节点", "warn");
      return;
    }
    setRenamingId(node.id);
    setRenameDraft(node.name);
  }, [snapshot, toast]);

  const commitRename = useCallback(() => {
    if (!renamingId) return;
    const name = renameDraft.trim();
    setRenamingId(null);
    if (!name) {
      toast("名称不能为空", "warn");
      return;
    }
    void runTreeOp({ type: "rename", nodeId: renamingId, name }, `重命名为 ${name}`);
  }, [renamingId, renameDraft, runTreeOp, toast]);

  const duplicateSelected = useCallback(() => {
    const node = snapshot?.selectedId ? findUiNode(snapshot.root, snapshot.selectedId) : undefined;
    if (!node) {
      toast("请先选择节点", "warn");
      return;
    }
    void runTreeOp({ type: "duplicate", nodeId: node.id }, `复制 ${node.name}`);
  }, [snapshot, runTreeOp, toast]);

  const onHierDragOverId = useCallback((id: string, event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const offset = event.clientY - rect.top;
    const ratio = offset / Math.max(rect.height, 1);
    const pos = ratio < 0.28 ? "before" : ratio > 0.72 ? "after" : "inside";
    setHierDrop({ id, pos });
  }, []);

  const onHierDropId = useCallback((targetId: string, event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const dragId = hierDragId || event.dataTransfer.getData("text/plain");
    const hint = hierDrop && hierDrop.id === targetId ? hierDrop.pos : "inside";
    setHierDragId(null);
    setHierDrop(null);
    if (!dragId || dragId === targetId) {
      toast("未选择有效拖拽节点", "warn");
      return;
    }
    if (!snapshot) {
      toast("当前无界面树", "warn");
      return;
    }
    const dragInfo = findParentInfo(snapshot.root, dragId);
    const dropInfo = findParentInfo(snapshot.root, targetId);
    if (!dropInfo && hint !== "inside") {
      toast("找不到目标节点父级", "error");
      return;
    }
    if (hint === "inside") {
      if (findUiNode(snapshot.root, dragId) && findUiNode(findUiNode(snapshot.root, targetId) || snapshot.root, dragId)) {
        toast("不能移动到自己的子节点下", "error");
        return;
      }
      void runTreeOp({ type: "relocate", nodeId: dragId, parentId: targetId, index: 999 }, `移动到 ${targetId} 下`);
      return;
    }
    if (!dropInfo || !dragInfo) {
      toast("拖拽位置无效", "error");
      return;
    }
    let index = hint === "before" ? dropInfo.index : dropInfo.index + 1;
    const parentId = dropInfo.parentId;
    if (dragInfo.parentId === parentId && dragInfo.index < index) index -= 1;
    void runTreeOp({ type: "relocate", nodeId: dragId, parentId, index }, hint === "before" ? "拖到上方" : "拖到下方");
  }, [hierDragId, hierDrop, snapshot, runTreeOp, toast]);

  const screenLabel = (screen: UiScreenSummary): string => {
    if (screen.confidence === "module" || screen.error === "module_only") return "逻辑模块 · 非界面";
    if (screen.error) return "仅代码 · 无法静态预览";
    return `${screen.nodeCount ?? 0} 个节点 · ${screen.confidence === "static" ? "完整" : "混合"}`;
  };

  const saveUiSidecar = useCallback(async (snapshotOverride?: UiSnapshot) => {
    const snap = snapshotOverride ?? snapshot;
    if (!snap || !activeUiPath) return;
    try {
      const response = await fetch(`${API}/api/ui/sidecar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: activeUiPath, snapshot: snap })
      });
      const result = await response.json() as {
        path?: string;
        savedAt?: string;
        error?: string;
        preview?: { reloadToken?: number; autoRefreshIframe?: boolean; autoRefreshMaker?: boolean; makerRefresh?: { error?: string } };
      };
      if (!response.ok) throw new Error(result.error || "写入 .ui.json 失败");
      setSidecarInfo({
        path: result.path || "",
        exists: true,
        ...(result.savedAt ? { savedAt: result.savedAt } : {}),
        dirty: false
      });
      if (typeof result.preview?.reloadToken === "number") {
        setPreviewPanel((current) => current ? { ...current, reloadToken: result.preview!.reloadToken! } : current);
      }
      if (result.preview?.makerRefresh?.error) {
        setLogs((current) => ({ ...current, runtime: [...current.runtime, `live-edit Maker refresh：${result.preview!.makerRefresh!.error}`] }));
      }
      setLogs((current) => ({ ...current, agent: [...current.agent, `视觉已同步 → ${result.path}${result.preview?.autoRefreshIframe ? " · 预览自动刷新" : ""}`] }));
    } catch (error) {
      setLogs((current) => ({ ...current, agent: [...current.agent, `同步 .ui.json 失败：${error instanceof Error ? error.message : String(error)}`] }));
    }
  }, [activeUiPath, snapshot]);

  useEffect(() => {
    if (mode !== "live-edit" || !sidecarInfo.dirty) return;
    const timer = window.setTimeout(() => { void saveUiSidecar(); }, 700);
    return () => window.clearTimeout(timer);
  }, [mode, sidecarInfo.dirty, snapshot, saveUiSidecar]);

  useEffect(() => {
    if (centerTab !== "code" || !revealLine || !editorRef.current) return;
    const editor = editorRef.current;
    editor.revealLineInCenter(revealLine);
    editor.setPosition({ lineNumber: revealLine, column: 1 });
    editor.focus();
  }, [centerTab, revealLine, selectedFile, code]);

  const onEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
    if (revealLine) {
      editor.revealLineInCenter(revealLine);
      editor.setPosition({ lineNumber: revealLine, column: 1 });
    }
  };

  useEffect(() => {
    void fetch(`${API}/api/health`).then((response) => response.json()).then(setHealth).catch(() => undefined);
    void fetch(`${API}/api/project`).then((response) => response.json()).then(async (value: ProjectState) => {
      setProject(value.project);
      if (value.project) {
        await loadProjectContents();
        void loadAssets();
        void loadGitStatus();
        void refreshRuntimeLogs();
        void loadMakerMeta();
        void loadPreviewPanel();
      }
      setProjectLoaded(true);
    }).catch(() => {
      setProjectLoaded(true);
      setProjectError("本地 Bridge 未启动，请先启动 TapMakerWork 服务。");
    });
    void fetch(`${API}/api/ui/snapshot`).then((response) => response.json()).then(setSnapshot).catch(() => undefined);
    let disposed = false;
    let reconnectTimer: number | undefined;
    const connect = () => {
      const socket = new WebSocket("ws://127.0.0.1:43121/ws");
      socketRef.current = socket;
      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        if (!disposed) reconnectTimer = window.setTimeout(connect, 1_000);
      };
      socket.onmessage = (message) => {
        const event = JSON.parse(String(message.data)) as BridgeEvent;
        if (event.type === "ui.snapshot" || event.type === "ui.patch.applied" || event.type === "ui.patch.rejected") {
          setSnapshot(event.snapshot);
          if (event.type === "ui.snapshot" || event.type === "ui.patch.applied") {
            if (event.source) setSnapshotSource(event.source);
          }
        }
        if (event.type === "preview.panel") setPreviewPanel(event.panel);
        if (event.type === "log.append") setLogs((current) => ({ ...current, [event.channel]: [...current[event.channel], ...event.lines] }));
      };
    };
    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, [loadProjectContents, loadAssets, loadGitStatus, refreshRuntimeLogs, loadMakerMeta, loadPreviewPanel]);

  useEffect(() => window.tapMakerWork?.onOpenProject?.((projectPath) => { void openProjectPath(projectPath); }), [openProjectPath]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const updateScale = () => setStageScale(Math.min(stage.clientWidth / previewWidth, stage.clientHeight / previewHeight));
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [previewHeight, previewWidth]);

  const selected = useMemo(() => snapshot?.selectedId ? findUiNode(snapshot.root, snapshot.selectedId) : undefined, [snapshot]);
  const canvasVisualScore = useMemo(() => snapshot ? visualWeight(snapshot.root) : 0, [snapshot]);
  const canvasLooksSparse = canvasVisualScore < 8;
  const runtimeLive = Boolean(health?.runtimeSessionId);
  const runtimeScene = health?.runtimeScene || "idle";
  const effectiveSource = snapshotSource || health?.snapshotSource;
  const canvasSourceLabel = effectiveSource === "runtime"
    ? "真机活树（结构同步，非截屏）"
    : effectiveSource === "sidecar"
      ? "ui.json 旁路 / 编辑视图"
      : effectiveSource === "conversion"
        ? "Lua 静态转换 / 编辑视图"
        : activeUiPath.includes("MainShell")
          ? "MainShell 编辑视图"
          : "转换 IR / .ui.json（编辑视图）";
  const sourceLabel = canvasSourceLabel;
  const sourceMismatch = runtimeLive && (
    runtimeScene === "loading"
      ? effectiveSource !== "runtime"
      : effectiveSource === "conversion" || effectiveSource === "sidecar" || effectiveSource === undefined
  );
  const selectedEvents = useMemo(() => selected ? Object.entries(selected.props).filter(([key]) => /^on[A-Z]/.test(key)) : [], [selected]);
  const selectedAnimations = useMemo(() => selected ? Object.entries(selected.props).filter(([key]) => /animation|transition|duration|easing|opacity|transform/i.test(key)) : [], [selected]);
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    left: number;
    top: number;
    w?: number | undefined;
    h?: number | undefined;
  } | null>(null);

  const beginNodeDrag = useCallback((nodeId: string, event: React.PointerEvent) => {
    if (mode !== "live-edit" || !snapshot) return;
    const node = findUiNode(snapshot.root, nodeId);
    if (!node) return;
    const box = runtimeLayoutBox(node.props);
    const left = box.x ?? (typeof node.props.left === "number" ? node.props.left : 0);
    const top = box.y ?? (typeof node.props.top === "number" ? node.props.top : 0);
    dragRef.current = { id: nodeId, startX: event.clientX, startY: event.clientY, left, top, w: box.w, h: box.h };
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  }, [mode, snapshot]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || !snapshot) return;
      const scale = stageScale || 1;
      const dx = (event.clientX - drag.startX) / scale;
      const dy = (event.clientY - drag.startY) / scale;
      const nextLeft = Math.round(drag.left + dx);
      const nextTop = Math.round(drag.top + dy);
      setSnapshot((current) => {
        if (!current) return current;
        const visit = (node: UiNode): UiNode => {
          if (node.id === drag.id) {
            return {
              ...node,
              props: {
                ...node.props,
                position: "absolute",
                left: nextLeft,
                top: nextTop,
                $layout: {
                  x: nextLeft,
                  y: nextTop,
                  ...(drag.w != null ? { w: drag.w } : {}),
                  ...(drag.h != null ? { h: drag.h } : {})
                }
              }
            };
          }
          return { ...node, children: uiChildren(node).map(visit) };
        };
        return { ...current, root: visit(current.root) };
      });
    };
    const onUp = () => {
      const drag = dragRef.current;
      if (!drag || !snapshot) {
        dragRef.current = null;
        return;
      }
      const node = findUiNode(snapshot.root, drag.id);
      const box = node ? runtimeLayoutBox(node.props) : {};
      const left = box.x ?? (node && typeof node.props.left === "number" ? node.props.left : drag.left);
      const top = box.y ?? (node && typeof node.props.top === "number" ? node.props.top : drag.top);
      dragRef.current = null;
      if (!node) return;
      const nodeId = node.id;
      setSnapshot((current) => current ? { ...current, selectedId: nodeId } : current);
      void (async () => {
        const patch: UiPatch = {
          requestId: crypto.randomUUID(),
          baseRevision: snapshot.revision,
          nodeId,
          props: {
            position: "absolute",
            left,
            top
          },
          ...(node.source ? { source: node.source } : {})
        };
        const response = await fetch(`${API}/api/ui/patch`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch)
        });
        if (response.ok) {
          const next = await response.json() as UiSnapshot;
          setSnapshot(next);
          if (mode === "live-edit") setSidecarInfo((current) => ({ ...current, dirty: true }));
        }
      })();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [snapshot, stageScale, patchNode]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetch(`${API}/api/health`).then((res) => res.json()).then((value: Health) => {
        setHealth(value);
        if (value.runtimeSessionId) {
          void fetch(`${API}/api/ui/snapshot`).then((r) => r.json()).then((snap) => {
            setSnapshot(snap as UiSnapshot);
          }).catch(() => undefined);
        }
      }).catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, []);

  const historyAction = async (action: "undo" | "redo") => {
    const response = await fetch(`${API}/api/ui/${action}`, { method: "POST" });
    if (response.ok) {
      const next = await response.json() as UiSnapshot;
      setSnapshot(next);
      if (mode === "live-edit") setSidecarInfo((current) => ({ ...current, dirty: true }));
    }
  };

  const runtimeAction = async (action: "start" | "stop" | "refresh") => {
    setRuntimeBusy(true);
    setActiveTerminal("runtime");
    setLogs((current) => ({ ...current, runtime: [...current.runtime, `Maker preview ${action}…`] }));
    try {
      const response = await fetch(`${API}/api/maker/preview/${action}`, { method: "POST" });
      const result = await response.json() as { error?: string; state?: string; message?: string };
      if (!response.ok) {
        setLogs((current) => ({ ...current, runtime: [...current.runtime, `Runtime 操作失败：${result.error ?? response.statusText}`] }));
        toast(result.error || "Runtime 操作失败", "error");
      } else {
        setLogs((current) => ({
          ...current,
          runtime: [...current.runtime, `Maker preview ${action} 完成${result.state ? ` · ${result.state}` : ""}${result.message ? ` · ${result.message}` : ""}`]
        }));
        void refreshRuntimeLogs();
        void fetch(`${API}/api/health`).then((res) => res.json()).then(setHealth).catch(() => undefined);
        if (action !== "stop") {
          setMode("live-edit");
          setCenterTab("visual");
          setLeftTab("hierarchy");
          void openUiScreen("scripts/ui/MainShell.lua", { silentModule: true }).catch(() => undefined);
          toast("Runtime 已启动（独立窗口）。IDE 已打开 MainShell，可在画布点选并改属性。", "success");
          [1500, 3000, 5000, 8000, 12000].forEach((delay) => {
            window.setTimeout(() => {
              void syncFromRuntime();
              void fetch(`${API}/api/health`).then((res) => res.json()).then((value: Health) => {
                setHealth(value);
              }).catch(() => undefined);
            }, delay);
          });
        } else {
          toast("Runtime 已停止", "info");
        }
      }
    } finally {
      setRuntimeBusy(false);
    }
  };

  const syncFromRuntime = useCallback(async () => {
    try {
      const [healthRes, snapRes] = await Promise.all([
        fetch(`${API}/api/health`),
        fetch(`${API}/api/ui/snapshot`)
      ]);
      if (healthRes.ok) {
        const value = await healthRes.json() as Health;
        setHealth(value);
        if (value.snapshotSource) setSnapshotSource(value.snapshotSource);
      }
      if (snapRes.ok) setSnapshot(await snapRes.json() as UiSnapshot);
      setLogs((current) => ({
        ...current,
        runtime: [...current.runtime, "已从 Runtime 文件通道同步 UI 快照"]
      }));
    } catch (error) {
      setLogs((current) => ({
        ...current,
        runtime: [...current.runtime, `同步真机失败：${error instanceof Error ? error.message : String(error)}`]
      }));
    }
  }, []);

  useEffect(() => {
    if (!health?.runtimeSessionId) return;
    const timer = window.setInterval(() => {
      void fetch(`${API}/api/health`).then((res) => res.json()).then((value: Health) => {
        const prevScene = health.runtimeScene;
        setHealth(value);
        if (value.snapshotSource) setSnapshotSource(value.snapshotSource);
        if (value.runtimeScene === "live" && prevScene !== "live") {
          void syncFromRuntime();
          toast("真机已进入可同步界面，已拉取活树", "success");
        }
      }).catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [health?.runtimeSessionId, health?.runtimeScene, syncFromRuntime, toast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveFile();
        return;
      }
      if ((event.target as HTMLElement | null)?.closest(".monaco-editor")) return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        void historyAction(event.shiftKey ? "redo" : "undo");
      } else if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        void historyAction("redo");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveFile]);

  const updateDevice = (changes: Partial<DeviceProfile>) => setDevice((current) => ({ ...current, ...changes, id: changes.id ?? "custom", label: changes.label ?? "自定义" }));
  const openShortcut = window.tapMakerWork?.platform === "darwin" ? "⌘ O" : "Ctrl O";

  if (!projectLoaded || !project) {
    return (
      <main className="welcome-window">
        <header className="titlebar welcome-titlebar">
          <div className="brand"><span className="brand-mark">T</span><strong>TapMakerWork</strong></div>
          <span className="welcome-window-title">{projectLoaded ? "开始" : "正在连接…"}</span>
        </header>
        <section className="welcome-main">
          <div className="welcome-hero" aria-busy={projectOpening}>
            <div className="welcome-logo"><span className="brand-mark large">T</span><div><h1>TapMakerWork</h1><p>TapTap Maker 可视化工作台</p></div></div>
            <button className="open-project-card" onClick={() => void chooseProject()} disabled={!projectLoaded || projectOpening}>
              <span className="open-project-icon"><FolderOpen size={24} aria-hidden="true" /></span>
              <span><strong>{projectOpening ? "正在打开…" : "打开项目"}</strong><small>选择一个本地 Maker 项目文件夹</small></span>
              <kbd>{openShortcut}</kbd>
            </button>
            {projectError && <p className="welcome-error" role="alert">{projectError}</p>}
            {recentProjects.length > 0 && <div className="recent-projects">
              <div className="recent-heading"><span>最近项目</span><small>{recentProjects.length} 个</small></div>
              {recentProjects.map((item) => <button key={item.root} onClick={() => void openProjectPath(item.root)} disabled={projectOpening}>
                <Folder size={17} aria-hidden="true" /><span><strong>{item.name}</strong><small>{item.root}</small></span><ChevronRight size={16} aria-hidden="true" />
              </button>)}
            </div>}
          </div>
          <div className="welcome-decoration" aria-hidden="true"><div /><div /><div /></div>
        </section>
      </main>
    );
  }

  return (
    <main
      className="app-shell"
      style={{
        gridTemplateRows: `48px 40px minmax(200px, 1fr) ${layout.terminal}px 22px`,
        ["--preview-dock-w" as string]: `${layout.previewDock}px`
      } as React.CSSProperties}
    >
      <header className="titlebar">
        <div className="brand"><span className="brand-mark">T</span><strong>TapMakerWork</strong><span className="phase-badge">M0</span></div>
        <div className="project-chip" title={project.root}><Folder size={14} aria-hidden="true" /><span>{project.name}</span><GitBranch size={13} aria-hidden="true" /><small>{gitStatus?.branch || "—"}</small>{gitStatus?.dirty ? <small className="dirty-branch">•</small> : null}</div>
        <div className="runtime-status" role="status">{connected ? <Wifi size={14} aria-hidden="true" /> : <WifiOff size={14} aria-hidden="true" />}<span>{connected ? "Bridge 已连接" : "Bridge 断开"}</span>{health?.runtimeSessionId ? <small className="runtime-live">Runtime 已连接</small> : <small>Runtime 未接入</small>}</div>
        <div className="title-actions">
          <Tip label="在项目文件中全文搜索。输入关键词后回车，点击结果可跳转到源码行。">
            <button aria-label="搜索" onClick={() => { setSettingsOpen(false); setSearchOpen((open) => !open); toast(searchOpen ? "已关闭搜索" : "打开项目搜索", "info"); }}><Search size={15} /></button>
          </Tip>
          <Tip label="查看 Bridge / Maker / Runtime 适配器状态；可导出本地接入包（不会写入游戏 git）。">
            <button aria-label="设置" onClick={() => { setSearchOpen(false); setSettingsOpen((open) => { const next = !open; if (next) void loadSystemInfo(); toast(next ? "打开设置" : "关闭设置", "info"); return next; }); }}><Settings2 size={15} /></button>
          </Tip>
        </div>
      </header>

      <section className="commandbar">
        <div className="mode-switch" aria-label="工作模式">
          <Tip label="LocalRuntime：IDE 内渲染，可点按钮">
            <button aria-pressed={mode === "play"} className={mode === "play" ? "active" : ""} onClick={() => setMode("play")}><Play size={14} />游玩</button>
          </Tip>
          <Tip label="点选控件定位源码，不写真机">
            <button aria-pressed={mode === "inspect"} className={mode === "inspect" ? "active" : ""} onClick={() => setMode("inspect")}><Pause size={14} />检查</button>
          </Tip>
          <Tip label="改属性 → 写 .ui.json → 右侧预览刷新">
            <button aria-pressed={mode === "live-edit"} className={mode === "live-edit" ? "active" : ""} onClick={() => setMode("live-edit")}><SlidersHorizontal size={14} />实时编辑</button>
          </Tip>
        </div>
        <button className="icon-command" aria-label="撤销" onClick={() => void historyAction("undo")}><Undo2 size={14} /></button>
        <button className="icon-command" aria-label="重做" onClick={() => void historyAction("redo")}><Redo2 size={14} /></button>
        <span className="separator" />
        <Tip label="启动官方 Maker Runtime（独立窗口）">
          <button className="runtime-launch-button" disabled={!health?.capabilities.makerCli || runtimeBusy} onClick={() => { toast("正在启动 Maker 预览…", "info"); void runtimeAction("start"); }}><CirclePlay size={14} />{runtimeBusy ? "…" : "启动"}</button>
        </Tip>
        <Tip label="刷新 Maker Runtime">
          <button className="icon-command" aria-label="刷新 Runtime" disabled={runtimeBusy} onClick={() => void runtimeAction("refresh")}><RefreshCw size={14} /></button>
        </Tip>
        <Tip label="右侧内嵌预览（可与画布/代码并排）">
          <button
            className={`icon-command ${previewDockOpen ? "active" : ""}`}
            aria-pressed={previewDockOpen}
            aria-label="内嵌预览"
            onClick={() => {
              const next = !previewDockOpen;
              setPreviewDockOpen(next);
              if (next) void loadPreviewPanel();
            }}
          ><Columns2 size={14} /><span className="tiny">预览</span></button>
        </Tip>
        <Tip label="写入 .ui.json 旁路（不改 Lua）">
          <button className="icon-command" aria-label="保存视觉旁路" onClick={() => { toast("正在写入 .ui.json…", "info"); void saveUiSidecar(); }} disabled={!activeUiPath || !snapshot}><Save size={14} /></button>
        </Tip>
        <Tip label={sidecarInfo.path || "视觉旁路状态"}>
          <span className="sidecar-chip">{sidecarInfo.exists ? (sidecarInfo.dirty ? "ui.json 未同步" : "ui.json 已同步") : "ui.json 未创建"}</span>
        </Tip>
        <span className="commandbar-spacer" />
        <label className="device-compact">
          设备
          <select value={device.id} onChange={(event) => {
            const profile = DEFAULT_DEVICE_PROFILES.find((item) => item.id === event.target.value);
            if (profile) setDevice(profile);
          }}>
            <option value="custom">自定义</option>
            {DEFAULT_DEVICE_PROFILES.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
          </select>
        </label>
        <div className="tools-menu-wrap">
          <Tip label="设备参数与 Maker 工具">
            <button
              className={`icon-command ${toolsMenuOpen ? "active" : ""}`}
              aria-label="更多工具"
              aria-expanded={toolsMenuOpen}
              onClick={() => setToolsMenuOpen((open) => !open)}
            ><MoreHorizontal size={15} /></button>
          </Tip>
          {toolsMenuOpen && (
            <div className="tools-menu" role="menu">
              <section>
                <h3>画布设备</h3>
                <div className="tools-grid">
                  <label>宽<input type="number" min={100} max={4096} value={device.width} onChange={(e) => updateDevice({ width: Number(e.target.value) })} /></label>
                  <label>高<input type="number" min={100} max={4096} value={device.height} onChange={(e) => updateDevice({ height: Number(e.target.value) })} /></label>
                  <label>DPR<input type="number" min={1} max={8} step={0.25} value={device.dpr} onChange={(e) => updateDevice({ dpr: Number(e.target.value) || 1 })} /></label>
                  <label>FPS<input type="number" min={1} max={60} value={fps} onChange={(e) => setFps(Number(e.target.value) || 60)} /></label>
                </div>
              </section>
              <section>
                <h3>布局</h3>
                <div className="tools-actions">
                  <button onClick={() => { setToolsMenuOpen(false); resetLayout(); }}><Columns2 size={13} />还原默认</button>
                </div>
              </section>
              <section>
                <h3>Maker</h3>
                <div className="tools-actions">
                  <button disabled={makerBusy === "build" || !health?.capabilities.makerCli} onClick={() => { setToolsMenuOpen(false); void runMakerBuild(); }}><Hammer size={13} />构建</button>
                  <button disabled={makerBusy === "qrcode"} onClick={() => { setToolsMenuOpen(false); void runMakerQrcode(); }}><QrCode size={13} />二维码</button>
                  <button disabled={makerBusy === "doctor" || !health?.capabilities.makerCli} onClick={() => { setToolsMenuOpen(false); void runMakerDoctor(); }}><Activity size={13} />Doctor</button>
                  <button disabled={runtimeBusy} onClick={() => { setToolsMenuOpen(false); void runtimeAction("stop"); }}><Pause size={13} />停止</button>
                  <button onClick={() => { setToolsMenuOpen(false); void refreshRuntimeLogs(); }}><PanelBottom size={13} />日志</button>
                  <button onClick={() => { setToolsMenuOpen(false); void syncFromRuntime(); }}><Wifi size={13} />同步真机</button>
                </div>
              </section>
            </div>
          )}
        </div>
        <span className="mode-hint">
          {mode === "live-edit"
            ? "实时编辑：左画布改属性 → 自动写 ui.json → 右预览刷新"
            : mode === "inspect"
              ? "检查：点选跳源码"
              : "LocalRuntime：IDE 内渲染"}
        </span>
      </section>

      {qrOpen && (
        <section className="overlay-panel panel qr-panel" aria-label="测试二维码">
          <div className="overlay-heading">
            <strong>测试二维码</strong>
            <button onClick={() => setQrOpen(false)}>关闭</button>
          </div>
          <div className="qr-body">
            {makerMeta.qrcodeUrl ? (
              <>
                <img className="qr-image" src={makerMeta.qrcodeUrl} alt="Maker 测试二维码" />
                <p className="qr-meta">{makerMeta.title || project.name}{makerMeta.appId ? ` · App ${makerMeta.appId}` : ""}</p>
                <p className="qr-meta">{makerMeta.qrcodeGeneratedAt ? `生成于 ${makerMeta.qrcodeGeneratedAt}` : ""}</p>
                <code className="qr-url">{makerMeta.qrcodeUrl}</code>
                <div className="overlay-row">
                  <button onClick={() => openExternalUrl(makerMeta.qrcodeUrl || "")}>打开链接</button>
                  <button onClick={() => void copyText(makerMeta.qrcodeUrl || "")}>复制链接</button>
                  <button onClick={() => void runMakerQrcode()} disabled={makerBusy === "qrcode"}>{makerBusy === "qrcode" ? "生成中…" : "重新生成"}</button>
                </div>
              </>
            ) : (
              <>
                <p className="empty-state">项目里还没有 test_qrcode.url，点击下方生成。</p>
                <button onClick={() => void runMakerQrcode()} disabled={makerBusy === "qrcode"}>{makerBusy === "qrcode" ? "生成中…" : "生成测试二维码"}</button>
              </>
            )}
          </div>
        </section>
      )}

      {searchOpen && (
        <section className="overlay-panel panel" aria-label="项目搜索">
          <div className="overlay-heading"><strong>搜索项目</strong><button onClick={() => setSearchOpen(false)}>关闭</button></div>
          <div className="overlay-row">
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void runSearch(); }}
              placeholder="在项目文件中搜索…"
              autoFocus
            />
            <button onClick={() => void runSearch()} disabled={searchBusy}>{searchBusy ? "搜索中…" : "搜索"}</button>
          </div>
          <div className="overlay-list">
            {searchHits.length === 0 ? <p className="empty-state">无结果。输入关键词后回车。</p> : searchHits.map((hit) => (
              <button key={`${hit.path}:${hit.line}`} onClick={() => { void readFile(hit.path); setSearchOpen(false); }}>
                <strong>{hit.path}</strong>
                <small>L{hit.line}</small>
                <code>{hit.preview}</code>
              </button>
            ))}
          </div>
        </section>
      )}

      {settingsOpen && (
        <section className="overlay-panel panel" aria-label="设置">
          <div className="overlay-heading"><strong>设置 / 系统</strong><button onClick={() => setSettingsOpen(false)}>关闭</button></div>
          <div className="settings-grid">
            <div><h3>连接</h3><p>Bridge：{API}</p><p>协议：{String((systemInfo as { protocolVersion?: number } | undefined)?.protocolVersion ?? health ? 1 : "—")}</p><p>Node：{String((systemInfo as { node?: string } | undefined)?.node ?? "—")}</p><p>平台：{String((systemInfo as { platform?: string } | undefined)?.platform ?? "—")}</p></div>
            <div><h3>Maker</h3><p>版本：{health?.makerVersion || "未发现"}</p><p>项目：{project.root}</p><p>当前 UI：{String((systemInfo as { activeUiEntry?: string } | undefined)?.activeUiEntry ?? activeUiPath)}</p></div>
            <div><h3>Runtime 适配器</h3><p>{adapterExport || (health?.runtimeAdapter?.installed ? `已安装：${health.runtimeAdapter.paths.join(", ")}` : "未安装到当前 Maker 项目")}</p><p>Session：{health?.runtimeSessionId || "未连接"}</p><button onClick={() => void exportRuntimeAdapter()}>导出接入包到 outputs/runtime-adapter</button></div>
            <div><h3>能力</h3><p>Maker CLI：{health?.capabilities.makerCli ? "可用" : "不可用"}</p><p>UI Bridge：{health?.capabilities.uiBridge ? "可用" : "不可用"}</p><p>Runtime 帧：{health?.capabilities.runtimeFrames ? "可用" : "未接入"}</p><p>Shell 沙箱：{health?.capabilities.shellSandbox ? "就绪" : "锁定"}</p></div>
          </div>
        </section>
      )}

      <section
        className="workspace"
        style={{ gridTemplateColumns: `${layout.left}px 5px minmax(320px, 1fr) 5px ${layout.right}px` }}
      >
        <aside className="left-pane panel">
          <nav className="pane-tabs" aria-label="资源导航">
            <Tip label="项目文件">
              <button aria-pressed={leftTab === "files"} className={leftTab === "files" ? "active" : ""} onClick={() => setLeftTab("files")}><Files size={14} />文件</button>
            </Tip>
            <Tip label="UI 界面列表">
              <button aria-pressed={leftTab === "screens"} className={leftTab === "screens" ? "active" : ""} onClick={() => setLeftTab("screens")}><MonitorPlay size={14} />界面</button>
            </Tip>
            <Tip label="控件树">
              <button aria-pressed={leftTab === "hierarchy"} className={leftTab === "hierarchy" ? "active" : ""} onClick={() => setLeftTab("hierarchy")}><Layers3 size={14} />层级</button>
            </Tip>
            <Tip label="图片资源">
              <button aria-pressed={leftTab === "assets"} className={leftTab === "assets" ? "active" : ""} onClick={() => setLeftTab("assets")}><Image size={14} />资源</button>
            </Tip>
          </nav>
          <div className="pane-body">
            {leftTab === "hierarchy" && snapshot && (
              <div className="hier-wrap">
                <div className="hier-actions">
                  <Tip label="显示/隐藏当前节点（对齐 Cocos Creator 的眼睛开关）。隐藏时画布不渲染该节点。">
                    <button className="icon-command" aria-label="显示隐藏" disabled={!snapshot.selectedId} onClick={() => {
                      if (!selected) { toast("请先选择节点", "warn"); return; }
                      void runTreeOp({ type: "toggle-visible", nodeId: selected.id }, selected.props.visible === false ? "显示节点" : "隐藏节点");
                    }}>
                      {selected?.props.visible === false ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </Tip>
                  <Tip label="在同级节点中上移。">
                    <button className="icon-command" aria-label="上移" disabled={!snapshot.selectedId} onClick={() => {
                      if (!selected) { toast("请先选择节点", "warn"); return; }
                      void runTreeOp({ type: "move", nodeId: selected.id, direction: "up" }, "上移");
                    }}><ArrowUp size={13} /></button>
                  </Tip>
                  <Tip label="在同级节点中下移。">
                    <button className="icon-command" aria-label="下移" disabled={!snapshot.selectedId} onClick={() => {
                      if (!selected) { toast("请先选择节点", "warn"); return; }
                      void runTreeOp({ type: "move", nodeId: selected.id, direction: "down" }, "下移");
                    }}><ArrowDown size={13} /></button>
                  </Tip>
                  <select value={newNodeType} onChange={(event) => setNewNodeType(event.target.value as typeof newNodeType)} title="新建节点类型">
                    <option value="Panel">Panel</option>
                    <option value="Label">Label</option>
                    <option value="Button">Button</option>
                    <option value="Image">Image</option>
                  </select>
                  <Tip label="在当前节点下创建子节点（Cocos：创建子节点）。">
                    <button className="icon-command" aria-label="添加子节点" disabled={!snapshot.selectedId} onClick={() => {
                      if (!selected) { toast("请先选择节点", "warn"); return; }
                      void runTreeOp({ type: "insert-child", nodeId: selected.id, nodeType: newNodeType }, `添加子节点 ${newNodeType}`);
                    }}><Plus size={13} /></button>
                  </Tip>
                  <Tip label="在当前节点旁创建同级节点（Cocos：创建兄弟节点）。根节点不可用。">
                    <button className="icon-command" aria-label="添加兄弟节点" disabled={!snapshot.selectedId} onClick={() => {
                      if (!selected) { toast("请先选择节点", "warn"); return; }
                      void runTreeOp({ type: "insert-sibling", nodeId: selected.id, nodeType: newNodeType }, `添加兄弟节点 ${newNodeType}`);
                    }}><Plus size={13} /><span className="tiny">兄弟</span></button>
                  </Tip>
                  <Tip label="删除当前节点（根节点不可删）。真机侧会尽量隐藏对应控件。">
                    <button className="icon-command danger" aria-label="删除节点" disabled={!snapshot.selectedId} onClick={() => {
                      if (!selected) { toast("请先选择节点", "warn"); return; }
                      void runTreeOp({ type: "delete", nodeId: selected.id }, `删除 ${selected.name}`);
                    }}><Trash2 size={13} /></button>
                  </Tip>
                  <Tip label="复制当前节点（含子节点），插在同级后面。根节点不可复制。">
                    <button className="icon-command" aria-label="复制节点" disabled={!snapshot.selectedId} onClick={duplicateSelected}><Copy size={13} /></button>
                  </Tip>
                  <Tip label="重命名当前节点（也可在层级树中双击名称）。">
                    <button className="icon-command" aria-label="重命名节点" disabled={!snapshot.selectedId} onClick={beginRenameSelected}><span className="tiny">重命名</span></button>
                  </Tip>
                </div>
                <HierarchyNode
                  node={snapshot.root}
                  selectedId={snapshot.selectedId}
                  onSelect={(id) => {
                    selectNodeAndLocate(id);
                    if (renamingId && renamingId !== id) setRenamingId(null);
                  }}
                  renamingId={renamingId}
                  renameDraft={renameDraft}
                  onRenameDraft={setRenameDraft}
                  onCommitRename={commitRename}
                  onCancelRename={() => setRenamingId(null)}
                  dragId={hierDragId}
                  dropHint={hierDrop}
                  onDragStartId={(id) => {
                    setHierDragId(id);
                    setSnapshot((current) => current ? { ...current, selectedId: id } : current);
                    toast(`开始拖拽：${id.split(":").slice(-2).join(":")}`, "info");
                  }}
                  onDragOverId={onHierDragOverId}
                  onDropId={onHierDropId}
                />
              </div>
            )}
            {leftTab === "files" && (files.length ? files.map((entry) => <FileTreeEntry key={entry.path} entry={entry} depth={0} selectedPath={selectedFile} onOpen={(path) => void readFile(path)} />) : <p className="empty-state">项目目录为空。点击顶部项目名称可重新选择目录。</p>)}
            {leftTab === "screens" && <div className="screen-list">
              <div className="screen-list-heading"><span>检测到 {screens.length} 个 UI 文件</span><button onClick={() => void loadProjectContents()} aria-label="重新扫描界面"><RefreshCw size={13} /></button></div>
              {screens.map((screen) => <button key={screen.path} className={`screen-row ${activeUiPath === screen.path ? "active" : ""}`} onClick={() => void openUiScreen(screen.path)}>
                <MonitorPlay size={15} /><span><strong>{screen.name}</strong><small>{screenLabel(screen)}</small></span>{activeUiPath === screen.path && <span className="active-dot" />}
              </button>)}
            </div>}
            {leftTab === "assets" && <div className="asset-list">
              <div className="screen-list-heading"><span>{assets.length ? `${assets.length} 个图片资源` : "项目资源"}</span><button onClick={() => void loadAssets()} aria-label="刷新资源"><RefreshCw size={13} /></button></div>
              {assets.length === 0 ? <p className="empty-state">未发现图片资源，或 assets 目录为空。</p> : assets.slice(0, 120).map((asset) => (
                <button key={asset.path} className="file-row" onClick={() => void readFile(asset.path).catch(() => undefined)} title={asset.path}>
                  <Image size={14} /><span>{asset.name}</span><small>{Math.max(1, Math.round(asset.bytes / 1024))} KB</small>
                </button>
              ))}
            </div>}
          </div>
        </aside>
        <PanelResizer orientation="col" label="调节左侧栏宽度" onPointerDown={beginLayoutDrag("left")} />

        <section className={`center-pane panel ${previewDockOpen ? "with-preview-dock" : ""}`}>
          <nav className="document-tabs">
            <button aria-pressed={centerTab === "visual"} className={centerTab === "visual" ? "active" : ""} onClick={() => setCenterTab("visual")}><MonitorPlay size={14} />{fileName(activeUiPath).replace(/\.lua$/i, ".ui")}</button>
            <button aria-pressed={centerTab === "code"} className={centerTab === "code" ? "active" : ""} onClick={() => setCenterTab("code")}><Code2 size={14} />{fileName(selectedFile)}{codeDirty && <span className="dirty-dot" aria-label="有未保存更改">●</span>}</button>
            <button
              aria-pressed={previewDockOpen}
              className={previewDockOpen ? "active" : ""}
              onClick={() => {
                const next = !previewDockOpen;
                setPreviewDockOpen(next);
                if (next) void loadPreviewPanel();
              }}
            ><Columns2 size={14} />预览</button>
            <button className="document-save" onClick={() => void saveFile()} disabled={!codeDirty || saveState === "saving"} title="保存 (⌘/Ctrl S)"><Save size={14} />{saveState === "saving" ? "保存中" : saveState === "saved" ? "已保存" : saveState === "error" ? "失败" : "保存"}</button>
          </nav>
          <div className={`center-body ${previewDockOpen ? "split" : ""}`}>
            <div className="center-main">
              {centerTab === "visual" ? (
                <div className="canvas-area">
                  <div className="canvas-meta">
                    <span>{device.width}×{device.height}</span>
                    <span>DPR {device.dpr}</span>
                    <span>{mode === "play" ? "LocalRuntime" : mode === "inspect" ? "检查" : "实时编辑"}</span>
                    <span className="canvas-source">画布：{canvasSourceLabel}</span>
                    {runtimeLive && (
                      <span className="canvas-source runtime-scene">
                        真机：{runtimeScene === "live" ? "活树可同步" : runtimeScene === "loading" ? "加载/启动画面" : "已连接"}
                      </span>
                    )}
                  </div>
                  <div ref={stageRef} className="device-stage" style={{ aspectRatio: `${device.width}/${device.height}` }}>
                    <div className="safe-area" style={{
                      top: `${device.safeArea.top / device.height * 100}%`,
                      right: `${device.safeArea.right / device.width * 100}%`,
                      bottom: `${device.safeArea.bottom / device.height * 100}%`,
                      left: `${device.safeArea.left / device.width * 100}%`
                    }} />
                    <div className="runtime-surface" style={{
                      width: previewWidth,
                      height: previewHeight,
                      transform: `scale(${stageScale})`
                    }}>
                      {snapshot && (
                        <RuntimeNode
                          node={snapshot.root}
                          selectedId={snapshot.selectedId}
                          onSelect={selectNodeAndLocate}
                          onDragStart={beginNodeDrag}
                          onPlayClick={(node) => toast(`LocalRuntime 点击：${node.name}`, "success")}
                          mode={mode}
                        />
                      )}
                    </div>
                  </div>
                  <div className="simulation-ribbon">
                    {sourceMismatch ? (
                      <span className="sparse-hint">
                        {runtimeScene === "loading"
                          ? "真机在加载/启动画面，画布是 MainShell 编辑结构，两边内容不同是正常的。"
                          : "画布是文件结构（转换/旁路）；真机含 Theme 与动态内容，外观不会 100% 一致。"}
                        <button type="button" onClick={() => void syncFromRuntime()}>同步真机</button>
                        {runtimeScene === "live" ? " · 等进入游戏后再同步" : ""}
                      </span>
                    ) : canvasLooksSparse ? (
                      <span className="sparse-hint">
                        当前界面静态节点较少/缺主题色，画布偏空。建议
                        <button type="button" onClick={() => void openUiScreen("scripts/ui/MainShell.lua")}>打开 MainShell</button>
                        做实时编辑。
                      </span>
                    ) : (
                      <span className="sparse-hint">
                        画布是可编辑控件树，不是游戏截屏；真机窗口是 Runtime 实际渲染。
                        <button type="button" onClick={() => void syncFromRuntime()}>从真机同步结构</button>
                        {mode === "live-edit" ? " · 改属性会写 .ui.json" : ""}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <Editor
                  theme="vs-dark"
                  language={selectedFile.endsWith(".lua") ? "lua" : selectedFile.endsWith(".json") ? "json" : selectedFile.endsWith(".ts") || selectedFile.endsWith(".tsx") ? "typescript" : "plaintext"}
                  value={code}
                  onChange={(value) => { setCode(value ?? ""); setCodeDirty(true); setSaveState("idle"); }}
                  onMount={onEditorMount}
                  options={{ readOnly: false, minimap: { enabled: false }, fontSize: 13, padding: { top: 14 }, automaticLayout: true }}
                />
              )}
            </div>
            {previewDockOpen && (
              <>
                <PanelResizer orientation="col" label="调节预览坞宽度" onPointerDown={beginLayoutDrag("previewDock", true)} />
                <aside className="preview-side panel">
                  <PreviewDock
                    compact
                    runtimeLive={runtimeLive}
                    panel={previewPanel}
                    projectName={project?.name || ""}
                    desktopAvailable={Boolean(window.tapMakerWork?.desktop && window.tapMakerWork?.preview)}
                    onChanged={setPreviewPanel}
                    onLog={(line) => setLogs((current) => ({ ...current, runtime: [...current.runtime, line] }))}
                    onToast={toast}
                    onOpenExternal={openExternalUrl}
                  />
                </aside>
              </>
            )}
          </div>
        </section>
        <PanelResizer orientation="col" label="调节右侧属性栏宽度" onPointerDown={beginLayoutDrag("right", true)} />

        <aside className="right-pane panel">
          <nav className="pane-tabs">
            <button aria-pressed={inspectorTab === "properties"} className={inspectorTab === "properties" ? "active" : ""} onClick={() => setInspectorTab("properties")}><SlidersHorizontal size={14} />属性</button>
            <button aria-pressed={inspectorTab === "events"} className={inspectorTab === "events" ? "active" : ""} onClick={() => setInspectorTab("events")}><CirclePlay size={14} />事件</button>
            <button aria-pressed={inspectorTab === "animation"} className={inspectorTab === "animation" ? "active" : ""} onClick={() => setInspectorTab("animation")}><Sparkles size={14} />动画</button>
          </nav>
          {selected ? <div className="inspector-body">
            <div className="selection-heading"><span className="selection-icon">{iconForType(selected.type)}</span><div><strong>{selected.name}</strong><small>{selected.type} · {selected.id}</small></div></div>
            {inspectorTab === "properties" && <><section className="property-group"><h3>布局</h3>
              <InspectorField label="宽度" property="width" value={selected.props.width} onCommit={patchNode} />
              <InspectorField label="高度" property="height" value={selected.props.height} onCommit={patchNode} />
              <InspectorField label="间距" property="gap" value={selected.props.gap} onCommit={patchNode} />
              <InspectorField label="Flex 方向" property="flexDirection" value={selected.props.flexDirection} onCommit={patchNode} />
            </section>
            <section className="property-group"><h3>外观</h3>
              <InspectorField label="文字" property="text" value={selected.props.text} onCommit={patchNode} />
              <InspectorField label="字号" property="fontSize" value={selected.props.fontSize} onCommit={patchNode} />
              <InspectorField label="背景 RGBA" property="backgroundColor" value={selected.props.backgroundColor} onCommit={patchNode} />
              <InspectorField label="圆角" property="borderRadius" value={selected.props.borderRadius} onCommit={patchNode} />
            </section>
            <Tip label="打开当前选中节点对应的 Lua 源码，并定位到构造行。">
              <button className="source-link" onClick={() => selected ? void jumpToSource(selected) : setCenterTab("code")}><FileCode2 size={14} />{selected.source?.file ?? "运行时节点"}:{selected.source?.line ?? "?"}</button>
            </Tip>
            </>}
            {inspectorTab === "events" && <section className="inspector-section">
              <div className="inspector-section-title"><div><h3>交互事件</h3><p>从当前节点的 Lua 构造参数中提取</p></div><span>{selectedEvents.length}</span></div>
              {selectedEvents.length ? selectedEvents.map(([key, value]) => <div className="binding-card" key={key}><div><CirclePlay size={14} /><strong>{key}</strong></div><code>{displayValue(value)}</code></div>) : <div className="inspector-empty"><CirclePlay size={22} /><strong>该节点没有事件</strong><span>在 Lua 中添加 onClick、onChange 等处理器后会自动显示。</span></div>}
              <button className="inspector-code-button" onClick={() => selected.source?.file && void readFile(selected.source.file)}><FileCode2 size={14} />在源码中编辑事件</button>
            </section>}
            {inspectorTab === "animation" && <section className="inspector-section">
              <div className="inspector-section-title"><div><h3>动画与过渡</h3><p>展示节点声明的动画属性</p></div><span>{selectedAnimations.length}</span></div>
              {selectedAnimations.length ? selectedAnimations.map(([key, value]) => <div className="binding-card" key={key}><div><Sparkles size={14} /><strong>{key}</strong></div><code>{displayValue(value)}</code></div>) : <div className="inspector-empty"><Sparkles size={22} /><strong>尚未声明动画</strong><span>可在 Lua 节点上添加 transition、duration、easing 或 animation 属性。</span></div>}
              <button className="inspector-code-button" onClick={() => selected.source?.file && void readFile(selected.source.file)}><FileCode2 size={14} />在源码中编辑动画</button>
            </section>}
          </div> : <p className="empty-state">选择一个运行时节点。</p>}
        </aside>
      </section>

      <section className="terminal-panel panel">
        <PanelResizer orientation="row" label="调节终端高度" onPointerDown={beginLayoutDrag("terminal", false, true)} />
        <nav className="terminal-tabs">
          <span className="terminal-title"><PanelBottom size={14} />终端</span>
          {channels.map((channel) => <button key={channel.id} aria-pressed={activeTerminal === channel.id} className={activeTerminal === channel.id ? "active" : ""} onClick={() => setActiveTerminal(channel.id)}>{channel.label}</button>)}
          <button className="terminal-reset" onClick={resetLayout} title="一键还原 IDE 布局">还原布局</button>
        </nav>
        <pre className={`terminal-output ${activeTerminal === "shell" ? "locked" : ""}`}>{logs[activeTerminal].join("\n")}</pre>
        {activeTerminal === "shell" && <div className="sandbox-warning"><ShieldAlert size={14} />项目外访问将由 OS 沙箱拒绝；当前实现未通过验证，因此命令入口保持关闭。</div>}
      </section>

      <footer className="statusbar">
        <span>{health?.capabilities.makerCli ? `Maker ${health.makerVersion}` : "Maker CLI 未发现"}</span>
        <span>{project?.makerBound ? "Maker 项目已绑定" : "模拟项目"}</span>
        <span>{gitStatus ? `Git ${gitStatus.branch}${gitStatus.dirty ? " •" : ""}` : "Git —"}</span>
        <span>{snapshot ? `UI rev ${snapshot.revision}` : "UI 未连接"}</span>
        <span>{sidecarInfo.exists ? (sidecarInfo.dirty ? `${sidecarInfo.path || "ui.json"} ●` : `${sidecarInfo.path || "ui.json"} 已同步`) : "视觉旁路未创建"}</span>
        <span className="status-spacer" />
        <span>{health?.runtimeAdapter?.installed ? "Runtime 适配器已安装" : "Runtime 适配器未安装"}</span>
        <span>{health?.capabilities.shellSandbox ? "沙箱就绪" : "沙箱锁定"}</span>
        <span>{connected ? "本机连接" : "离线"}</span>
      </footer>
      <ToastStack items={toasts} />
    </main>
  );
}
