import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Editor, { DiffEditor, type OnMount } from "@monaco-editor/react";
import {
  Box,
  Boxes,
  ChevronDown,
  ChevronRight,
  CircleHelp,
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
  Columns2,
  LayoutDashboard,
  Music2,
  Video,
  Rocket,
  Download,
  CheckCircle2,
  Pipette,
  Maximize2,
  ZoomIn,
  ZoomOut,
  GripVertical,
  PanelTop,
  MousePointer2,
  Move,
  RotateCw,
  Scaling,
  BoxSelect,
  Magnet,
  Cpu,
  ScrollText,
  AlertTriangle,
  XCircle,
  X,
  Heart,
  Gamepad2,
  Users,
  MessageCircle,
  Map,
  Package,
  ShieldCheck,
  Lightbulb,
  Wrench,
  Clock3
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
  type UiNodeType,
  type UiPatch,
  type UiSnapshot,
  type UiTreeOp,
  type UiValue,
  type PreviewPanelState,
  type ProjectWorkflowAction,
  type ProjectWorkflowOverview,
  type WorkspaceMode
} from "@tapmakerwork/protocol";
import { PreviewDock } from "./PreviewDock";
import { ProjectCockpit } from "./ProjectCockpit";
import { RuntimeMirror } from "./RuntimeMirror";
import { Tip } from "./Tip";
import { DevTipsPanel } from "./DevTipsPanel";
import { ImageCompressPanel } from "./ImageCompressPanel";
import {
  CoachMark,
  COACH_LIVE_EDIT_KEY,
  COACH_RUNTIME_START_KEY,
  dismissCoachMark,
  enableCoachMarks,
  markOnboardingSeen,
  NewbieGuideDialog,
  readCoachMark,
  readOnboardingSeen
} from "./NewbieGuide";
import { rgbaCss, rgbaFromHex, rgbaFromValue, rgbaToHex, type RgbaColor } from "./color-utils";
import { angleBetween, resizeRect, scaleRatio, snapValue, toolForShortcut, type TransformTool } from "./runtime-transform";
import type { DesktopHardwareAccelerationState, DesktopLegalState, DesktopPermissionState, DesktopTelemetryState, DesktopUpdateState } from "./desktop-api";
import { extractRuntimeErrorReport, type RuntimeErrorReport } from "./runtime-error";
import { flushStudioGameAlgo, initStudioGameAlgo, setStudioGameAlgoEnabled, trackStudioGameAlgo } from "./gamealgo";
import wechatPayImage from "../../../docs/sponsor/wechat-pay.png";

const BUILTIN_QQ_GROUP_ID = "1124103038";
const BUILTIN_QQ_GROUP_NAME = "TapMakerWork工具交流群";
const BUILTIN_QQ_GROUP_JOIN_URL = "https://qm.qq.com/q/OCt1HAmHK2";
const OFFICIAL_SITE_URL = "https://androidsix.github.io/tapmakerwork-site/";
import alipayImage from "../../../docs/sponsor/alipay.png";

interface CommunityInfo {
  qqGroupId: string;
  qqGroupName: string;
  qqGroupJoinUrl: string;
  officialSiteUrl?: string;
  source?: "gitee" | "github" | "builtin";
}

const API = "http://127.0.0.1:43121";
declare const __APP_VERSION__: string;

interface Health {
  ok: boolean;
  capabilities: BridgeCapabilities & { runtimeBridge?: boolean; makerBuild?: boolean; makerQrcode?: boolean };
  makerVersion?: string;
  sandbox: { available: boolean; reason: string };
  runtimeSessionId?: string;
  runtimeConnectedAt?: string;
  runtimeScene?: "idle" | "loading" | "live";
  snapshotSource?: "conversion" | "sidecar" | "runtime" | "empty";
  runtimeAdapter?: { installed: boolean; paths: string[]; backend?: "yoga" | "nanovg" };
  uiBackend?: "yoga" | "nanovg";
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

interface MakerPreviewStatus {
  state?: string;
  process_alive?: boolean | null;
  runtime_pid?: number;
  error?: string;
}

type MakerRuntimeMode = "device" | "stable" | "beta" | "version";

interface MakerVersionState {
  preference: { mode: MakerRuntimeMode; version?: string };
  active?: { version: string; entry: string };
  installed: Array<{ version: string; entry: string }>;
  channels: {
    stable: { installed?: string; latest?: string; updateAvailable: boolean };
    beta: { installed?: string; latest?: string; updateAvailable: boolean };
  };
  checkedAt?: string;
}

interface NodeVersionState {
  device: { version: string; executable: string } | null;
  embedded: { version: string; executable: string };
  active: { version: string; executable: string; source: "device" | "managed" | "embedded" };
  installed: Array<{ version: string; executable: string; source: "managed" }>;
  stable: { installed?: string; latest?: string; updateAvailable: boolean };
  checkedAt?: string;
}

interface ProjectState {
  project?: { root: string; name: string; makerBound: boolean };
  snapshot?: UiSnapshot;
  activeUiEntry?: string;
}

type RecentProject = { root: string; name: string };
const OPEN_PROJECTS_STORAGE_KEY = "tapmakerwork.openProjects";

function loadOpenProjects(): RecentProject[] {
  try {
    const stored = JSON.parse(localStorage.getItem(OPEN_PROJECTS_STORAGE_KEY) || "[]") as unknown;
    return Array.isArray(stored)
      ? stored.filter((item): item is RecentProject => Boolean(item && typeof item.root === "string" && typeof item.name === "string")).slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

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
  extension?: string;
  kind?: "image" | "audio" | "video" | "model" | "font" | "other";
  referencedBy?: string[];
  status?: "referenced" | "unreferenced" | "external";
}

interface GitStatusState {
  branch: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  dirty?: boolean;
  changes?: GitChangeState[];
  commits?: Array<{ hash: string; shortHash: string; subject: string; author: string; relativeDate: string; refs: string[] }>;
}

interface GitChangeState {
  path: string;
  status: string;
  indexStatus: string;
  workTreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
}

interface GitFileDiffState {
  path: string;
  scope: "worktree" | "staged";
  status: string;
  original: string;
  modified: string;
  binary: boolean;
  added: boolean;
  deleted: boolean;
  additions: number;
  deletions: number;
  loading?: boolean;
  error?: string;
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
  if (type === "Image") return <Image size={14} />;
  if (type === "Node") return <Box size={14} />;
  return <Boxes size={14} />;
}

function labelForType(type: string): string {
  if (type === "Button") return "按钮";
  if (type === "Label") return "文字";
  if (type === "Panel") return "容器";
  if (type === "Node") return "空节点";
  return type;
}

function fileName(filePath: string): string {
  return filePath.split("/").at(-1) || filePath;
}

function languageForFile(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".lua")) return "lua";
  if (lower.endsWith(".json") || lower.endsWith(".jsonc")) return "json";
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".js") || lower.endsWith(".jsx")) return "javascript";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".html")) return "html";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";
  return "plaintext";
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

function legacyCopyText(text: string): boolean {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.setAttribute("aria-hidden", "true");
  Object.assign(field.style, {
    position: "fixed",
    left: "-9999px",
    top: "0",
    opacity: "0",
    pointerEvents: "none"
  });
  document.body.appendChild(field);
  field.select();
  field.setSelectionRange(0, field.value.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    field.remove();
    active?.focus();
  }
  return copied;
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
type CenterTab = "workflow" | "visual" | "runtime" | "code" | "git-diff";
type DocumentTab = Exclude<CenterTab, "git-diff"> | "preview";
type FloatingWorkspace = { x: number; y: number; width: number; height: number };
const LAYOUT_STORAGE_KEY = "tapmakerwork.workspaceLayout";
const DOCUMENT_TABS_STORAGE_KEY = "tapmakerwork.documentTabs";
const DEFAULT_DOCUMENT_TABS: DocumentTab[] = ["workflow", "visual", "runtime", "code", "preview"];

function loadDocumentTabs(): DocumentTab[] {
  try {
    const value = JSON.parse(localStorage.getItem(DOCUMENT_TABS_STORAGE_KEY) || "[]") as unknown;
    if (!Array.isArray(value)) return [...DEFAULT_DOCUMENT_TABS];
    const valid = value.filter((item): item is DocumentTab => DEFAULT_DOCUMENT_TABS.includes(item as DocumentTab));
    return [...new Set([...valid, ...DEFAULT_DOCUMENT_TABS])];
  } catch {
    return [...DEFAULT_DOCUMENT_TABS];
  }
}

function loadWorkspaceLayout(): WorkspaceLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT };
    const parsed = JSON.parse(raw) as Partial<WorkspaceLayout>;
    return {
      left: clamp(parsed.left ?? DEFAULT_LAYOUT.left, 160, 420),
      right: clamp(parsed.right ?? DEFAULT_LAYOUT.right, 200, 480),
      previewDock: clamp(parsed.previewDock ?? DEFAULT_LAYOUT.previewDock, 220, 520),
      terminal: clamp(parsed.terminal ?? DEFAULT_LAYOUT.terminal, 40, terminalMaxHeight())
    };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

function terminalMaxHeight(): number {
  return Math.max(120, (typeof window === "undefined" ? 800 : window.innerHeight) - 48 - 40 - 22 - 96);
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
      title={orientation === "row" ? "拖动调整高度" : "拖动调整宽度"}
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

const CANVAS_RESIZE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

function RuntimeNode({ node, rootId, selectedId, selectedIds, onSelect, onDragStart, onPlayClick, onContextMenu, mode, canvasTool = "move", editable = false }: {
  node: UiNode;
  rootId: string;
  selectedId: string | undefined;
  selectedIds: string[];
  onSelect: (id: string, additive?: boolean) => void;
  onDragStart?: ((id: string, event: React.PointerEvent, operation?: string) => void) | undefined;
  onPlayClick?: ((node: UiNode) => void) | undefined;
  onContextMenu?: ((id: string, x: number, y: number) => void) | undefined;
  mode: WorkspaceMode;
  canvasTool?: TransformTool;
  editable?: boolean;
}) {
  if (!node || typeof node !== "object") return null;
  if (node.props?.visible === false) return null;
  const isSlot = node.type === "Slot";
  const isEmptyFactory = Boolean(node.props?.$factory) && uiChildren(node).length === 0;
  const className = [
    "runtime-node",
    `runtime-${(node.type || "widget").toLowerCase()}`,
    selectedIds.includes(node.id) ? "selected" : "",
    isSlot ? "runtime-slot" : "",
    isEmptyFactory ? "runtime-factory" : "",
    mode === "play" ? "local-runtime" : "",
    editable ? "canvas-editable-node" : "",
    node.id === rootId ? "canvas-root-node" : ""
  ].join(" ");
  const imageSource = node.type === "Image" ? imagePathFromProps(node.props) : undefined;
  return (
    <div
      className={className}
      style={runtimeStyle(node)}
      data-node-id={node.id}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect(node.id, event.shiftKey);
        if (editable && node.id !== rootId && onDragStart && !event.shiftKey && canvasTool === "move") onDragStart(node.id, event, "move");
        if (mode === "play" && node.type === "Button" && onPlayClick) onPlayClick(node);
      }}
      onContextMenu={(event) => {
        if (!editable || !onContextMenu) return;
        event.preventDefault();
        event.stopPropagation();
        onSelect(node.id);
        onContextMenu(node.id, event.clientX, event.clientY);
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
        <RuntimeNode key={child.id} node={child} rootId={rootId} selectedId={selectedId} selectedIds={selectedIds} onSelect={onSelect} onDragStart={onDragStart} onPlayClick={onPlayClick} onContextMenu={onContextMenu} mode={mode} canvasTool={canvasTool} editable={editable} />
      ))}
      {selectedId === node.id && mode !== "play" && <span className="node-badge">{labelForType(node.type)}{node.source?.line ? ` :${node.source.line}` : ""}</span>}
      {editable && selectedId === node.id && node.id !== rootId && canvasTool === "move" && (
        <button type="button" className="runtime-transform-handle runtime-move-handle" aria-label={`移动 ${node.name || labelForType(node.type)}`} onPointerDown={(event) => onDragStart?.(node.id, event, "move")}><Move size={12} /></button>
      )}
      {editable && selectedId === node.id && node.id !== rootId && canvasTool === "rotate" && (
        <button type="button" className="runtime-transform-handle runtime-rotate-handle" aria-label={`旋转 ${node.name || labelForType(node.type)}`} onPointerDown={(event) => onDragStart?.(node.id, event, "rotate")}><RotateCw size={12} /></button>
      )}
      {editable && selectedId === node.id && node.id !== rootId && canvasTool === "scale" && (
        <button type="button" className="runtime-transform-handle runtime-scale-handle" aria-label={`缩放 ${node.name || labelForType(node.type)}`} onPointerDown={(event) => onDragStart?.(node.id, event, "scale")}><Scaling size={12} /></button>
      )}
      {editable && selectedId === node.id && node.id !== rootId && canvasTool === "rect" && CANVAS_RESIZE_HANDLES.map((handle) => (
        <button
          type="button"
          key={handle}
          className={`runtime-resize-handle handle-${handle}`}
          aria-label={`从 ${handle} 方向调整 ${node.name || labelForType(node.type)} 大小`}
          onPointerDown={(event) => onDragStart?.(node.id, event, handle)}
        />
      ))}
    </div>
  );
}

function HierarchyNode({ node, selectedId, selectedIds, onSelect, onContextMenuId, depth = 0, renamingId, renameDraft, onRenameDraft, onCommitRename, onCancelRename, dragId, dropHint, onDragStartId, onDragOverId, onDropId }: {
  node: UiNode;
  selectedId: string | undefined;
  selectedIds: string[];
  onSelect: (id: string, additive?: boolean) => void;
  onContextMenuId: (id: string, x: number, y: number) => void;
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
  useEffect(() => {
    if (selectedId && kids.length > 0 && findUiNode(node, selectedId)) setExpanded(true);
  }, [kids.length, node, selectedId]);
  return (
    <>
      <div
        data-hierarchy-node-id={node.id}
        className={`tree-row ${selectedIds.includes(node.id) ? "active" : ""} ${selectedId === node.id ? "primary" : ""} ${dropClass} ${dragId === node.id ? "dragging" : ""} ${node.props.visible === false ? "is-hidden" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable={renamingId !== node.id}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", node.id);
          onDragStartId(node.id);
        }}
        onDragOver={(event) => onDragOverId(node.id, event)}
        onDrop={(event) => onDropId(node.id, event)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onSelect(node.id);
          onContextMenuId(node.id, event.clientX, event.clientY);
        }}
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
            onClick={(event) => onSelect(node.id, event.shiftKey)}
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
          selectedIds={selectedIds}
          onSelect={onSelect}
          onContextMenuId={onContextMenuId}
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

function InspectorField({ label, property, value, onCommit, live = false }: {
  label: string;
  property: string;
  value: UiValue | undefined;
  onCommit: (property: string, value: UiValue) => void;
  live?: boolean;
}) {
  const display = Array.isArray(value) ? value.join(", ") : value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  const [draft, setDraft] = useState(display);
  const focusedRef = useRef(false);
  const liveTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!focusedRef.current) setDraft(display);
  }, [display]);
  useEffect(() => () => {
    if (liveTimerRef.current) window.clearTimeout(liveTimerRef.current);
  }, []);
  const parsedValue = (raw: string): UiValue => {
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    if (raw.includes(",") && raw.split(",").every((part) => /^\s*\d+\s*$/.test(part))) return raw.split(",").map(Number);
    return raw;
  };
  const commit = () => {
    if (liveTimerRef.current) window.clearTimeout(liveTimerRef.current);
    if (draft === display) return;
    onCommit(property, parsedValue(draft));
  };
  return (
    <label className="property-row">
      <span>{label}</span>
      <input
        value={draft}
        onFocus={() => { focusedRef.current = true; }}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          if (live) {
            if (liveTimerRef.current) window.clearTimeout(liveTimerRef.current);
            liveTimerRef.current = window.setTimeout(() => onCommit(property, parsedValue(next)), 120);
          }
        }}
        onBlur={() => {
          focusedRef.current = false;
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(display);
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function InspectorColorField({ label, property, value, onCommit }: {
  label: string;
  property: string;
  value: UiValue | undefined;
  onCommit: (property: string, value: UiValue) => void;
}) {
  const parsed = useMemo(() => rgbaFromValue(value), [value]);
  const [draft, setDraft] = useState<RgbaColor>(parsed);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setDraft(parsed), [parsed[0], parsed[1], parsed[2], parsed[3]]);
  const update = (next: RgbaColor) => {
    setDraft(next);
    onCommit(property, next);
  };
  const updateChannel = (index: number, raw: string) => {
    const next = [...draft] as RgbaColor;
    next[index] = Math.max(0, Math.min(255, Math.round(Number(raw) || 0)));
    update(next);
  };
  return (
    <div className={`property-color ${expanded ? "expanded" : ""}`}>
      <span className="property-color-label">{label}</span>
      <button
        type="button"
        className="property-color-summary"
        aria-expanded={expanded}
        aria-label={`${label} ${rgbaToHex(draft, true)}，点击${expanded ? "收起" : "展开"}颜色编辑器`}
        onClick={() => setExpanded((open) => !open)}
      >
        <i className="property-color-swatch" style={{ "--swatch": rgbaCss(draft) } as CSSProperties} />
        <code>{rgbaToHex(draft, true)}</code>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {expanded && (
        <div className="property-color-editor">
          <label className="property-color-native">
            <span><Pipette size={13} aria-hidden="true" />颜色</span>
            <input
              type="color"
              value={rgbaToHex(draft)}
              aria-label={`${label}系统颜色选择器`}
              onChange={(event) => update(rgbaFromHex(event.target.value, draft))}
            />
          </label>
          {(["R", "G", "B", "A"] as const).map((channel, index) => (
            <label key={channel} className="property-color-channel">
              <span>{channel}</span>
              <input type="range" min="0" max="255" value={draft[index]} aria-label={`${label} ${channel}`} onChange={(event) => updateChannel(index, event.target.value)} />
              <input type="number" min="0" max="255" value={draft[index]} aria-label={`${label} ${channel} 数值`} onChange={(event) => updateChannel(index, event.target.value)} />
            </label>
          ))}
          <label className="property-color-hex">
            <span>Hexadecimal</span>
            <input
              key={rgbaToHex(draft, true)}
              defaultValue={rgbaToHex(draft, true)}
              aria-label={`${label}十六进制 RGBA`}
              onBlur={(event) => update(rgbaFromHex(event.target.value, draft))}
              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function InspectorAssetField({ value, assets, onCommit, onAssetsChanged, toast }: {
  value: UiValue | undefined;
  assets: AssetEntry[];
  onCommit: (property: string, value: UiValue) => void;
  onAssetsChanged?: () => void;
  toast?: (message: string, kind?: "info" | "success" | "error" | "warn") => void;
}) {
  const current = typeof value === "string" ? value : "";
  const options = assets
    .filter((asset) => asset.kind === "image")
    .map((asset) => ({ label: asset.name, value: asset.path.replace(/^assets\//i, "") }));
  const isWindows = typeof navigator !== "undefined" && /Win/i.test(navigator.userAgent || navigator.platform || "");
  const handleAdopt = async () => {
    const raw = window.prompt("粘贴 Windows 绝对路径（可带或不带 @image: 前缀）", "");
    if (!raw) return;
    const candidate = raw.trim();
    if (!candidate) return;
    try {
      const probeUrl = `${API}/api/project/asset?path=${encodeURIComponent("@image:" + candidate)}`;
      const probe = await fetch(probeUrl);
      const adoptedHeader = probe.headers.get("x-adopted-path");
      // eslint-disable-next-line no-console
      console.log("[adopt asset]", { url: probeUrl, status: probe.status, ok: probe.ok, adoptedHeader });
      if (!probe.ok) {
        const text = await probe.text().catch(() => "");
        toast?.(`采纳失败：${probe.status} ${text.slice(0, 200)}`, "error");
        return;
      }
      if (!adoptedHeader) {
        toast?.("bridge 未返回 x-adopted-path，请重启 npm run dev", "warn");
      }
      const adoptedRelative = adoptedHeader
        ? adoptedHeader.replace(/^assets\//i, "")
        : `_external/${candidate.split(/[\\/]/).filter(Boolean).pop() || candidate}`;
      onAssetsChanged?.();
      onCommit("backgroundImage", adoptedRelative);
      toast?.(`已采纳外部图片：${adoptedRelative}`, "success");
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[adopt asset] error", error);
      toast?.(`采纳失败：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  };
  return (
    <label className="property-row">
      <span>图片资源</span>
      <select value={current} onChange={(event) => onCommit("backgroundImage", event.target.value)}>
        <option value="">无图片</option>
        {current && !options.some((option) => option.value === current) && <option value={current}>{current}</option>}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label} · {option.value}</option>)}
      </select>
      {isWindows && onAssetsChanged && (
        <button type="button" className="property-asset-adopt" onClick={handleAdopt}>采纳 Windows 路径</button>
      )}
    </label>
  );
}

function keepValidSelection(current: UiSnapshot | undefined, incoming: UiSnapshot, preferredId?: string): UiSnapshot {
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

function PermissionGuide({ state, busy, confirmed, onAction, onClose }: {
  state: DesktopPermissionState;
  busy: string;
  confirmed: boolean;
  onAction: (permission: "screen" | "accessibility" | "restart" | "refresh" | "confirm") => void;
  onClose: () => void;
}) {
  const permissionRows = [
    { key: "screen" as const, title: "屏幕与系统音频录制", description: "用于把 Maker Runtime 的真实窗口并排显示在工作台中。", value: state.screen },
    { key: "accessibility" as const, title: "辅助功能", description: "用于把你在 Runtime 镜像上的点击准确转发到真实游戏窗口。", value: state.accessibility }
  ];
  return (
    <div className="permission-backdrop" role="presentation">
      <section className="permission-guide" role="dialog" aria-modal="true" aria-labelledby="permission-guide-title">
        <div className="permission-guide-head">
          <div><span className="permission-step">新机器设置 · 1/1</span><h2 id="permission-guide-title">授权 TapMakerWork 完成实时编辑</h2><p>这些权限只用于本机 Runtime 预览和交互，不会自动读取其他窗口内容。</p></div>
          <ShieldAlert size={28} aria-hidden="true" />
        </div>
        {!state.stableIdentity && <div className="permission-warning"><strong>当前为开发模式</strong><span>可以调试权限，但 macOS 会把授权记在 Electron 上。正式签名安装包会使用固定的 TapMakerWork 身份，授权更稳定。</span></div>}
        <div className="permission-list">
          {permissionRows.map((item) => {
            const granted = item.value === "granted";
            return <article key={item.key} className={granted ? "granted" : "needed"}>
              <span className="permission-status-icon">{granted ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}</span>
              <div><strong>{item.title}</strong><p>{item.description}</p><small>{granted ? "已授权" : item.value === "not-determined" ? "尚未询问" : "需要在系统设置中开启"}</small></div>
              <button disabled={granted || Boolean(busy)} onClick={() => onAction(item.key)}>{busy === item.key ? "正在打开…" : granted ? "已完成" : "去授权"}</button>
            </article>;
          })}
        </div>
        <div className="permission-guide-actions">
          <button className="secondary" onClick={onClose}>稍后设置</button>
          <button className="secondary" disabled={Boolean(busy)} onClick={() => onAction("refresh")}><RefreshCw size={14} />重新检测</button>
          <button className={confirmed ? "secondary confirmed" : "secondary"} disabled={Boolean(busy)} onClick={() => onAction("confirm")}><CheckCircle2 size={14} />{confirmed ? "已确认授权" : "我已授权"}</button>
          <button className="primary" disabled={(!state.ready && !confirmed) || Boolean(busy)} onClick={() => onAction("restart")}>重启应用并继续</button>
        </div>
      </section>
    </div>
  );
}

function UpdatePromptDialog({
  state,
  busy,
  onUpdate,
  onSnooze,
  onMute,
  onClose
}: {
  state: DesktopUpdateState;
  busy: string;
  onUpdate: () => void;
  onSnooze: () => void;
  onMute: () => void;
  onClose: () => void;
}) {
  return <div className="legal-backdrop update-prompt-backdrop" role="presentation">
    <section className="sponsor-dialog update-prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="update-prompt-title">
      <header>
        <div>
          <span>应用更新</span>
          <h2 id="update-prompt-title">{state.title || `发现新版本 ${state.availableVersion || ""}`}</h2>
          <p>当前 {state.currentVersion} → 可更新 {state.availableVersion}。立即更新将打开对应平台安装包下载页。</p>
        </div>
        <button className="icon-command" aria-label="关闭更新提示" onClick={onClose}><XCircle size={18} /></button>
      </header>
      <div className="update-prompt-body">
        {(state.notes && state.notes.length > 0) ? (
          <ul className="update-notes">
            {state.notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        ) : (
          <p className="desktop-card-note">请下载并安装新版本后重启 TapMakerWork。</p>
        )}
        {state.message && <p className="desktop-card-note" role="status">{state.message}</p>}
      </div>
      <footer>
        <button disabled={Boolean(busy) || Boolean(state.force)} onClick={onMute}>不再提醒</button>
        <button disabled={Boolean(busy) || Boolean(state.force)} onClick={onSnooze}>暂不更新</button>
        <button className="primary" disabled={Boolean(busy)} onClick={onUpdate}>
          <Download size={13} />立即更新
        </button>
      </footer>
    </section>
  </div>;
}

function LegalConsentDialog({ state, busy, onAccept, onDecline, onClose }: {
  state: DesktopLegalState | undefined;
  busy: "accept" | "decline" | "";
  onAccept: () => void;
  onDecline: () => void;
  onClose: () => void;
}) {
  const accepted = Boolean(state?.accepted);
  return <div className="legal-backdrop" role="presentation">
    <section className="legal-dialog" role="dialog" aria-modal="true" aria-labelledby="legal-dialog-title">
      <header>
        <div><span>首次启动 · EULA 与隐私政策</span><h2 id="legal-dialog-title">使用 TapMakerWork 前请阅读并确认</h2></div>
        {accepted && <button className="icon-command" aria-label="关闭协议" onClick={onClose}><XCircle size={18} /></button>}
      </header>
      <div className="legal-document" tabIndex={0}>
        <section><h3>最终用户许可协议</h3><p>TapMakerWork 是面向 TapTap Maker 项目可视化编辑与研究验证的本地开发工具。激活、继续使用或点击“同意并激活”即表示你同意本协议与下方隐私政策。</p><p>本项目出于研究与开发辅助目的，不以盗取用户数据、篡改或破坏 TapTap Maker、项目文件及其完整性为目的。工具只会在你主动打开的项目范围内执行编辑、预览、Git 与构建操作。</p></section>
        <section><h3>屏幕录制与辅助功能权限</h3><p><strong>屏幕录制</strong>仅用于捕获本机 TapTap Maker Runtime 游戏窗口，并将真实运行画面显示在 IDE 中。TapMakerWork 不会自行录制整块屏幕，也不会自行上传捕获的画面。</p><p><strong>辅助功能</strong>仅用于把你在 Runtime 镜像上的点击坐标转发到真实游戏窗口。没有你的交互，不会自动控制其他应用。</p></section>
        <section><h3>本地数据与网络</h3><p>应用会在本机保存设置、最近项目路径、协议接受状态、预览配置与必要日志。项目修改只发生在你选择的目录中。只有当你主动使用 Maker 构建、二维码、更新检查、Git 推送或外部链接时，才会连接对应服务；这些服务适用其各自条款。</p></section>
        <section><h3>风险与责任</h3><p>请在编辑和 Git 操作前保留备份。研究工具按现状提供，不承诺适用于所有项目或硬件环境；应用不会在未经确认的情况下执行强制推送、硬重置或删除整个项目。</p></section>
      </div>
      {!state && <p className="legal-loading" role="status">正在读取协议状态…</p>}
      <footer>
        {accepted ? <button className="primary" onClick={onClose}>我已了解</button> : <>
          <button className="secondary danger" disabled={Boolean(busy) || !state} onClick={onDecline}>{busy === "decline" ? "正在关闭…" : "不同意并退出"}</button>
          <button className="primary" autoFocus disabled={Boolean(busy) || !state} onClick={onAccept}>{busy === "accept" ? "正在激活…" : "同意并激活"}</button>
        </>}
      </footer>
    </section>
  </div>;
}

function RuntimeErrorDialog({ report, copying, onCopy, onOpenLogs, onDismiss }: {
  report: RuntimeErrorReport;
  copying: boolean;
  onCopy: () => void;
  onOpenLogs: () => void;
  onDismiss: () => void;
}) {
  return <div className="runtime-error-backdrop" role="presentation">
    <section className="runtime-error-dialog" role="alertdialog" aria-modal="true" aria-labelledby="runtime-error-title" aria-describedby="runtime-error-description">
      <header><span><AlertTriangle size={20} /></span><div><h2 id="runtime-error-title">TapTap Maker 运行时错误</h2><p id="runtime-error-description">请修复游戏中的以下错误。请定位根因并修改代码，完成后验证游戏不再报错。</p></div></header>
      <pre>{report.errorText}</pre>
      <footer><button onClick={onOpenLogs}>查看 Runtime 日志</button><button onClick={onDismiss}>暂时忽略</button><button className="primary" autoFocus disabled={copying} onClick={onCopy}><Copy size={14} />{copying ? "正在复制…" : "复制错误报告"}</button></footer>
    </section>
  </div>;
}

function ProjectRejectDialog({ path, message, onClose }: { path: string; message: string; onClose: () => void }) {
  return <div className="project-reject-backdrop" role="presentation">
    <section className="project-reject-dialog" role="alertdialog" aria-modal="true" aria-labelledby="project-reject-title">
      <span className="project-reject-icon"><FolderOpen size={24} /></span>
      <div><h2 id="project-reject-title">无法打开此文件夹</h2><p>{message}</p><code title={path}>{path}</code></div>
      <button className="primary" autoFocus onClick={onClose}>重新选择</button>
    </section>
  </div>;
}

const ROADMAP_SECTIONS: Array<{ title: string; icon: ReactNode; items: string[] }> = [
  {
    title: "资源与构建优化",
    icon: <Package size={15} aria-hidden="true" />,
    items: [
      "无用资源清理：基于引用审计列清单，可撤销",
      "代码混淆选项：与官方构建链兼容，可开关",
      "构建包体报告：资源占比与压缩收益"
    ]
  },
  {
    title: "合规与发布辅助",
    icon: <ScrollText size={15} aria-hidden="true" />,
    items: [
      "自行申请软著教程（材料清单、截图规范、代码鉴别材料整理）"
    ]
  },
  {
    title: "开发经验与 AI 提效",
    icon: <Sparkles size={15} aria-hidden="true" />,
    items: [
      "IDE 内实践指南：常见坑、排错路径、交付检查清单（标题栏「开发技巧」已提供部分）",
      "AI 开发技巧库扩展：更多可导入 Skills / 工程模板",
      "指南暴露为项目 MCP resource，便于 Agent 检索"
    ]
  },
  {
    title: "多平台打包",
    icon: <Map size={15} aria-hidden="true" />,
    items: [
      "H5 / Web 导出工作流（预览与分享）",
      "Android APK 打包向导（签名、包名、渠道参数）",
      "iOS 产物导出引导与上架前检查清单",
      "macOS / Windows 桌面游戏包入口",
      "抖音小游戏、微信小游戏等目标预设与适配检查",
      "多平台工程预设切换与打包产物归档"
    ]
  },
  {
    title: "游戏工程能力参考",
    icon: <ShieldCheck size={15} aria-hidden="true" />,
    items: [
      "UI 安全区域：异形屏可视化与布局检查",
      "反作弊参考：客户端检测思路与服务端校验配合",
      "强更新范式：强制升级、维护公告、灰度/分渠道",
      "游戏数据存档回退：云存档与版本兼容策略",
      "排行榜标杆实现与防刷参考",
      "广告接入标杆项目源码模板（供 AI/人工对照）"
    ]
  }
];

function RoadmapDialog({ onClose, onOpenSite, onJoinGroup }: { onClose: () => void; onOpenSite: () => void; onJoinGroup: () => void }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
  return <div className="sponsor-backdrop roadmap-backdrop" role="presentation">
    <section className="sponsor-dialog roadmap-dialog" role="dialog" aria-modal="true" aria-labelledby="roadmap-dialog-title">
      <header>
        <div>
          <span>规划中 · 尚未全部实现</span>
          <h2 id="roadmap-dialog-title">TapMakerWork 后续开发规划</h2>
          <p>下列能力会按迭代推进；具体上线时间以发行说明为准。欢迎在交流群提出优先级建议。部分导出/上架仍依赖 TapTap 官方与各平台规则。</p>
        </div>
        <button className="icon-command" aria-label="关闭后续规划" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="roadmap-body">
        {ROADMAP_SECTIONS.map((section) => (
          <section key={section.title} className="roadmap-section">
            <h3>{section.icon}{section.title}</h3>
            <ul>
              {section.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
        ))}
      </div>
      <footer>
        <button onClick={onJoinGroup}><Users size={15} />加入交流群</button>
        <button onClick={onOpenSite}><ExternalLink size={15} />官网</button>
        <button className="primary" autoFocus onClick={onClose}>知道了</button>
      </footer>
    </section>
  </div>;
}

function SponsorDialog({ onClose, onOpenWorks }: { onClose: () => void; onOpenWorks: () => void }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
  return <div className="sponsor-backdrop" role="presentation">
    <section className="sponsor-dialog" role="dialog" aria-modal="true" aria-labelledby="sponsor-dialog-title">
      <header>
        <div><span>自愿支持 · 不影响任何功能</span><h2 id="sponsor-dialog-title">赞赏 TapMakerWork 作者</h2><p>感谢支持研究与持续维护。赞赏完全自愿，与软件功能及开源授权无关。</p></div>
        <button className="icon-command" aria-label="关闭赞赏窗口" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="sponsor-codes">
        <figure><div><img src={wechatPayImage} alt="作者微信赞赏收款码" /></div><figcaption>微信赞赏</figcaption></figure>
        <figure><div><img src={alipayImage} alt="作者支付宝赞赏收款码" /></div><figcaption>支付宝赞赏</figcaption></figure>
      </div>
      <footer><button onClick={onOpenWorks}><Gamepad2 size={15} />作者游戏品鉴</button><button className="primary" autoFocus onClick={onClose}>完成</button></footer>
    </section>
  </div>;
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
  const [openProjects, setOpenProjects] = useState<RecentProject[]>(loadOpenProjects);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [screens, setScreens] = useState<UiScreenSummary[]>([]);
  const [screensBusy, setScreensBusy] = useState(false);
  const [activeUiPath, setActiveUiPath] = useState("scripts/ui/HomePage.lua");
  const [selectedFile, setSelectedFile] = useState("scripts/ui/HomePage.lua");
  const [snapshot, setSnapshot] = useState<UiSnapshot>();
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [snapshotSource, setSnapshotSource] = useState<"conversion" | "sidecar" | "runtime" | "empty" | undefined>();
  const [mode, setMode] = useState<WorkspaceMode>("inspect");
  const [device, setDevice] = useState<DeviceProfile>(DEFAULT_DEVICE_PROFILES[0]!);
  const [fps, setFps] = useState(60);
  const [activeTerminal, setActiveTerminal] = useState<LogChannel>("runtime");
  const [logs, setLogs] = useState(initialLogs);
  const [leftTab, setLeftTab] = useState<"files" | "screens" | "hierarchy" | "assets" | "git">("screens");
  const [centerTab, setCenterTab] = useState<CenterTab>("workflow");
  const [documentTabs, setDocumentTabs] = useState<DocumentTab[]>(loadDocumentTabs);
  const [draggedDocumentTab, setDraggedDocumentTab] = useState<DocumentTab | null>(null);
  const [floatingWorkspace, setFloatingWorkspace] = useState<FloatingWorkspace | null>(null);
  const [previewDockOpen, setPreviewDockOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [previewPanel, setPreviewPanel] = useState<PreviewPanelState>();
  const [inspectorTab, setInspectorTab] = useState<"properties" | "events" | "animation">("properties");
  const [code, setCode] = useState("-- 正在读取 scripts/ui/HomePage.lua…");
  const [codeDirty, setCodeDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [adapterInstallBusy, setAdapterInstallBusy] = useState(false);
  const [runtimeEditRevision, setRuntimeEditRevision] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [compressOpen, setCompressOpen] = useState(false);
  const [toolkitMenuOpen, setToolkitMenuOpen] = useState(false);
  const [newbieGuideOpen, setNewbieGuideOpen] = useState(false);
  const [coachLiveEdit, setCoachLiveEdit] = useState(() => readCoachMark(COACH_LIVE_EDIT_KEY));
  const [coachRuntimeStart, setCoachRuntimeStart] = useState(() => readCoachMark(COACH_RUNTIME_START_KEY));
  const [community, setCommunity] = useState<CommunityInfo>({
    qqGroupId: BUILTIN_QQ_GROUP_ID,
    qqGroupName: BUILTIN_QQ_GROUP_NAME,
    qqGroupJoinUrl: BUILTIN_QQ_GROUP_JOIN_URL,
    officialSiteUrl: OFFICIAL_SITE_URL,
    source: "builtin"
  });
  const QQ_GROUP_ID = community.qqGroupId;
  const QQ_GROUP_NAME = community.qqGroupName;
  const QQ_GROUP_JOIN_URL = community.qqGroupJoinUrl;
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [assets, setAssets] = useState<AssetEntry[]>([]);
  const [gitStatus, setGitStatus] = useState<GitStatusState>();
  const [gitBusy, setGitBusy] = useState<"pull" | "commit" | "push-build" | "">("");
  const [gitCommitMessage, setGitCommitMessage] = useState("chore: update Maker project");
  const [gitConflictPlan, setGitConflictPlan] = useState("");
  const [gitFileMenu, setGitFileMenu] = useState<{ change: GitChangeState; scope: "staged" | "unstaged"; x: number; y: number } | null>(null);
  const [gitGroupMenu, setGitGroupMenu] = useState<{ scope: "staged" | "unstaged"; x: number; y: number } | null>(null);
  const [gitDiff, setGitDiff] = useState<GitFileDiffState | null>(null);
  const [systemInfo, setSystemInfo] = useState<Record<string, unknown>>();
  const [adapterExport, setAdapterExport] = useState<string>("");
  const [revealLine, setRevealLine] = useState<number | null>(null);
  const [sidecarInfo, setSidecarInfo] = useState<{
    path: string;
    exists: boolean;
    savedAt?: string | undefined;
    dirty?: boolean | undefined;
    saveMode?: "static-tree" | "template-overrides" | undefined;
    overrideCount?: number | undefined;
    skippedInstances?: number | undefined;
  }>({ path: "", exists: false });
  const [sidecarEditRevision, setSidecarEditRevision] = useState(0);
  const [makerMeta, setMakerMeta] = useState<MakerProjectMeta>({});
  const [makerPreviewStatus, setMakerPreviewStatus] = useState<MakerPreviewStatus>();
  const [makerBusy, setMakerBusy] = useState<"" | "build" | "qrcode" | "doctor">("");
  const [makerVersions, setMakerVersions] = useState<MakerVersionState>();
  const [nodeVersions, setNodeVersions] = useState<NodeVersionState>();
  const [makerVersionBusy, setMakerVersionBusy] = useState<"" | "check" | "switch" | "stable" | "beta" | "node">("");
  const [desktopPermissions, setDesktopPermissions] = useState<DesktopPermissionState>();
  const [permissionGuideOpen, setPermissionGuideOpen] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState("");
  const [permissionConfirmed, setPermissionConfirmed] = useState(false);
  const [desktopUpdate, setDesktopUpdate] = useState<DesktopUpdateState>();
  const [desktopUpdateBusy, setDesktopUpdateBusy] = useState("");
  const [updatePromptOpen, setUpdatePromptOpen] = useState(false);
  const [desktopHardware, setDesktopHardware] = useState<DesktopHardwareAccelerationState>();
  const [hardwareBusy, setHardwareBusy] = useState(false);
  const [desktopLegal, setDesktopLegal] = useState<DesktopLegalState>();
  const [desktopTelemetry, setDesktopTelemetry] = useState<DesktopTelemetryState>();
  const [telemetryBusy, setTelemetryBusy] = useState(false);
  const [legalDialogOpen, setLegalDialogOpen] = useState(Boolean(window.tapMakerWork?.legal));
  const [legalBusy, setLegalBusy] = useState<"accept" | "decline" | "">("");
  const [workflow, setWorkflow] = useState<ProjectWorkflowOverview>();
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowBusyAction, setWorkflowBusyAction] = useState<ProjectWorkflowAction>();
  const [qrOpen, setQrOpen] = useState(false);
  const [qrImageFailed, setQrImageFailed] = useState(false);
  const [projectReject, setProjectReject] = useState<{ path: string; message: string }>();
  const [runtimeErrorReport, setRuntimeErrorReport] = useState<RuntimeErrorReport>();
  const [sponsorOpen, setSponsorOpen] = useState(false);
  const [roadmapOpen, setRoadmapOpen] = useState(false);
  const [qrMenuOpen, setQrMenuOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [copyBusy, setCopyBusy] = useState(false);
  const [newNodeType, setNewNodeType] = useState<UiNodeType>("Panel");
  const [hierDragId, setHierDragId] = useState<string | null>(null);
  const [hierDrop, setHierDrop] = useState<{ id: string; pos: "before" | "after" | "inside" } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [nodeContextMenu, setNodeContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const toast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = Date.now() + Math.random();
    setToasts((list) => list.some((item) => item.kind === kind && item.message === message)
      ? list
      : [...list, { id, kind, message }]);
    window.setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), 2800);
  }, []);
  const markSidecarDirty = useCallback(() => {
    setSidecarInfo((current) => ({ ...current, dirty: true }));
    setSidecarEditRevision((revision) => revision + 1);
  }, []);

  const trackTelemetry = useCallback((name: string, props?: Record<string, unknown>) => {
    trackStudioGameAlgo(name, props);
  }, []);
  const qrCloseTimer = useRef<number | null>(null);
  const copyInFlightRef = useRef(false);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const modeRef = useRef<WorkspaceMode>(mode);
  const centerTabRef = useRef<CenterTab>(centerTab);
  const selectedNodeIdRef = useRef<string | undefined>(undefined);
  const snapshotRef = useRef<UiSnapshot | undefined>(undefined);
  const runtimeEditSyncTimerRef = useRef<number | null>(null);
  const dismissedRuntimeErrorsRef = useRef(new Set<string>());
  const hierarchyTreeRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageScale, setStageScale] = useState(1);
  const [canvasAutoFit, setCanvasAutoFit] = useState(true);
  const [canvasTool, setCanvasTool] = useState<TransformTool>("move");
  const [canvasSnapEnabled, setCanvasSnapEnabled] = useState(false);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const documentTabsRef = useRef<HTMLElement | null>(null);
  const floatingWorkspaceDragRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const floatingWorkspaceResizeRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null);
  const [layout, setLayout] = useState<WorkspaceLayout>(() => loadWorkspaceLayout());
  const layoutDragRef = useRef<{ key: keyof WorkspaceLayout; base: number; originX: number; originY: number } | null>(null);
  const rootLayout = snapshot ? runtimeLayoutBox(snapshot.root.props) : {};
  const previewWidth = snapshot?.viewport?.width && snapshot.viewport.width > 0
    ? snapshot.viewport.width
    : typeof snapshot?.root.props.$previewDesignWidth === "number"
      ? snapshot.root.props.$previewDesignWidth
      : rootLayout.w && rootLayout.w > 0 ? rootLayout.w : device.width;
  const previewHeight = snapshot?.viewport?.height && snapshot.viewport.height > 0
    ? snapshot.viewport.height
    : rootLayout.h && rootLayout.h > 0
      ? rootLayout.h
      : device.height / device.width * previewWidth;

  const applyBestCanvasScale = useCallback(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport || previewWidth <= 0 || previewHeight <= 0) return;
    const availableWidth = Math.max(120, viewport.clientWidth - 56);
    const availableHeight = Math.max(120, viewport.clientHeight - 56);
    setStageScale(Math.min(4, Math.max(0.1, Math.min(availableWidth / previewWidth, availableHeight / previewHeight))));
    setCanvasAutoFit(true);
  }, [previewHeight, previewWidth]);

  const reorderDocumentTab = useCallback((target: DocumentTab) => {
    if (!draggedDocumentTab || draggedDocumentTab === target) return;
    setDocumentTabs((current) => {
      const next = current.filter((item) => item !== draggedDocumentTab);
      next.splice(Math.max(0, current.indexOf(target)), 0, draggedDocumentTab);
      try { localStorage.setItem(DOCUMENT_TABS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [draggedDocumentTab]);

  const moveDocumentTab = useCallback((tab: DocumentTab, direction: -1 | 1) => {
    setDocumentTabs((current) => {
      const index = current.indexOf(tab);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      try { localStorage.setItem(DOCUMENT_TABS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const finishDocumentTabDrag = useCallback((event: React.DragEvent) => {
    const tabsBounds = documentTabsRef.current?.getBoundingClientRect();
    const outsideTabStrip = tabsBounds && (
      event.clientY < tabsBounds.top - 14 || event.clientY > tabsBounds.bottom + 40
      || event.clientX < tabsBounds.left - 24 || event.clientX > tabsBounds.right + 24
    );
    if (!floatingWorkspace && outsideTabStrip && event.clientX > 0 && event.clientY > 0) {
      const width = Math.min(920, Math.max(560, window.innerWidth * .58));
      const height = Math.min(720, Math.max(420, window.innerHeight * .62));
      setFloatingWorkspace({
        x: clamp(event.clientX - width / 2, 8, Math.max(8, window.innerWidth - width - 8)),
        y: clamp(event.clientY - 20, 8, Math.max(8, window.innerHeight - height - 8)),
        width,
        height
      });
      toast("工作区已脱离停靠；拖动标题空白处可移动，右下角可缩放", "success");
    }
    setDraggedDocumentTab(null);
  }, [floatingWorkspace, toast]);

  const beginFloatingWorkspaceMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!floatingWorkspace || (event.target as HTMLElement).closest("button, input, select")) return;
    event.preventDefault();
    floatingWorkspaceDragRef.current = { startX: event.clientX, startY: event.clientY, x: floatingWorkspace.x, y: floatingWorkspace.y };
    const onMove = (moveEvent: PointerEvent) => {
      const drag = floatingWorkspaceDragRef.current;
      if (!drag) return;
      setFloatingWorkspace((current) => current ? {
        ...current,
        x: clamp(drag.x + moveEvent.clientX - drag.startX, 8, Math.max(8, window.innerWidth - current.width - 8)),
        y: clamp(drag.y + moveEvent.clientY - drag.startY, 8, Math.max(8, window.innerHeight - current.height - 8))
      } : current);
    };
    const onUp = (upEvent: PointerEvent) => {
      floatingWorkspaceDragRef.current = null;
      document.body.classList.remove("moving-workspace");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const dockLeft = layout.left + 5;
      const dockRight = window.innerWidth - layout.right - 5;
      if (upEvent.clientX >= dockLeft && upEvent.clientX <= dockRight && upEvent.clientY >= 82 && upEvent.clientY <= 150) {
        setFloatingWorkspace(null);
        toast("工作区已重新停靠", "success");
      }
    };
    document.body.classList.add("moving-workspace");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [floatingWorkspace, layout.left, layout.right, toast]);

  const beginFloatingWorkspaceResize = useCallback((event: React.PointerEvent) => {
    if (!floatingWorkspace) return;
    event.preventDefault();
    event.stopPropagation();
    floatingWorkspaceResizeRef.current = { startX: event.clientX, startY: event.clientY, width: floatingWorkspace.width, height: floatingWorkspace.height };
    const onMove = (moveEvent: PointerEvent) => {
      const drag = floatingWorkspaceResizeRef.current;
      if (!drag) return;
      setFloatingWorkspace((current) => current ? {
        ...current,
        width: clamp(drag.width + moveEvent.clientX - drag.startX, 480, Math.max(480, window.innerWidth - current.x - 8)),
        height: clamp(drag.height + moveEvent.clientY - drag.startY, 340, Math.max(340, window.innerHeight - current.y - 8))
      } : current);
    };
    const onUp = () => {
      floatingWorkspaceResizeRef.current = null;
      document.body.classList.remove("resizing-workspace");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    document.body.classList.add("resizing-workspace");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [floatingWorkspace]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    let active = true;
    void fetch(`${API}/api/community`)
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json() as { community?: CommunityInfo };
        if (!active || !data.community?.qqGroupId) return;
        setCommunity({
          qqGroupId: data.community.qqGroupId,
          qqGroupName: data.community.qqGroupName || BUILTIN_QQ_GROUP_NAME,
          qqGroupJoinUrl: data.community.qqGroupJoinUrl || BUILTIN_QQ_GROUP_JOIN_URL,
          officialSiteUrl: data.community.officialSiteUrl || OFFICIAL_SITE_URL,
          source: data.community.source || "builtin"
        });
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const permissionsApi = window.tapMakerWork?.permissions;
    const updatesApi = window.tapMakerWork?.updates;
    const hardwareApi = window.tapMakerWork?.hardwareAcceleration;
    const legalApi = window.tapMakerWork?.legal;
    const telemetryApi = window.tapMakerWork?.telemetry;
    if (!permissionsApi && !updatesApi && !hardwareApi && !legalApi && !telemetryApi) return;
    let active = true;
    if (permissionsApi) {
      void permissionsApi.get().then((state) => {
        if (!active) return;
        setDesktopPermissions(state);
        if (state.ready) setPermissionConfirmed(true);
        const dismissed = localStorage.getItem("tapmakerwork.permissions.dismissed") === "1";
        if (state.platform === "darwin" && !state.ready && !dismissed) setPermissionGuideOpen(true);
      });
    }
    if (updatesApi) {
      void updatesApi.get().then((state) => {
        if (!active) return;
        setDesktopUpdate(state);
      });
    }
    if (hardwareApi) {
      void hardwareApi.get().then((state) => {
        if (active) setDesktopHardware(state);
      }).catch(() => undefined);
    }
    if (legalApi) {
      void legalApi.get().then((state) => {
        if (!active) return;
        setDesktopLegal(state);
        setLegalDialogOpen(!state.accepted);
      }).catch((error) => {
        if (active) toast(`无法读取用户协议状态：${error instanceof Error ? error.message : String(error)}`, "error");
      });
    }
    if (telemetryApi) {
      void telemetryApi.get().then(async (state) => {
        if (!active) return;
        setDesktopTelemetry(state);
        await initStudioGameAlgo({
          enabled: state.enabled,
          gameKey: state.gameKey,
          appVersion: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.1.0",
          isDebug: import.meta.env.DEV
        });
      }).catch(() => undefined);
    }
    const removePermissionListener = permissionsApi?.onChanged((state) => {
      setDesktopPermissions(state);
      if (state.ready) {
        setPermissionConfirmed(true);
        localStorage.removeItem("tapmakerwork.permissions.dismissed");
      }
    });
    const removeUpdateListener = updatesApi?.onState((state) => {
      setDesktopUpdate(state);
    });
    const removeUpdatePromptListener = updatesApi?.onPrompt((state) => {
      setDesktopUpdate(state);
      if (state.phase === "available") {
        setUpdatePromptOpen(true);
      } else if (state.phase === "up-to-date") {
        setUpdatePromptOpen(false);
        toast(state.message || "当前已是最新版本", "success");
      } else if (state.phase === "error") {
        toast(state.message || "检查更新失败", "error");
      }
    });
    const removeTrackListener = telemetryApi?.onTrack?.((name, props) => {
      trackStudioGameAlgo(name, props);
    });
    const removeSessionEndListener = telemetryApi?.onSessionEnd?.((payload) => {
      trackStudioGameAlgo("ide.session", payload);
      void flushStudioGameAlgo();
    });
    const telemetryTimer = telemetryApi
      ? window.setInterval(() => {
        void telemetryApi.get().then((state) => {
          if (active) setDesktopTelemetry(state);
        }).catch(() => undefined);
      }, 15_000)
      : undefined;
    return () => {
      active = false;
      if (telemetryTimer) window.clearInterval(telemetryTimer);
      removePermissionListener?.();
      removeUpdateListener?.();
      removeUpdatePromptListener?.();
      removeTrackListener?.();
      removeSessionEndListener?.();
    };
  }, [toast]);

  const runPermissionAction = useCallback(async (action: "screen" | "accessibility" | "restart" | "refresh" | "confirm") => {
    const api = window.tapMakerWork?.permissions;
    if (!api) return;
    setPermissionBusy(action);
    try {
      if (action === "restart") {
        await api.restart();
        return;
      }
      if (action === "confirm") {
        const state = await api.get();
        setDesktopPermissions(state);
        setPermissionConfirmed(true);
        toast(state.ready ? "系统权限已检测为就绪，可以重启应用" : "已记录你的授权确认；现在可以重启应用完成系统状态刷新", "success");
        return;
      }
      const state = action === "refresh" ? await api.get() : await api.request(action);
      setDesktopPermissions(state);
      if (state.ready) {
        setPermissionConfirmed(true);
        toast("系统权限已就绪，可以使用真实 Runtime 预览与交互", "success");
      } else if (action === "refresh") {
        toast("系统尚未返回最新授权状态；若你已在设置中开启，可点击“我已授权”后重启", "warn");
      }
    } catch (error) {
      toast(`权限操作失败：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setPermissionBusy("");
    }
  }, [toast]);

  const closePermissionGuide = useCallback(() => {
    localStorage.setItem("tapmakerwork.permissions.dismissed", "1");
    setPermissionGuideOpen(false);
  }, []);

  const runDesktopUpdateAction = useCallback(async (action: "check" | "download" | "restart" | "snooze" | "mute") => {
    const api = window.tapMakerWork?.updates;
    if (!api) return;
    setDesktopUpdateBusy(action);
    try {
      const state = await api[action]();
      setDesktopUpdate(state);
      if (action === "check") {
        if (state.phase === "available") setUpdatePromptOpen(true);
        else if (state.phase === "up-to-date") toast(state.message || "当前已是最新版本", "success");
        else if (state.phase === "error") toast(state.message || "检查更新失败", "error");
      } else if (action === "download") {
        toast(state.message || "已打开下载页", "success");
      } else if (action === "snooze") {
        setUpdatePromptOpen(false);
        toast(state.message || "已暂不更新", "info");
      } else if (action === "mute") {
        setUpdatePromptOpen(false);
        toast(state.message || "已不再提醒此版本", "info");
      }
    } catch (error) {
      toast(`应用更新失败：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setDesktopUpdateBusy("");
    }
  }, [toast]);

  const setHardwareAcceleration = useCallback(async (enabled: boolean) => {
    const api = window.tapMakerWork?.hardwareAcceleration;
    if (!api) return;
    setHardwareBusy(true);
    try {
      const state = await api.set(enabled);
      setDesktopHardware(state);
      toast(`硬件加速已${enabled ? "开启" : "关闭"}，重启应用后生效`, "success");
    } catch (error) {
      toast(`硬件加速设置失败：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setHardwareBusy(false);
    }
  }, [toast]);

  const acceptLegalTerms = useCallback(async () => {
    const api = window.tapMakerWork?.legal;
    if (!api) { setLegalDialogOpen(false); return; }
    setLegalBusy("accept");
    try {
      const state = await api.accept();
      setDesktopLegal(state);
      setLegalDialogOpen(false);
      trackTelemetry("eula.accept", { version: state.version });
      toast("已接受用户协议与隐私政策", "success");
    } catch (error) {
      toast(`协议状态保存失败：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setLegalBusy("");
    }
  }, [toast, trackTelemetry]);

  const setTelemetryEnabled = useCallback(async (enabled: boolean) => {
    const api = window.tapMakerWork?.telemetry;
    if (!api) return;
    setTelemetryBusy(true);
    try {
      const state = await api.setEnabled(enabled);
      setDesktopTelemetry(state);
      setStudioGameAlgoEnabled(enabled);
      if (enabled) {
        await initStudioGameAlgo({
          enabled: true,
          gameKey: state.gameKey,
          appVersion: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.1.0",
          isDebug: false
        });
      }
      toast(enabled ? "已开启 GameAlgo 匿名使用统计" : "已关闭匿名使用统计", "success");
    } catch (error) {
      toast(`遥测设置失败：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setTelemetryBusy(false);
    }
  }, [toast]);

  const declineLegalTerms = useCallback(async () => {
    setLegalBusy("decline");
    try {
      await window.tapMakerWork?.legal?.decline();
    } catch (error) {
      setLegalBusy("");
      toast(`无法关闭应用：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }, [toast]);

  useEffect(() => {
    if (snapshot?.selectedId) selectedNodeIdRef.current = snapshot.selectedId;
  }, [snapshot?.selectedId]);

  useEffect(() => {
    centerTabRef.current = centerTab;
  }, [centerTab]);

  useEffect(() => setQrImageFailed(false), [makerMeta.qrcodeUrl, makerMeta.qrcodeGeneratedAt]);

  useEffect(() => {
    if (centerTab !== "visual") return;
    const selectTool = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']") || target?.closest(".monaco-editor")) return;
      const tool = toolForShortcut(event.key);
      if (!tool) return;
      event.preventDefault();
      setCanvasTool(tool);
    };
    window.addEventListener("keydown", selectTool);
    return () => window.removeEventListener("keydown", selectTool);
  }, [centerTab]);

  useEffect(() => {
    setSelectedNodeIds((current) => {
      if (!snapshot) return [];
      const valid = current.filter((id) => Boolean(findUiNode(snapshot.root, id)));
      if (valid.length) return valid;
      return snapshot.selectedId && findUiNode(snapshot.root, snapshot.selectedId) ? [snapshot.selectedId] : [];
    });
  }, [snapshot?.revision, snapshot?.root, snapshot?.selectedId]);

  useEffect(() => () => {
    if (runtimeEditSyncTimerRef.current) window.clearTimeout(runtimeEditSyncTimerRef.current);
  }, []);

  useEffect(() => {
    if (!nodeContextMenu) return;
    const close = () => setNodeContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [nodeContextMenu]);

  useEffect(() => {
    if (!gitFileMenu && !gitGroupMenu) return;
    const close = () => {
      setGitFileMenu(null);
      setGitGroupMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [gitFileMenu, gitGroupMenu]);

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
    document.body.classList.add(key === "terminal" ? "resizing-row" : "resizing-col");
    const onMove = (moveEvent: PointerEvent) => {
      const drag = layoutDragRef.current;
      if (!drag) return;
      const dx = moveEvent.clientX - drag.originX;
      const dy = moveEvent.clientY - drag.originY;
      const delta = key === "terminal" ? dy : dx;
      const signed = (invertX || invertY) ? -delta : delta;
      setLayout((current) => {
        const raw = drag.base + signed;
        const next = { ...current, [key]: clamp(raw, key === "terminal" ? 40 : key === "previewDock" ? 220 : key === "right" ? 200 : 160, key === "terminal" ? terminalMaxHeight() : key === "previewDock" ? 520 : key === "right" ? 480 : 420) };
        try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    };
    const onUp = () => {
      layoutDragRef.current = null;
      document.body.classList.remove("resizing-row", "resizing-col");
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
    if (!toolkitMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".toolkit-menu-wrap")) return;
      setToolkitMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [toolkitMenuOpen]);

  useEffect(() => {
    if (!project?.root || !projectLoaded || legalDialogOpen || permissionGuideOpen) return;
    if (readOnboardingSeen()) return;
    setNewbieGuideOpen(true);
  }, [legalDialogOpen, permissionGuideOpen, project?.root, projectLoaded]);

  useEffect(() => {
    if (mode !== "live-edit") return;
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
        sidecar?: { path?: string; exists?: boolean; savedAt?: string; saveMode?: "static-tree" | "template-overrides"; overrideCount?: number };
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
          ...(openResult.sidecar?.saveMode ? { saveMode: openResult.sidecar.saveMode } : {}),
          ...(typeof openResult.sidecar?.overrideCount === "number" ? { overrideCount: openResult.sidecar.overrideCount } : {}),
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

  const rescanUiScreens = useCallback(async () => {
    setScreensBusy(true);
    try {
      const response = await fetch(`${API}/api/ui/screens/rescan`, { method: "POST" });
      const result = await response.json() as { screens?: UiScreenSummary[]; error?: string };
      if (!response.ok) throw new Error(result.error || "重新扫描失败");
      const next = result.screens ?? [];
      setScreens(next);
      toast(`已扫描整个 scripts 目录，发现 ${next.length} 个 UI 入口`, "success");
    } catch (error) {
      toast(`扫描界面失败：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setScreensBusy(false);
    }
  }, [toast]);

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
      sidecar?: { path?: string; exists?: boolean; savedAt?: string; saveMode?: "static-tree" | "template-overrides"; overrideCount?: number };
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
      ...(result.sidecar?.saveMode ? { saveMode: result.sidecar.saveMode } : {}),
      ...(typeof result.sidecar?.overrideCount === "number" ? { overrideCount: result.sidecar.overrideCount } : {}),
      dirty: false
    });
    if (/MainShell|HomePage|LoadingScreen/i.test(screenPath)) {
      const maker = DEFAULT_DEVICE_PROFILES.find((profile) => profile.id === DEFAULT_DEVICE_HINT);
      if (maker) setDevice(maker);
    }
    await readFile(screenPath, false);
    setCenterTab("visual");
  }, [readFile, screens, toast]);

  const selectNode = useCallback((nodeId: string, additive = false) => {
    setSelectedNodeIds((currentIds) => {
      const nextIds = additive
        ? currentIds.includes(nodeId) ? currentIds.filter((id) => id !== nodeId) : [...currentIds, nodeId]
        : [nodeId];
      const primaryId = nextIds.includes(nodeId) ? nodeId : nextIds.at(-1);
      selectedNodeIdRef.current = primaryId;
      setSnapshot((current) => {
        if (!current) return current;
        if (primaryId) return { ...current, selectedId: primaryId };
        const { selectedId: _selectedId, ...withoutSelection } = current;
        return withoutSelection;
      });
      return nextIds;
    });
  }, []);

  const selectCanvasNode = useCallback((nodeId: string, additive = false) => {
    const node = snapshot ? findUiNode(snapshot.root, nodeId) : undefined;
    selectNode(nodeId, additive);
    setLeftTab("hierarchy");
    if (additive) return;
    const sourceFile = node?.source?.file;
    if (!sourceFile) return;
    setActiveUiPath(sourceFile);
    if (node.source?.line) setRevealLine(node.source.line);
    if (sourceFile !== selectedFile) {
      void readFile(sourceFile, false).catch((error) => {
        toast(`打开节点对应 UI 文件失败：${error instanceof Error ? error.message : String(error)}`, "error");
      });
    }
  }, [readFile, selectNode, selectedFile, snapshot, toast]);

  useEffect(() => {
    if (leftTab !== "hierarchy" || !snapshot?.selectedId) return;
    const frame = window.requestAnimationFrame(() => {
      const scroller = hierarchyTreeRef.current;
      if (!scroller) return;
      const row = Array.from(scroller.querySelectorAll<HTMLElement>("[data-hierarchy-node-id]"))
        .find((item) => item.dataset.hierarchyNodeId === snapshot.selectedId);
      if (!row) return;
      const scrollRect = scroller.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      if (rowRect.top < scrollRect.top) scroller.scrollTop -= scrollRect.top - rowRect.top;
      else if (rowRect.bottom > scrollRect.bottom) scroller.scrollTop += rowRect.bottom - scrollRect.bottom;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [leftTab, snapshot?.selectedId]);

  const openNodeContextMenu = useCallback((nodeId: string, x: number, y: number) => {
    const width = 232;
    const height = 390;
    setNodeContextMenu({
      nodeId,
      x: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - height - 8))
    });
  }, []);

  const scheduleRuntimeEditSync = useCallback((delay = 120) => {
    if (snapshotSource !== "runtime" && health?.snapshotSource !== "runtime") return;
    if (runtimeEditSyncTimerRef.current) window.clearTimeout(runtimeEditSyncTimerRef.current);
    runtimeEditSyncTimerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          await fetch(`${API}/api/health`);
          const snapshotResponse = await fetch(`${API}/api/ui/snapshot`);
          if (snapshotResponse.ok) {
            const incoming = await snapshotResponse.json() as UiSnapshot;
            setSnapshot((current) => keepValidSelection(current, incoming, selectedNodeIdRef.current));
          }
          setRuntimeEditRevision((revision) => revision + 1);
        } catch {
          // Keep the last synchronized frame; the periodic capture loop retries.
        }
      })();
    }, delay);
  }, [health?.snapshotSource, snapshotSource]);

  const patchNodeById = async (nodeId: string, props: Record<string, UiValue>, options?: { historyGroup?: string }) => {
    if (!snapshot) return;
    const patch: UiPatch = {
      requestId: crypto.randomUUID(),
      baseRevision: snapshot.revision,
      nodeId,
      props,
      ...(options?.historyGroup ? { historyGroup: options.historyGroup } : {})
    };
    const response = await fetch(`${API}/api/ui/patch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch)
    });
    const result = await response.json() as UiSnapshot | { error: string };
    if (response.ok) {
      const next = { ...(result as UiSnapshot), selectedId: nodeId };
      setSnapshot(next);
      if (mode === "live-edit" || centerTab === "visual") {
        markSidecarDirty();
      }
      scheduleRuntimeEditSync(120);
    } else {
      const message = (result as { error: string }).error;
      setLogs((current) => ({ ...current, agent: [...current.agent, `补丁失败：${message}`] }));
      throw new Error(message);
    }
  };

  const patchNodeProps = async (props: Record<string, UiValue>) => {
    if (!snapshot?.selectedId) return;
    await patchNodeById(snapshot.selectedId, props);
  };

  const patchNode = async (property: string, value: UiValue) => {
    await patchNodeProps({ [property]: value });
  };

  const loadWorkflow = useCallback(async () => {
    setWorkflowLoading(true);
    try {
      const response = await fetch(`${API}/api/workflow/overview`);
      const result = await response.json() as ProjectWorkflowOverview | { error?: string };
      if (!response.ok || !("stages" in result)) throw new Error((result as { error?: string }).error || "项目检查失败");
      setWorkflow(result as ProjectWorkflowOverview);
    } catch (error) {
      setWorkflow(undefined);
      setLogs((current) => ({ ...current, agent: [...current.agent, `交付检查失败：${error instanceof Error ? error.message : String(error)}`] }));
    } finally {
      setWorkflowLoading(false);
    }
  }, []);

  const openProjectPath = useCallback(async (projectPath: string, options?: { skipDirtyCheck?: boolean }) => {
    if (project?.root === projectPath && projectLoaded) return;
    if (!options?.skipDirtyCheck && project?.root !== projectPath && codeDirty && !window.confirm("当前代码文件还有未保存修改。切换项目将丢失这些修改，是否继续？")) return;
    setProjectOpening(true);
    setProjectError("");
    try {
      if (project?.root && project.root !== projectPath) {
        if (makerPreviewStatus?.process_alive) await fetch(`${API}/api/maker/preview/stop`, { method: "POST" }).catch(() => undefined);
        await window.tapMakerWork?.preview?.unmount().catch(() => undefined);
        setPreviewDockOpen(false);
        setSelectedNodeIds([]);
        selectedNodeIdRef.current = undefined;
        setRuntimeErrorReport(undefined);
        dismissedRuntimeErrorsRef.current.clear();
      }
      const response = await fetch(`${API}/api/project/open`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: projectPath })
      });
      const result = await response.json() as ProjectState & {
        error?: string;
        adapter?: { installed?: boolean; changed?: boolean; error?: string };
      };
      if (!response.ok || !result.project) {
        if (result.error === "not_tapmaker_project") {
          setProjectReject({ path: projectPath, message: "所选文件夹不是 TapTap Maker 项目。项目根目录必须包含有效的 .project/project.json。" });
        }
        throw new Error(result.error === "not_tapmaker_project" ? "不是 TapTap Maker 项目" : result.error || "无法打开项目");
      }
      setProject(result.project);
      setOpenProjects((current) => {
        const next = current.some((item) => item.root === result.project!.root)
          ? current
          : [...current, { root: result.project!.root, name: result.project!.name }].slice(-8);
        localStorage.setItem(OPEN_PROJECTS_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
      if (result.snapshot) setSnapshot(result.snapshot);
      await loadProjectContents();
      if (result.adapter?.installed) {
        setHealth((current) => current ? {
          ...current,
          runtimeAdapter: { installed: true, paths: ["scripts/tapmakerwork/TapMakerWorkBridge.lua"] }
        } : current);
      }
      if (result.adapter?.changed) {
        toast("已自动接入实时编辑桥", "success");
        const statusResponse = await fetch(`${API}/api/maker/preview/status`);
        if (statusResponse.ok) {
          const status = await statusResponse.json() as MakerPreviewStatus;
          setMakerPreviewStatus(status);
          if (status.process_alive) {
            await fetch(`${API}/api/maker/preview/stop`, { method: "POST" });
            await fetch(`${API}/api/maker/preview/start`, { method: "POST" });
            toast("Runtime 正在重启，进入游戏后即可点选控件", "info");
          }
        }
      }
      // 这些回调在函数体调用时已初始化；依赖数组不可提前引用（TDZ）
      void loadAssets();
      void loadGitStatus();
      void loadMakerMeta();
      void loadPreviewPanel();
      void loadWorkflow();
      setCenterTab("workflow");
      trackTelemetry("project.open", {});
      setRecentProjects((current) => {
        const next = [{ root: result.project!.root, name: result.project!.name }, ...current.filter((item) => item.root !== result.project!.root)].slice(0, 8);
        localStorage.setItem("tapmakerwork.recentProjects", JSON.stringify(next));
        return next;
      });
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
      trackTelemetry("project.open_fail", {});
    } finally {
      setProjectLoaded(true);
      setProjectOpening(false);
    }
  }, [codeDirty, loadProjectContents, loadWorkflow, makerPreviewStatus?.process_alive, project?.root, projectLoaded, trackTelemetry]);

  const chooseProject = useCallback(async () => {
    if (window.tapMakerWork?.chooseProject) {
      const projectPath = await window.tapMakerWork.chooseProject();
      if (projectPath) await openProjectPath(projectPath);
      return;
    }
    setProjectError("请使用桌面版的“文件 → 打开项目…”选择项目目录。");
  }, [openProjectPath]);

  const closeCurrentProject = useCallback(async () => {
    if (!project) return;
    if (codeDirty && !window.confirm("当前代码文件还有未保存修改。关闭项目将丢失这些修改，是否继续？")) return;
    setProjectOpening(true);
    try {
      if (makerPreviewStatus?.process_alive) {
        await fetch(`${API}/api/maker/preview/stop`, { method: "POST" }).catch(() => undefined);
      }
      const response = await fetch(`${API}/api/project/close`, { method: "POST" });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "关闭项目失败");
      await window.tapMakerWork?.preview?.unmount().catch(() => undefined);
      const closingIndex = openProjects.findIndex((item) => item.root === project.root);
      const remainingProjects = openProjects.filter((item) => item.root !== project.root);
      const nextProject = remainingProjects[Math.min(Math.max(0, closingIndex), Math.max(0, remainingProjects.length - 1))];
      setOpenProjects(remainingProjects);
      localStorage.setItem(OPEN_PROJECTS_STORAGE_KEY, JSON.stringify(remainingProjects));
      setProject(undefined);
      setProjectLoaded(true);
      setProjectError("");
      setFiles([]);
      setScreens([]);
      setAssets([]);
      setSnapshot(undefined);
      setSnapshotSource(undefined);
      setSelectedNodeIds([]);
      selectedNodeIdRef.current = undefined;
      setActiveUiPath("scripts/ui/HomePage.lua");
      setSelectedFile("scripts/ui/HomePage.lua");
      setCode("-- 请先打开一个 TapTap Maker 项目…");
      setCodeDirty(false);
      setSaveState("idle");
      setGitStatus(undefined);
      setGitConflictPlan("");
      setMakerMeta({});
      setMakerPreviewStatus(undefined);
      setPreviewPanel(undefined);
      setPreviewDockOpen(false);
      setWorkflow(undefined);
      setSidecarInfo({ path: "", exists: false });
      setRuntimeErrorReport(undefined);
      dismissedRuntimeErrorsRef.current.clear();
      setSearchOpen(false);
      setSettingsOpen(false);
      setQrOpen(false);
      setQrMenuOpen(false);
      setToolsMenuOpen(false);
      setSponsorOpen(false);
      setNodeContextMenu(null);
      setFloatingWorkspace(null);
      setMode("inspect");
      setCenterTab("workflow");
      setHealth((current) => {
        if (!current) return current;
        const { runtimeSessionId: _runtimeSessionId, runtimeConnectedAt: _runtimeConnectedAt, makerProjectMeta: _makerProjectMeta, ...rest } = current;
        return { ...rest, runtimeScene: "idle", snapshotSource: "empty" };
      });
      if (nextProject) await openProjectPath(nextProject.root, { skipDirtyCheck: true });
    } catch (error) {
      toast(`关闭项目失败：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setProjectOpening(false);
    }
  }, [codeDirty, makerPreviewStatus?.process_alive, openProjectPath, openProjects, project, toast]);

  const closeProjectTab = useCallback((projectPath: string) => {
    if (project?.root === projectPath) {
      void closeCurrentProject();
      return;
    }
    setOpenProjects((current) => {
      const next = current.filter((item) => item.root !== projectPath);
      localStorage.setItem(OPEN_PROJECTS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, [closeCurrentProject, project?.root]);

  const removeRecentProject = useCallback((projectPath: string) => {
    setRecentProjects((current) => {
      const next = current.filter((item) => item.root !== projectPath);
      localStorage.setItem("tapmakerwork.recentProjects", JSON.stringify(next));
      return next;
    });
    toast("已从最近项目移除", "success");
  }, [toast]);

  const refreshRuntimeLogs = useCallback(async () => {
    try {
      const [logsResponse, statusResponse] = await Promise.all([
        fetch(`${API}/api/maker/preview/logs`),
        fetch(`${API}/api/maker/preview/status`)
      ]);
      const result = await logsResponse.json() as { lines?: string[]; error?: string };
      const status = statusResponse.ok ? await statusResponse.json() as MakerPreviewStatus : undefined;
      if (status) setMakerPreviewStatus(status);
      const lines = result.lines?.length ? result.lines : result.error ? [`日志：${result.error}`] : ["暂无 Runtime 日志。"];
      setLogs((current) => ({ ...current, runtime: lines.slice(-200) }));
      const report = extractRuntimeErrorReport(lines);
      if (status?.process_alive && report && !dismissedRuntimeErrorsRef.current.has(report.fingerprint)) {
        setRuntimeErrorReport(report);
      }
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

  const openGitDiff = useCallback(async (change: GitChangeState, scope: "staged" | "unstaged") => {
    const apiScope = scope === "staged" ? "staged" : "worktree";
    setGitFileMenu(null);
    setGitGroupMenu(null);
    setGitDiff({
      path: change.path,
      scope: apiScope,
      status: change.status,
      original: "",
      modified: "",
      binary: false,
      added: change.untracked,
      deleted: false,
      additions: 0,
      deletions: 0,
      loading: true
    });
    setCenterTab("git-diff");
    try {
      const response = await fetch(`${API}/api/git/diff?path=${encodeURIComponent(change.path)}&scope=${apiScope}`);
      const result = await response.json() as GitFileDiffState & { error?: string };
      if (!response.ok) throw new Error(result.error || "无法读取 Git 差异");
      setGitDiff({ ...result, loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGitDiff((current) => current?.path === change.path ? { ...current, loading: false, error: message } : current);
      toast(`差异加载失败：${message}`, "error");
    }
  }, [toast]);

  const runGitAction = useCallback(async (action: "pull" | "commit" | "push-build") => {
    setGitBusy(action);
    setGitConflictPlan("");
    setActiveTerminal("build");
    try {
      const response = await fetch(`${API}/api/git/${action === "pull" ? "pull" : "commit"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: action === "pull" ? "{}" : JSON.stringify({
          message: gitCommitMessage,
          push: action === "push-build",
          remoteBuild: action === "push-build"
        })
      });
      const result = await response.json() as {
        ok?: boolean;
        output?: string;
        error?: string;
        conflictPlan?: string;
        status?: GitStatusState;
        remoteBuild?: { ok?: boolean; error?: string };
      };
      if (result.status) setGitStatus(result.status);
      if (result.conflictPlan) setGitConflictPlan(result.conflictPlan);
      const detail = result.output || result.error || result.remoteBuild?.error;
      if (detail) setLogs((current) => ({ ...current, build: [...current.build, detail].slice(-500) }));
      if (!response.ok || result.ok === false || result.remoteBuild?.ok === false) {
        throw new Error(result.remoteBuild?.error || result.error || "Git 操作失败");
      }
      toast(action === "pull" ? "已拉取最新代码" : action === "commit" ? "已完成本地提交" : "已提交、推送并触发远端刷新", "success");
      void loadGitStatus();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setGitBusy("");
    }
  }, [gitCommitMessage, loadGitStatus, toast]);

  const runGitFileAction = useCallback(async (action: "stage" | "unstage" | "discard" | "stage-all" | "unstage-all" | "discard-all", change?: GitChangeState) => {
    if (action === "discard" && change && !window.confirm(`确定丢弃 ${change.path} 的本地修改吗？此操作无法撤销。`)) return;
    if (action === "discard-all" && !window.confirm("确定放弃所有本地更改吗？未跟踪文件也会被删除，此操作无法撤销。")) return;
    setGitFileMenu(null);
    setGitGroupMenu(null);
    try {
      const response = await fetch(`${API}/api/git/mutate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...(change ? { path: change.path } : {}) })
      });
      const result = await response.json() as { status?: GitStatusState; error?: string };
      if (!response.ok || !result.status) throw new Error(result.error || "Git 文件操作失败");
      setGitStatus(result.status);
      if ((action === "discard" && change?.path === gitDiff?.path) || action === "discard-all") {
        setGitDiff(null);
        setCenterTab("code");
      } else if (change && change.path === gitDiff?.path) {
        void openGitDiff(change, action === "stage" ? "staged" : "unstaged");
      } else if (gitDiff && (action === "stage-all" || action === "unstage-all")) {
        const nextChange = result.status.changes?.find((item) => item.path === gitDiff.path);
        if (nextChange) void openGitDiff(nextChange, action === "stage-all" ? "staged" : "unstaged");
        else {
          setGitDiff(null);
          setCenterTab("code");
        }
      }
      toast(action === "stage" || action === "stage-all" ? "已暂存修改" : action === "unstage" || action === "unstage-all" ? "已取消暂存" : action === "discard-all" ? "已放弃所有本地更改" : "已丢弃本地修改", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  }, [gitDiff?.path, openGitDiff, toast]);

  const loadSystemInfo = useCallback(async () => {
    try {
      const [healthRes, infoRes, adapterRes, makerVersionsRes, nodeVersionsRes] = await Promise.all([
        fetch(`${API}/api/health`),
        fetch(`${API}/api/system/info`),
        fetch(`${API}/api/runtime/adapter`),
        fetch(`${API}/api/maker/versions`),
        fetch(`${API}/api/node/versions`)
      ]);
      if (healthRes.ok) setHealth(await healthRes.json() as Health);
      if (infoRes.ok) setSystemInfo(await infoRes.json() as Record<string, unknown>);
      if (adapterRes.ok) {
        const adapter = await adapterRes.json() as { installed: boolean; paths: string[] };
        setAdapterExport(adapter.installed ? `项目内已安装：${adapter.paths.join(", ")}` : "项目内未安装 Runtime 适配器");
      }
      if (makerVersionsRes.ok) setMakerVersions(await makerVersionsRes.json() as MakerVersionState);
      if (nodeVersionsRes.ok) setNodeVersions(await nodeVersionsRes.json() as NodeVersionState);
    } catch {
      // ignore settings load errors
    }
  }, []);

  const refreshMakerHealth = useCallback(async () => {
    const response = await fetch(`${API}/api/health`);
    if (response.ok) setHealth(await response.json() as Health);
  }, []);

  const checkMakerUpdates = useCallback(async () => {
    setMakerVersionBusy("check");
    try {
      const [makerResponse, nodeResponse] = await Promise.all([
        fetch(`${API}/api/maker/versions?refresh=1`),
        fetch(`${API}/api/node/versions?refresh=1`)
      ]);
      const makerResult = await makerResponse.json() as MakerVersionState & { error?: string };
      const nodeResult = await nodeResponse.json() as NodeVersionState & { error?: string };
      if (!makerResponse.ok) throw new Error(makerResult.error || "无法连接 Maker 版本服务");
      if (!nodeResponse.ok) throw new Error(nodeResult.error || "无法连接 Node.js 版本服务");
      setMakerVersions(makerResult);
      setNodeVersions(nodeResult);
      toast("Maker MCP 与 Node.js 更新检查完成", "success");
    } catch (error) {
      toast(`检查更新失败：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setMakerVersionBusy("");
    }
  }, [toast]);

  const selectMakerVersion = useCallback(async (mode: MakerRuntimeMode, version?: string) => {
    setMakerVersionBusy("switch");
    try {
      const response = await fetch(`${API}/api/maker/version/select`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, version })
      });
      const result = await response.json() as MakerVersionState & { error?: string };
      if (!response.ok) throw new Error(result.error || "切换失败");
      setMakerVersions(result);
      await refreshMakerHealth();
      const selected = mode === "device" ? "设备自动" : result.active?.version || version || mode;
      toast(`Maker MCP 已切换为 ${selected}`, "success");
    } catch (error) {
      toast(`切换 Maker MCP 失败：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setMakerVersionBusy("");
    }
  }, [refreshMakerHealth, toast]);

  const installMakerChannel = useCallback(async (channel: "stable" | "beta") => {
    const target = makerVersions?.channels[channel].latest;
    if (!target) {
      toast("请先检查更新，获取可安装版本", "warn");
      return;
    }
    const label = channel === "stable" ? "稳定版" : "Beta 版";
    if (!window.confirm(`安装 Maker MCP ${target}（${label}）并立即切换？`)) return;
    setMakerVersionBusy(channel);
    try {
      const response = await fetch(`${API}/api/maker/version/install`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel })
      });
      const result = await response.json() as MakerVersionState & { error?: string };
      if (!response.ok) throw new Error(result.error || "安装失败");
      setMakerVersions(result);
      await refreshMakerHealth();
      toast(`Maker MCP ${target} 安装完成并已切换`, "success");
    } catch (error) {
      toast(`安装 Maker MCP 失败：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setMakerVersionBusy("");
    }
  }, [makerVersions, refreshMakerHealth, toast]);

  const syncSystemNode = useCallback(async () => {
    setMakerVersionBusy("node");
    try {
      const response = await fetch(`${API}/api/node/version/sync`, { method: "POST" });
      const result = await response.json() as NodeVersionState & { error?: string; maker?: MakerVersionState };
      if (!response.ok) throw new Error(result.error || "系统 Node.js 同步失败");
      setNodeVersions(result);
      if (result.maker) setMakerVersions(result.maker);
      await refreshMakerHealth();
      toast(`已同步系统 Node.js ${result.active.version}`, "success");
    } catch (error) {
      toast(`同步 Node.js 失败：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setMakerVersionBusy("");
    }
  }, [refreshMakerHealth, toast]);

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
        trackTelemetry("build.trigger", { result: "fail" });
      } else {
        setLogs((current) => ({ ...current, build: [...current.build, "构建请求已完成，详情见构建终端。"] }));
        trackTelemetry("build.trigger", { result: "ok" });
        void refreshRuntimeLogs();
      }
    } catch (error) {
      setLogs((current) => ({ ...current, build: [...current.build, `构建异常：${error instanceof Error ? error.message : String(error)}`] }));
      trackTelemetry("build.trigger", { result: "error" });
    } finally {
      setMakerBusy("");
    }
  }, [refreshRuntimeLogs, trackTelemetry]);

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
    if (copyInFlightRef.current) return;
    copyInFlightRef.current = true;
    setCopyBusy(true);
    const failures: string[] = [];
    try {
      let copied = false;
      const desktopClipboard = window.tapMakerWork?.clipboard;
      if (desktopClipboard) {
        try {
          const result = await desktopClipboard.writeText(text);
          copied = result.ok;
          if (!result.ok) failures.push(result.error || "desktop_clipboard_failed");
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }
      if (!copied && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          copied = true;
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }
      if (!copied) copied = legacyCopyText(text);
      if (!copied) throw new Error(failures.filter(Boolean).join(" · ") || "clipboard_unavailable");
      toast("已复制到剪贴板", "success");
      setLogs((current) => ({ ...current, qrcode: [...current.qrcode, `已复制 ${text.length} 个字符到剪贴板`] }));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      toast("复制失败，请在文本框中按 ⌘C / Ctrl+C", "error");
      setLogs((current) => ({ ...current, qrcode: [...current.qrcode, `复制失败：${reason}`] }));
    } finally {
      copyInFlightRef.current = false;
      setCopyBusy(false);
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
      if (mode === "live-edit" || centerTab === "visual") markSidecarDirty();
      scheduleRuntimeEditSync(140);
      toast(`${label}成功`, "success");
      setLeftTab("hierarchy");
    } catch (error) {
      toast(`${label}失败：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }, [snapshot, mode, centerTab, markSidecarDirty, scheduleRuntimeEditSync, toast]);

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
    const directory = screen.path.split("/").slice(1, -1).join("/");
    const location = directory && directory !== "ui" ? `${directory} · ` : "";
    if (screen.confidence === "module" || screen.error === "module_only") return `${location}逻辑模块 · 非界面`;
    if (screen.error) return `${location}仅代码 · 无法静态预览`;
    return `${location}${screen.nodeCount ?? 0} 个节点 · ${screen.confidence === "static" ? "完整" : "混合"}`;
  };

  const saveUiSidecar = useCallback(async (snapshotOverride?: UiSnapshot) => {
    const snap = snapshotOverride ?? snapshotRef.current;
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
        persistence?: { mode?: "static-tree" | "template-overrides"; overrideCount?: number; skippedInstances?: number };
        preview?: { reloadToken?: number; autoRefreshIframe?: boolean; autoRefreshMaker?: boolean; makerRefresh?: { error?: string } };
      };
      if (!response.ok) throw new Error(result.error || "写入 .ui.json 失败");
      setSidecarInfo({
        path: result.path || "",
        exists: true,
        ...(result.savedAt ? { savedAt: result.savedAt } : {}),
        ...(result.persistence?.mode ? { saveMode: result.persistence.mode } : {}),
        ...(typeof result.persistence?.overrideCount === "number" ? { overrideCount: result.persistence.overrideCount } : {}),
        ...(typeof result.persistence?.skippedInstances === "number" ? { skippedInstances: result.persistence.skippedInstances } : {}),
        dirty: false
      });
      if (typeof result.preview?.reloadToken === "number") {
        setPreviewPanel((current) => current ? { ...current, reloadToken: result.preview!.reloadToken! } : current);
      }
      if (result.preview?.makerRefresh?.error) {
        setLogs((current) => ({ ...current, runtime: [...current.runtime, `live-edit Maker refresh：${result.preview!.makerRefresh!.error}`] }));
      }
      const persistenceSummary = result.persistence?.mode === "template-overrides"
        ? ` · ${result.persistence.overrideCount || 0} 条模板覆盖${result.persistence.skippedInstances ? ` · 已忽略 ${result.persistence.skippedInstances} 个不稳定实例/结构操作` : ""}`
        : " · 静态结构";
      setLogs((current) => ({ ...current, agent: [...current.agent, `视觉已同步 → ${result.path}${persistenceSummary}${result.preview?.autoRefreshIframe ? " · 预览自动刷新" : ""}`] }));
    } catch (error) {
      setLogs((current) => ({ ...current, agent: [...current.agent, `同步 .ui.json 失败：${error instanceof Error ? error.message : String(error)}`] }));
    }
  }, [activeUiPath]);

  useEffect(() => {
    if (!sidecarInfo.dirty) return;
    const timer = window.setTimeout(() => { void saveUiSidecar(); }, 700);
    return () => window.clearTimeout(timer);
  }, [sidecarEditRevision, sidecarInfo.dirty, saveUiSidecar]);

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
        setOpenProjects((current) => {
          const next = current.some((item) => item.root === value.project!.root)
            ? current
            : [...current, { root: value.project!.root, name: value.project!.name }].slice(-8);
          localStorage.setItem(OPEN_PROJECTS_STORAGE_KEY, JSON.stringify(next));
          return next;
        });
        await loadProjectContents();
        void loadAssets();
        void loadGitStatus();
        void refreshRuntimeLogs();
        void loadMakerMeta();
        void loadPreviewPanel();
        void loadWorkflow();
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
          if (event.type === "ui.snapshot" && event.source === "runtime" && (modeRef.current === "live-edit" || centerTabRef.current === "visual")) {
            setSnapshotSource("runtime");
            return;
          }
          setSnapshot((current) => keepValidSelection(current, event.snapshot, selectedNodeIdRef.current));
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
  }, [loadProjectContents, loadAssets, loadGitStatus, refreshRuntimeLogs, loadMakerMeta, loadPreviewPanel, loadWorkflow]);

  useEffect(() => window.tapMakerWork?.onOpenProject?.((projectPath) => { void openProjectPath(projectPath); }), [openProjectPath]);
  useEffect(() => window.tapMakerWork?.onCloseProject?.(() => { void closeCurrentProject(); }), [closeCurrentProject]);

  useEffect(() => {
    if (centerTab !== "visual") return;
    setCanvasAutoFit(true);
  }, [activeUiPath, centerTab]);

  useEffect(() => {
    if (centerTab !== "visual") return;
    const viewport = canvasViewportRef.current;
    if (!viewport) return;
    const updateScale = () => {
      if (!canvasAutoFit) return;
      const availableWidth = Math.max(120, viewport.clientWidth - 56);
      const availableHeight = Math.max(120, viewport.clientHeight - 56);
      setStageScale(Math.min(4, Math.max(0.1, Math.min(availableWidth / previewWidth, availableHeight / previewHeight))));
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [canvasAutoFit, centerTab, previewHeight, previewWidth]);

  const selected = useMemo(() => snapshot?.selectedId ? findUiNode(snapshot.root, snapshot.selectedId) : undefined, [snapshot]);
  const selectedTransform = useMemo(() => {
    const value = selected?.props.transform;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, UiValue> : {};
  }, [selected]);
  const selectedTextColorProperty = selected?.props.fontColor !== undefined
    ? "fontColor"
    : selected?.props.textColor !== undefined ? "textColor" : "fontColor";
  const selectedHasText = Boolean(selected && (selected.type === "Label" || selected.type === "Button" || selected.props.text !== undefined));
  const selectedHasImage = Boolean(selected && (selected.type === "Image" || ["backgroundImage", "path", "sprite", "image", "texture", "fileName", "file"].some((key) => selected.props[key] != null)));
  const contextNode = useMemo(() => nodeContextMenu && snapshot ? findUiNode(snapshot.root, nodeContextMenu.nodeId) : undefined, [nodeContextMenu, snapshot]);
  const canvasVisualScore = useMemo(() => snapshot ? visualWeight(snapshot.root) : 0, [snapshot]);
  const canvasLooksSparse = canvasVisualScore < 8;
  const runtimeLive = Boolean(health?.runtimeSessionId || makerPreviewStatus?.process_alive);
  useEffect(() => {
    dismissedRuntimeErrorsRef.current.clear();
    setRuntimeErrorReport(undefined);
  }, [project?.root]);

  useEffect(() => {
    if (!runtimeLive || !project) return;
    void refreshRuntimeLogs();
    const timer = window.setInterval(() => void refreshRuntimeLogs(), 2_000);
    return () => window.clearInterval(timer);
  }, [project?.root, refreshRuntimeLogs, runtimeLive]);
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
    kind: "move" | "resize" | "rotate" | "scale";
    resizeHandle?: string;
    baseRevision: number;
    source?: UiNode["source"];
    startX: number;
    startY: number;
    left: number;
    top: number;
    width: number;
    height: number;
    rotate: number;
    scale: number;
    transform: Record<string, UiValue>;
    screenCenter: { x: number; y: number };
    startAngle: number;
    startPoint: { x: number; y: number };
    current: { left: number; top: number; width: number; height: number; rotate: number; scale: number };
  } | null>(null);

  const beginNodeDrag = useCallback((nodeId: string, event: React.PointerEvent, operation = "move") => {
    if (centerTab !== "visual" || !snapshot) return;
    const node = findUiNode(snapshot.root, nodeId);
    if (!node || node.id === snapshot.root.id) return;
    event.preventDefault();
    event.stopPropagation();
    const box = runtimeLayoutBox(node.props);
    const left = box.x ?? (typeof node.props.left === "number" ? node.props.left : 0);
    const top = box.y ?? (typeof node.props.top === "number" ? node.props.top : 0);
    const element = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-node-id]");
    const measured = element?.getBoundingClientRect();
    const width = box.w ?? (typeof node.props.width === "number" ? node.props.width : measured ? measured.width / Math.max(stageScale, .01) : 80);
    const height = box.h ?? (typeof node.props.height === "number" ? node.props.height : measured ? measured.height / Math.max(stageScale, .01) : 32);
    const transform = node.props.transform && typeof node.props.transform === "object" && !Array.isArray(node.props.transform)
      ? node.props.transform as Record<string, UiValue>
      : {};
    const rotate = typeof node.props.rotate === "number" ? node.props.rotate : 0;
    const nodeScale = typeof transform.scale === "number" ? transform.scale : 1;
    const screenCenter = measured
      ? { x: measured.left + measured.width / 2, y: measured.top + measured.height / 2 }
      : { x: event.clientX, y: event.clientY };
    const kind = operation === "rotate" || operation === "scale" || operation === "move" ? operation : "resize";
    dragRef.current = {
      id: nodeId,
      kind,
      ...(kind === "resize" ? { resizeHandle: operation } : {}),
      baseRevision: snapshot.revision,
      ...(node.source ? { source: node.source } : {}),
      startX: event.clientX,
      startY: event.clientY,
      left,
      top,
      width,
      height,
      rotate,
      scale: nodeScale,
      transform,
      screenCenter,
      startAngle: angleBetween(screenCenter, { x: event.clientX, y: event.clientY }),
      startPoint: { x: event.clientX, y: event.clientY },
      current: { left, top, width, height, rotate, scale: nodeScale }
    };
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  }, [centerTab, snapshot, stageScale]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const scale = stageScale || 1;
      const dx = (event.clientX - drag.startX) / scale;
      const dy = (event.clientY - drag.startY) / scale;
      const snapping = canvasSnapEnabled || event.metaKey || event.ctrlKey;
      const rawRect = drag.kind === "resize"
        ? resizeRect({ x: drag.left, y: drag.top, w: drag.width, h: drag.height }, drag.resizeHandle || "se", dx, dy)
        : { x: drag.left + dx, y: drag.top + dy, w: drag.width, h: drag.height };
      const rect = snapping && (drag.kind === "move" || drag.kind === "resize") ? {
        x: snapValue(rawRect.x, 10),
        y: snapValue(rawRect.y, 10),
        w: snapValue(rawRect.w, 10),
        h: snapValue(rawRect.h, 10)
      } : rawRect;
      const angleDelta = (angleBetween(drag.screenCenter, { x: event.clientX, y: event.clientY }) - drag.startAngle) * 180 / Math.PI;
      const rawRotate = drag.rotate + angleDelta;
      const rawScale = drag.scale * scaleRatio(drag.screenCenter, drag.startPoint, { x: event.clientX, y: event.clientY });
      const next = {
        left: Math.round(rect.x),
        top: Math.round(rect.y),
        width: Math.round(rect.w),
        height: Math.round(rect.h),
        rotate: Math.round((snapping ? snapValue(rawRotate, 15) : rawRotate) * 10) / 10,
        scale: Math.round((snapping ? snapValue(rawScale, .1) : rawScale) * 100) / 100
      };
      drag.current = next;
      setSnapshot((current) => {
        if (!current) return current;
        const visit = (node: UiNode): UiNode => {
          if (node.id === drag.id) {
            const layoutProps = drag.kind === "move" || drag.kind === "resize" ? {
              position: "absolute" as const,
              left: next.left,
              top: next.top,
              ...(drag.kind === "resize" ? { width: next.width, height: next.height } : {}),
              $layout: { x: next.left, y: next.top, w: next.width, h: next.height }
            } : {};
            return {
              ...node,
              props: {
                ...node.props,
                ...layoutProps,
                ...(drag.kind === "rotate" ? { rotate: next.rotate } : {}),
                ...(drag.kind === "scale" ? { transform: { ...drag.transform, scale: next.scale } } : {})
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
      if (!drag) {
        dragRef.current = null;
        return;
      }
      dragRef.current = null;
      const nodeId = drag.id;
      setSnapshot((current) => current ? { ...current, selectedId: nodeId } : current);
      void (async () => {
        const props: Record<string, UiValue> = drag.kind === "rotate"
          ? { rotate: drag.current.rotate }
          : drag.kind === "scale"
            ? { transform: { ...drag.transform, scale: drag.current.scale } }
            : {
                position: "absolute",
                left: drag.current.left,
                top: drag.current.top,
                ...(drag.kind === "resize" ? { width: drag.current.width, height: drag.current.height } : {})
              };
        const patch: UiPatch = {
          requestId: crypto.randomUUID(),
          baseRevision: drag.baseRevision,
          nodeId,
          props,
          ...(drag.source ? { source: drag.source } : {})
        };
        const response = await fetch(`${API}/api/ui/patch`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch)
        });
        if (response.ok) {
          const next = await response.json() as UiSnapshot;
          setSnapshot({ ...next, selectedId: nodeId });
          markSidecarDirty();
          scheduleRuntimeEditSync(120);
        } else {
          const result = await response.json().catch(() => ({})) as { error?: string };
          toast(`画布调整失败：${result.error || response.statusText}`, "error");
        }
      })();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [canvasSnapEnabled, markSidecarDirty, scheduleRuntimeEditSync, stageScale, toast]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetch(`${API}/api/health`).then((res) => res.json()).then((value: Health) => {
        setHealth(value);
        if (value.runtimeSessionId && modeRef.current !== "live-edit" && centerTabRef.current !== "visual") {
          void fetch(`${API}/api/ui/snapshot`).then((r) => r.json()).then((snap) => {
            setSnapshot((current) => keepValidSelection(current, snap as UiSnapshot, selectedNodeIdRef.current));
          }).catch(() => undefined);
        }
      }).catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!project) return;
    const refreshStatus = () => {
      void fetch(`${API}/api/maker/preview/status`).then(async (response) => {
        if (response.ok) setMakerPreviewStatus(await response.json() as MakerPreviewStatus);
      }).catch(() => undefined);
    };
    refreshStatus();
    const timer = window.setInterval(refreshStatus, 5_000);
    return () => window.clearInterval(timer);
  }, [project?.root]);

  const historyAction = useCallback(async (action: "undo" | "redo") => {
    const response = await fetch(`${API}/api/ui/${action}`, { method: "POST" });
    if (response.ok) {
      const next = await response.json() as UiSnapshot;
      setSnapshot((current) => keepValidSelection(current, next, selectedNodeIdRef.current));
      if (mode === "live-edit" || centerTab === "visual") markSidecarDirty();
      scheduleRuntimeEditSync(0);
      setRuntimeEditRevision((revision) => revision + 1);
      toast(action === "undo" ? "已撤销上一步编辑" : "已重做编辑", "success");
    }
  }, [mode, centerTab, markSidecarDirty, scheduleRuntimeEditSync, toast]);

  useEffect(() => window.tapMakerWork?.onHistoryAction?.((action) => {
    const active = document.activeElement as HTMLElement | null;
    if (active?.matches("input, textarea, [contenteditable='true']")) {
      document.execCommand(action);
      return;
    }
    void historyAction(action);
  }), [historyAction]);

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
        trackTelemetry("preview.action", { action, result: "fail" });
      } else {
        trackTelemetry("preview.action", { action, result: "ok" });
        setMakerPreviewStatus((current) => ({
          ...current,
          state: result.state || (action === "stop" ? "stopped" : "running"),
          process_alive: action !== "stop"
        }));
        setLogs((current) => ({
          ...current,
          runtime: [...current.runtime, `Maker preview ${action} 完成${result.state ? ` · ${result.state}` : ""}${result.message ? ` · ${result.message}` : ""}`]
        }));
        void refreshRuntimeLogs();
        void fetch(`${API}/api/health`).then((res) => res.json()).then(setHealth).catch(() => undefined);
        if (action !== "stop") {
          if (action === "start") {
            setCenterTab("runtime");
            setPreviewDockOpen(false);
          }
          toast(action === "start" ? "Runtime 已启动；当前显示真实运行器窗口画面。" : "Runtime 已刷新。", "success");
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
        window.setTimeout(() => {
          void fetch(`${API}/api/maker/preview/status`).then(async (statusResponse) => {
            if (statusResponse.ok) setMakerPreviewStatus(await statusResponse.json() as MakerPreviewStatus);
          }).catch(() => undefined);
        }, 600);
      }
    } finally {
      setRuntimeBusy(false);
    }
  };

  const installRuntimeEditor = async () => {
    setAdapterInstallBusy(true);
    try {
      const response = await fetch(`${API}/api/runtime/adapter/install`, { method: "POST" });
      const result = await response.json() as { changed?: boolean; adapterPath?: string; entryPath?: string; backupPath?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "运行时编辑桥接入失败");
      setAdapterExport(`已接入：${result.adapterPath || "scripts/tapmakerwork/TapMakerWorkBridge.lua"}${result.entryPath ? `\n客户端入口：${result.entryPath}` : ""}${result.backupPath ? `\n入口备份：${result.backupPath}` : ""}`);
      setHealth((current) => current ? {
        ...current,
        runtimeAdapter: { installed: true, paths: ["scripts/tapmakerwork/TapMakerWorkBridge.lua"] }
      } : current);
      setLogs((current) => ({
        ...current,
        runtime: [...current.runtime, `实时编辑桥已接入${result.entryPath ? `客户端入口 ${result.entryPath}` : "当前项目"}${result.changed ? "；需要重启 Runtime" : ""}`]
      }));
      toast("实时编辑桥已接入，正在重启 Runtime 并建立连接…", "success");
      trackTelemetry("adapter.install", { result: "ok" });
      if (runtimeLive) await runtimeAction("stop");
      await runtimeAction("start");
      setMode("live-edit");
      setCenterTab("runtime");
      [1200, 2500, 4500, 7000].forEach((delay) => window.setTimeout(() => void syncFromRuntime(), delay));
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setAdapterInstallBusy(false);
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
      if (snapRes.ok) {
        const incoming = await snapRes.json() as UiSnapshot;
        setSnapshot((current) => keepValidSelection(current, incoming, selectedNodeIdRef.current));
      }
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

  const runWorkflowAction = async (action: ProjectWorkflowAction) => {
    setWorkflowBusyAction(action);
    try {
      if (action === "doctor") await runMakerDoctor();
      else if (action === "open-design") {
        setMode("live-edit");
        setCenterTab("visual");
        setLeftTab("hierarchy");
      } else if (action === "open-code") setCenterTab("code");
      else if (action === "start-preview") await runtimeAction("start");
      else if (action === "open-preview") {
        setPreviewDockOpen(true);
        await loadPreviewPanel();
      } else if (action === "generate-qrcode") await runMakerQrcode();
      else if (action === "build") await runMakerBuild();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setWorkflowBusyAction(undefined);
      void loadWorkflow();
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveFile();
        return;
      }
      if ((event.target as HTMLElement | null)?.closest(".monaco-editor")) return;
      if ((event.target as HTMLElement | null)?.matches("input, textarea, select, [contenteditable='true']")) return;
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
  }, [historyAction, saveFile]);

  const updateDevice = (changes: Partial<DeviceProfile>) => setDevice((current) => ({ ...current, ...changes, id: changes.id ?? "custom", label: changes.label ?? "自定义" }));
  const openShortcut = window.tapMakerWork?.platform === "darwin" ? "⌘ O" : "Ctrl O";
  const dismissRuntimeError = () => {
    if (runtimeErrorReport) dismissedRuntimeErrorsRef.current.add(runtimeErrorReport.fingerprint);
    setRuntimeErrorReport(undefined);
  };
  const legalOverlay = legalDialogOpen
    ? <LegalConsentDialog
      state={desktopLegal}
      busy={legalBusy}
      onAccept={() => void acceptLegalTerms()}
      onDecline={() => void declineLegalTerms()}
      onClose={() => setLegalDialogOpen(false)}
    />
    : null;
  const projectRejectOverlay = projectReject
    ? <ProjectRejectDialog
      path={projectReject.path}
      message={projectReject.message}
      onClose={() => {
        setProjectReject(undefined);
        setProjectError("");
      }}
    />
    : null;
  const runtimeErrorOverlay = runtimeErrorReport
    ? <RuntimeErrorDialog
      report={runtimeErrorReport}
      copying={copyBusy}
      onCopy={() => void copyText(runtimeErrorReport.clipboardText)}
      onOpenLogs={() => {
        setActiveTerminal("runtime");
        persistLayout({ ...layout, terminal: Math.max(layout.terminal, DEFAULT_LAYOUT.terminal) });
        dismissRuntimeError();
      }}
      onDismiss={dismissRuntimeError}
    />
    : null;
  const sponsorOverlay = sponsorOpen
    ? <SponsorDialog
      onClose={() => setSponsorOpen(false)}
      onOpenWorks={() => openExternalUrl("https://www.taptap.cn/user/59693183/works")}
    />
    : null;
  const roadmapOverlay = roadmapOpen
    ? <RoadmapDialog
      onClose={() => setRoadmapOpen(false)}
      onOpenSite={() => openExternalUrl(OFFICIAL_SITE_URL)}
      onJoinGroup={() => openExternalUrl(QQ_GROUP_JOIN_URL)}
    />
    : null;
  const newbieOverlay = newbieGuideOpen
    ? <NewbieGuideDialog
      onClose={({ enableCoachMarks: enableMarks } = {}) => {
        markOnboardingSeen();
        setNewbieGuideOpen(false);
        if (enableMarks !== false) {
          enableCoachMarks();
          setCoachLiveEdit(readCoachMark(COACH_LIVE_EDIT_KEY));
          setCoachRuntimeStart(readCoachMark(COACH_RUNTIME_START_KEY));
        } else {
          dismissCoachMark(COACH_LIVE_EDIT_KEY);
          dismissCoachMark(COACH_RUNTIME_START_KEY);
          setCoachLiveEdit(false);
          setCoachRuntimeStart(false);
        }
      }}
    />
    : null;
  const permissionOverlay = !legalDialogOpen && permissionGuideOpen && desktopPermissions
    ? <PermissionGuide state={desktopPermissions} busy={permissionBusy} confirmed={permissionConfirmed} onAction={(action) => void runPermissionAction(action)} onClose={closePermissionGuide} />
    : null;
  const updatePromptOverlay = !legalDialogOpen && updatePromptOpen && desktopUpdate?.phase === "available"
    ? <UpdatePromptDialog
      state={desktopUpdate}
      busy={desktopUpdateBusy}
      onUpdate={() => void runDesktopUpdateAction("download")}
      onSnooze={() => void runDesktopUpdateAction("snooze")}
      onMute={() => void runDesktopUpdateAction("mute")}
      onClose={() => setUpdatePromptOpen(false)}
    />
    : null;

  if (!projectLoaded || !project) {
    return (
      <><main className="welcome-window">
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
              {recentProjects.map((item) => <div className="recent-project-row" key={item.root}>
                <button className="recent-project-open" onClick={() => void openProjectPath(item.root)} disabled={projectOpening}>
                  <Folder size={17} aria-hidden="true" /><span><strong>{item.name}</strong><small>{item.root}</small></span><ChevronRight size={16} aria-hidden="true" />
                </button>
                <button className="recent-project-remove" aria-label={`移除最近项目 ${item.name}`} title="从最近项目移除（不会删除本地文件）" onClick={() => removeRecentProject(item.root)}><Trash2 size={14} /></button>
              </div>)}
            </div>}
          </div>
          <div className="welcome-decoration" aria-hidden="true"><div /><div /><div /></div>
        </section>
      </main>{legalOverlay}{projectRejectOverlay}{permissionOverlay}{updatePromptOverlay}</>
    );
  }

  return (
    <><main
      className="app-shell"
      style={{
        gridTemplateRows: `48px 40px minmax(200px, 1fr) ${layout.terminal}px 22px`,
        ["--preview-dock-w" as string]: `${layout.previewDock}px`
      } as React.CSSProperties}
    >
      <header className="titlebar">
        <div className="brand"><span className="brand-mark">T</span><strong>TapMakerWork</strong><span className="phase-badge">v{__APP_VERSION__}</span></div>
        <div className="project-tabs" role="tablist" aria-label="已打开项目">
          {openProjects.map((item) => {
            const active = item.root === project.root;
            return <div key={item.root} className={`project-tab ${active ? "active" : ""}`} title={item.root}>
              <button type="button" role="tab" aria-selected={active} disabled={projectOpening} onClick={() => void openProjectPath(item.root)}>
                <Folder size={14} aria-hidden="true" /><span>{item.name}</span>{active && <><GitBranch size={12} aria-hidden="true" /><small>{gitStatus?.branch || "—"}</small>{gitStatus?.dirty ? <small className="dirty-branch">•</small> : null}</>}
              </button>
              <button type="button" className="project-tab-close" aria-label={`关闭项目 ${item.name}`} disabled={projectOpening} onClick={() => closeProjectTab(item.root)}><X size={13} /></button>
            </div>;
          })}
          <button type="button" className="project-tab-add" aria-label="打开另一个项目" title="打开另一个项目" disabled={projectOpening} onClick={() => void chooseProject()}><Plus size={15} /></button>
        </div>
        <div className="runtime-status" role="status">{connected ? <Wifi size={14} aria-hidden="true" /> : <WifiOff size={14} aria-hidden="true" />}<span>{connected ? "Bridge 已连接" : "Bridge 断开"}</span>{runtimeLive ? <small className="runtime-live">Runtime 运行中</small> : <small>Runtime 未启动</small>}</div>
        <div className="title-actions">
          <Tip label="看看各按钮做什么、从哪开始改界面。">
            <button aria-label="使用说明" onClick={() => { setSearchOpen(false); setSettingsOpen(false); setTipsOpen(false); setCompressOpen(false); setGuideOpen((open) => !open); }}><CircleHelp size={15} /></button>
          </Tip>
          <Tip label="本地预览 Token 优化、grill-me、发布前检查等开发经验，可一键复制给 AI。">
            <button aria-label="开发技巧" onClick={() => { setSearchOpen(false); setSettingsOpen(false); setGuideOpen(false); setCompressOpen(false); setTipsOpen((open) => !open); }}><Lightbulb size={15} /></button>
          </Tip>
          <Tip label="在项目文件中全文搜索。输入关键词后回车，点击结果可跳转到源码行。">
            <button aria-label="搜索" onClick={() => { setGuideOpen(false); setSettingsOpen(false); setTipsOpen(false); setCompressOpen(false); setSearchOpen((open) => !open); toast(searchOpen ? "已关闭搜索" : "打开项目搜索", "info"); }}><Search size={15} /></button>
          </Tip>
          <Tip label="查看 Bridge / Maker / Runtime 适配器状态；可导出本地接入包（不会写入游戏 git）。">
            <button aria-label="设置" onClick={() => { setGuideOpen(false); setSearchOpen(false); setTipsOpen(false); setCompressOpen(false); setSettingsOpen((open) => { const next = !open; if (next) void loadSystemInfo(); toast(next ? "打开设置" : "关闭设置", "info"); return next; }); }}><Settings2 size={15} /></button>
          </Tip>
        </div>
      </header>

      <section className="commandbar">
        <div className="mode-switch" aria-label="工作模式">
          <Tip disabled label="在结构草图中直接拖动、缩放、改属性或右键创建节点">
            <button aria-pressed={mode === "inspect" && centerTab === "visual"} className={mode === "inspect" && centerTab === "visual" ? "active" : ""} onClick={() => { setMode("inspect"); setCanvasAutoFit(true); setCenterTab("visual"); }}><Pause size={14} />结构编辑</button>
          </Tip>
          <CoachMark label="① 点这里进入实时编辑" active={coachLiveEdit}>
            <Tip disabled label="直接在 Runtime 最终画面上拖动、缩放并回写引擎控件">
              <button
                aria-pressed={mode === "live-edit"}
                className={mode === "live-edit" ? "active" : ""}
                onClick={() => {
                  setMode("live-edit");
                  setCenterTab("runtime");
                  setPreviewDockOpen(false);
                  trackTelemetry("live_edit.enter", {});
                  if (coachLiveEdit) {
                    dismissCoachMark(COACH_LIVE_EDIT_KEY);
                    setCoachLiveEdit(false);
                  }
                }}
              ><SlidersHorizontal size={14} />实时编辑</button>
            </Tip>
          </CoachMark>
        </div>
        <button className="icon-command" aria-label="撤销" onClick={() => void historyAction("undo")}><Undo2 size={14} /></button>
        <button className="icon-command" aria-label="重做" onClick={() => void historyAction("redo")}><Redo2 size={14} /></button>
        <span className="separator" />
        <Tip label="启动官方 Maker Runtime（独立窗口）">
          <CoachMark label="② 再启动 Runtime" active={coachRuntimeStart}>
            <button
              className="runtime-launch-button"
              disabled={!health?.capabilities.makerCli || runtimeBusy}
              onClick={() => {
                toast("正在启动 Maker 预览…", "info");
                void runtimeAction("start");
                if (coachRuntimeStart) {
                  dismissCoachMark(COACH_RUNTIME_START_KEY);
                  setCoachRuntimeStart(false);
                }
              }}
            ><CirclePlay size={14} />{runtimeBusy ? "…" : "启动"}</button>
          </CoachMark>
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
        <Tip label="写入 .ui.json（静态节点保存结构；动态节点只保存模板覆盖，不改 Lua）">
          <button className="icon-command" aria-label="保存视觉旁路" onClick={() => { toast("正在写入 .ui.json…", "info"); void saveUiSidecar(); }} disabled={!activeUiPath || !snapshot}><Save size={14} /></button>
        </Tip>
        <Tip label={sidecarInfo.saveMode === "template-overrides"
          ? `${sidecarInfo.path || "ui.json"} · 动态实例和列表数据不会固化；已保存 ${sidecarInfo.overrideCount || 0} 条模板样式覆盖${sidecarInfo.skippedInstances ? `，忽略 ${sidecarInfo.skippedInstances} 项不稳定修改` : ""}`
          : sidecarInfo.path || "视觉旁路状态"}>
          <span className="sidecar-chip">{sidecarInfo.exists
            ? sidecarInfo.dirty
              ? "ui.json 未同步"
              : sidecarInfo.saveMode === "template-overrides"
                ? `模板覆盖 ${sidecarInfo.overrideCount || 0}`
                : "ui.json 已同步"
            : "ui.json 未创建"}</span>
        </Tip>
        <span className="commandbar-spacer" />
        <Tip label="打开 TapTap 开发者后台">
          <button className="developer-console-button" onClick={() => openExternalUrl("https://developer.taptap.cn/")}><ExternalLink size={13} />开发者后台</button>
        </Tip>
        <Tip label="打开 TapTap Maker 后台">
          <button className="developer-console-button maker-console-button" onClick={() => openExternalUrl("https://maker.taptap.cn/")}><ExternalLink size={13} />Maker 后台</button>
        </Tip>
        <Tip label="查看作者发布的 TapTap 游戏">
          <button className="developer-console-button creator-games-button" onClick={() => openExternalUrl("https://www.taptap.cn/user/59693183/works")}><Gamepad2 size={13} />作者游戏品鉴</button>
        </Tip>
        <Tip label="展示微信与支付宝赞赏码；赞赏完全自愿">
          <button className="developer-console-button sponsor-button" onClick={() => setSponsorOpen(true)}><Heart size={13} />赞赏作者</button>
        </Tip>
        <Tip label={`加入 ${QQ_GROUP_NAME}（群号 ${QQ_GROUP_ID}）`}>
          <button className="developer-console-button qq-group-button" onClick={() => openExternalUrl(QQ_GROUP_JOIN_URL)}><MessageCircle size={13} />一键入群</button>
        </Tip>
        <Tip label="查看 TapMakerWork 后续开发规划（资源优化、AI 提效、多平台打包等）">
          <button className="developer-console-button roadmap-button" onClick={() => setRoadmapOpen(true)}><Map size={13} />后续规划</button>
        </Tip>
        <div className="toolkit-menu-wrap tools-menu-wrap">
          <Tip label="工具集：图片压缩等实用工具">
            <button
              className={`developer-console-button toolkit-button ${toolkitMenuOpen || compressOpen ? "active" : ""}`}
              aria-label="工具"
              aria-expanded={toolkitMenuOpen}
              onClick={() => { setToolsMenuOpen(false); setToolkitMenuOpen((open) => !open); }}
            ><Wrench size={13} />工具</button>
          </Tip>
          {toolkitMenuOpen && (
            <div className="tools-menu toolkit-menu" role="menu">
              <section>
                <h3>工具集</h3>
                <div className="tools-actions">
                  <button onClick={() => { setToolkitMenuOpen(false); setTipsOpen(false); setSettingsOpen(false); setSearchOpen(false); setGuideOpen(false); setCompressOpen(true); }}>
                    <Image size={13} />图片压缩
                  </button>
                  <button onClick={() => { setToolkitMenuOpen(false); setCompressOpen(false); setSettingsOpen(false); setSearchOpen(false); setGuideOpen(false); setTipsOpen(true); }}>
                    <Lightbulb size={13} />开发技巧
                  </button>
                  <button onClick={() => { setToolkitMenuOpen(false); setNewbieGuideOpen(true); }}>
                    <Sparkles size={13} />新手引导
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
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
                  <button disabled={makerBusy === "qrcode"} onClick={() => { setToolsMenuOpen(false); void runMakerQrcode(); }}><QrCode size={13} />二维码</button>
                  <button disabled={makerBusy === "doctor" || !health?.capabilities.makerCli} onClick={() => { setToolsMenuOpen(false); void runMakerDoctor(); }}><Activity size={13} />Doctor</button>
                  <button disabled={runtimeBusy} onClick={() => { setToolsMenuOpen(false); void runtimeAction("stop"); }}><Pause size={13} />停止</button>
                  <button onClick={() => { setToolsMenuOpen(false); void refreshRuntimeLogs(); }}><PanelBottom size={13} />日志</button>
                  <button onClick={() => { setToolsMenuOpen(false); void syncFromRuntime(); }}><Wifi size={13} />同步真机</button>
                </div>
              </section>
              <section>
                <h3>工具集</h3>
                <div className="tools-actions">
                  <button onClick={() => { setToolsMenuOpen(false); setCompressOpen(true); }}><Image size={13} />图片压缩</button>
                  <button onClick={() => { setToolsMenuOpen(false); setTipsOpen(true); }}><Lightbulb size={13} />开发技巧</button>
                  <button onClick={() => { setToolsMenuOpen(false); setNewbieGuideOpen(true); }}><Sparkles size={13} />新手引导</button>
                  {window.tapMakerWork?.updates && (
                    <button
                      disabled={Boolean(desktopUpdateBusy) || desktopUpdate?.phase === "checking"}
                      onClick={() => { setToolsMenuOpen(false); void runDesktopUpdateAction("check"); }}
                    >
                      <RefreshCw size={13} />检查更新
                    </button>
                  )}
                </div>
              </section>
              <section>
                <h3>快捷入口</h3>
                <div className="tools-actions">
                  <button onClick={() => { setToolsMenuOpen(false); openExternalUrl("https://developer.taptap.cn/"); }}><ExternalLink size={13} />开发者后台</button>
                  <button onClick={() => { setToolsMenuOpen(false); openExternalUrl("https://maker.taptap.cn/"); }}><ExternalLink size={13} />Maker 后台</button>
                  <button onClick={() => { setToolsMenuOpen(false); openExternalUrl("https://www.taptap.cn/user/59693183/works"); }}><Gamepad2 size={13} />作者游戏品鉴</button>
                  <button onClick={() => { setToolsMenuOpen(false); setSponsorOpen(true); }}><Heart size={13} />赞赏作者</button>
                  <button onClick={() => { setToolsMenuOpen(false); openExternalUrl(QQ_GROUP_JOIN_URL); }}><MessageCircle size={13} />一键入群</button>
                  <button onClick={() => { setToolsMenuOpen(false); setRoadmapOpen(true); }}><Map size={13} />后续规划</button>
                </div>
              </section>
            </div>
          )}
        </div>
        <span className="mode-hint">
          {centerTab === "visual"
            ? "结构编辑：拖动改位置 · 控制点改尺寸 · 右键管理节点 · 自动保存"
            : mode === "live-edit"
            ? "实时编辑：编辑视图与实际 Runtime 同步 · Shift 多选 · W/E/R/T 变换"
            : "检查：单击只选中，源码跳转需显式点击"}
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
                {qrImageFailed ? (
                  <div className="qr-image-error" role="alert"><QrCode size={36} /><strong>二维码图片加载失败</strong><span>链接仍可复制；也可以重新生成后重试。</span></div>
                ) : (
                  <img className="qr-image" src={`${API}/api/maker/qrcode/image?revision=${encodeURIComponent(makerMeta.qrcodeGeneratedAt || "latest")}`} alt="Maker 测试二维码" onError={() => setQrImageFailed(true)} />
                )}
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

      {guideOpen && (
        <section className="overlay-panel panel guide-panel" aria-label="使用说明">
          <div className="overlay-heading"><strong>使用说明</strong><button onClick={() => setGuideOpen(false)}>关闭</button></div>
          <div className="guide-list">
            <article>
              <h3>打开项目</h3>
              <p>欢迎页选择 TapTap Maker 项目。打开时会自动接入实时编辑桥，不用再手动点「接入桥」。</p>
            </article>
            <article>
              <h3>启动 Runtime</h3>
              <p>绿色「启动」会打开官方运行器的独立窗口。等游戏离开加载画面后，画面和控件树才会稳定。</p>
            </article>
            <article>
              <h3>结构编辑</h3>
              <p>在结构草图里拖节点、改属性、右键新建。改的是界面草稿，适合先把布局搭出来。</p>
            </article>
            <article>
              <h3>实时编辑</h3>
              <p>在真实 Runtime 画面上选控件、移动和缩放，并写回正在运行的界面。需要 Runtime 已启动，且编辑桥已连上。加载界面没有控件树，这时点不了。</p>
            </article>
            <article>
              <h3>右侧与中间</h3>
              <p>右侧看属性、事件和动画。中间可以切代码、交付工作台。标题栏的搜索能按关键词跳到源码行。</p>
            </article>
            <article>
              <h3>游玩点击已关闭</h3>
              <p>IDE 里点画面不会再把点击送进游戏，避免 Runtime 被重启。要试玩请直接操作独立的 Runtime 窗口。</p>
            </article>
          </div>
        </section>
      )}

      {tipsOpen && (
        <DevTipsPanel
          onClose={() => setTipsOpen(false)}
          onCopy={(text) => void copyText(text)}
          onOpenExternal={openExternalUrl}
        />
      )}

      {compressOpen && (
        <ImageCompressPanel
          apiBase={API}
          {...(project.root ? { projectRoot: project.root } : {})}
          onClose={() => setCompressOpen(false)}
          onCopy={(text) => void copyText(text)}
          onOpenExternal={openExternalUrl}
        />
      )}

      {settingsOpen && (
        <section className="overlay-panel panel settings-panel" aria-label="设置">
          <div className="overlay-heading"><strong>设置 / 系统</strong><button onClick={() => setSettingsOpen(false)}>关闭</button></div>
          <div className="settings-grid">
            <div><h3>连接</h3><p>Bridge：{API}</p><p>协议：{String((systemInfo as { protocolVersion?: number } | undefined)?.protocolVersion ?? health ? 1 : "—")}</p><p>Node：{String((systemInfo as { node?: string } | undefined)?.node ?? "—")}</p><p>平台：{String((systemInfo as { platform?: string } | undefined)?.platform ?? "—")}</p></div>
            <div><h3>Maker</h3><p>版本：{health?.makerVersion || "未发现"}</p><p>项目：{project.root}</p><p>当前 UI：{String((systemInfo as { activeUiEntry?: string } | undefined)?.activeUiEntry ?? activeUiPath)}</p></div>
            {window.tapMakerWork?.hardwareAcceleration && desktopHardware && (
              <section className="desktop-system-card" aria-labelledby="hardware-acceleration-heading">
                <div className="desktop-card-heading">
                  <div><h3 id="hardware-acceleration-heading">硬件加速</h3><p>默认关闭。开启后使用 GPU 渲染 IDE 与 Web 预览，需重启应用生效。</p></div>
                  <span className={desktopHardware.active ? "ready" : "neutral"}>{desktopHardware.active ? "运行中" : "已关闭"}</span>
                </div>
                <label className="settings-switch-row">
                  <span><Cpu size={15} /><strong>启用硬件加速</strong><small>遇到花屏、驱动崩溃或远程桌面兼容问题时请保持关闭。</small></span>
                  <input type="checkbox" checked={desktopHardware.enabled} disabled={hardwareBusy} onChange={(event) => void setHardwareAcceleration(event.target.checked)} />
                </label>
                {desktopHardware.restartRequired && <div className="desktop-card-actions"><span className="desktop-card-note">设置已更改，重启后生效。</span><button className="primary" onClick={() => void window.tapMakerWork?.hardwareAcceleration?.restart()}>立即重启</button></div>}
              </section>
            )}
            {window.tapMakerWork?.legal && (
              <section className="desktop-system-card" aria-labelledby="legal-settings-heading">
                <div className="desktop-card-heading">
                  <div><h3 id="legal-settings-heading">用户协议与隐私</h3><p>{desktopLegal?.acceptedAt ? `已于 ${new Date(desktopLegal.acceptedAt).toLocaleString()} 接受` : "首次使用前需要确认"}</p></div>
                  <ScrollText size={18} />
                </div>
                <div className="desktop-card-actions"><button onClick={() => setLegalDialogOpen(true)}>查看 EULA 与隐私政策</button></div>
              </section>
            )}
            {window.tapMakerWork?.telemetry && desktopTelemetry && (
              <section className="desktop-system-card" aria-labelledby="telemetry-settings-heading">
                <div className="desktop-card-heading">
                  <div>
                    <h3 id="telemetry-settings-heading">匿名使用统计（GameAlgo）</h3>
                    <p>上报到国内 GameAlgo。不上传项目路径、源码或 Maker 凭证。本机仍显示使用时长。</p>
                  </div>
                  <span className={desktopTelemetry.enabled ? "ready" : "neutral"}>{desktopTelemetry.enabled ? "已开启" : "已关闭"}</span>
                </div>
                <label className="settings-switch-row">
                  <span><Clock3 size={15} /><strong>发送匿名使用统计</strong><small>关闭后停止 GameAlgo 上报；本机累计时长仍可查看。</small></span>
                  <input type="checkbox" checked={desktopTelemetry.enabled} disabled={telemetryBusy} onChange={(event) => void setTelemetryEnabled(event.target.checked)} />
                </label>
                <div className="desktop-permission-rows">
                  <div><span>本次会话</span><strong>{desktopTelemetry.sessionLabel}</strong></div>
                  <div><span>本次活跃</span><strong>{desktopTelemetry.activeLabel}</strong></div>
                  <div><span>累计活跃</span><strong>{desktopTelemetry.lifetimeActiveLabel}</strong></div>
                  <div><span>累计启动</span><strong>{desktopTelemetry.sessionCount} 次</strong></div>
                </div>
                <p className="desktop-card-note">
                  看板：{desktopTelemetry.dashboardUrl}
                  {desktopTelemetry.gameKeyConfigured ? " · Client Key 已配置" : " · 缺少 ga_live Client Key"}
                </p>
                <div className="desktop-card-actions">
                  <button onClick={() => window.open(desktopTelemetry.dashboardUrl, "_blank", "noopener,noreferrer")}>打开 GameAlgo 后台</button>
                </div>
              </section>
            )}
            {window.tapMakerWork?.permissions && desktopPermissions && (
              <section className="desktop-system-card" aria-labelledby="desktop-permissions-heading">
                <div className="desktop-card-heading">
                  <div><h3 id="desktop-permissions-heading">系统授权</h3><p>真实 Runtime 画面需要屏幕录制。</p></div>
                  <span className={desktopPermissions.ready ? "ready" : "attention"}>{desktopPermissions.ready ? "已就绪" : "需处理"}</span>
                </div>
                <div className="desktop-permission-rows">
                  {([[
                    "screen", "屏幕录制", desktopPermissions.screen
                  ], [
                    "accessibility", "辅助功能", desktopPermissions.accessibility
                  ]] as const).map(([key, label, value]) => <div key={key}>
                    <span>{value === "granted" ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}{label}</span>
                    <strong>{value === "granted" ? "已授权" : "未授权"}</strong>
                    <button disabled={value === "granted" || Boolean(permissionBusy)} onClick={() => void runPermissionAction(key)}>{value === "granted" ? "完成" : "打开设置"}</button>
                  </div>)}
                </div>
                <div className="desktop-card-actions">
                  <button onClick={() => setPermissionGuideOpen(true)}>查看授权向导</button>
                  <button onClick={() => void runPermissionAction("refresh")} disabled={Boolean(permissionBusy)}><RefreshCw size={13} />重新检测</button>
                  <button onClick={() => void runPermissionAction("confirm")} disabled={Boolean(permissionBusy)}><CheckCircle2 size={13} />{permissionConfirmed ? "已确认授权" : "我已授权"}</button>
                  <button className="primary" onClick={() => void runPermissionAction("restart")} disabled={!desktopPermissions.ready && !permissionConfirmed}>重启应用</button>
                </div>
                {!desktopPermissions.stableIdentity && <p className="desktop-card-note">开发模式的授权归属 Electron；请用签名后的正式安装包在新机器授权。</p>}
              </section>
            )}
            {window.tapMakerWork?.updates && desktopUpdate && (
              <section className="desktop-system-card" aria-labelledby="desktop-update-heading">
                <div className="desktop-card-heading">
                  <div>
                    <h3 id="desktop-update-heading">应用更新</h3>
                    <p>
                      版本清单 version.json · 当前 {desktopUpdate.currentVersion}
                      {desktopUpdate.availableVersion && desktopUpdate.availableVersion !== desktopUpdate.currentVersion
                        ? ` · 可更新 ${desktopUpdate.availableVersion}`
                        : ""}
                      {desktopUpdate.source ? ` · 来源 ${desktopUpdate.source}` : ""}
                    </p>
                  </div>
                  <span className={desktopUpdate.phase === "error" ? "attention" : desktopUpdate.phase === "available" ? "ready" : "neutral"}>
                    {desktopUpdate.phase === "checking" ? "检查中"
                      : desktopUpdate.phase === "available" ? "有新版本"
                      : desktopUpdate.phase === "downloading" ? "下载中"
                      : desktopUpdate.phase === "downloaded" ? "待重启"
                      : desktopUpdate.phase === "up-to-date" ? "最新"
                      : desktopUpdate.phase === "error" ? "失败"
                      : "就绪"}
                  </span>
                </div>
                {(desktopUpdate.phase === "downloading" || desktopUpdate.phase === "downloaded") && (
                  <div className="update-progress" aria-label={`更新下载 ${Math.round(desktopUpdate.percent || 0)}%`}>
                    <i style={{ width: `${desktopUpdate.percent || 0}%` }} />
                    <span>{Math.round(desktopUpdate.percent || 0)}%</span>
                  </div>
                )}
                {desktopUpdate.notes && desktopUpdate.notes.length > 0 && desktopUpdate.phase === "available" && (
                  <ul className="update-notes compact">
                    {desktopUpdate.notes.map((note) => <li key={note}>{note}</li>)}
                  </ul>
                )}
                {desktopUpdate.message && (
                  <p className={desktopUpdate.phase === "error" ? "desktop-card-error" : "desktop-card-note"} role="status">
                    {desktopUpdate.message}
                  </p>
                )}
                <div className="desktop-card-actions">
                  <button
                    disabled={Boolean(desktopUpdateBusy) || desktopUpdate.phase === "checking" || desktopUpdate.phase === "downloading"}
                    onClick={() => void runDesktopUpdateAction("check")}
                  >
                    <RefreshCw size={13} className={desktopUpdate.phase === "checking" ? "spin" : ""} />检查更新
                  </button>
                  {desktopUpdate.phase === "available" && (
                    <>
                      <button className="primary" disabled={Boolean(desktopUpdateBusy)} onClick={() => void runDesktopUpdateAction("download")}>
                        <Download size={13} />立即更新
                      </button>
                      <button disabled={Boolean(desktopUpdateBusy) || Boolean(desktopUpdate.force)} onClick={() => void runDesktopUpdateAction("snooze")}>
                        暂不更新
                      </button>
                      <button disabled={Boolean(desktopUpdateBusy) || Boolean(desktopUpdate.force)} onClick={() => void runDesktopUpdateAction("mute")}>
                        不再提醒
                      </button>
                    </>
                  )}
                  {desktopUpdate.phase === "downloaded" && (
                    <button className="primary" onClick={() => void runDesktopUpdateAction("restart")}>立即重启安装</button>
                  )}
                </div>
                <div className="repository-links" aria-label="TapMakerWork 官网与代码仓库">
                  <button onClick={() => openExternalUrl(desktopUpdate.siteUrl || OFFICIAL_SITE_URL)}><ExternalLink size={14} />官网</button>
                  <button onClick={() => openExternalUrl("https://github.com/AndroidSix/TapMakerWork")}><ExternalLink size={14} />GitHub 主仓</button>
                  <button onClick={() => openExternalUrl(desktopUpdate.releaseUrl || "https://gitee.com/AndroidSUP/tap-maker-work/releases")}><ExternalLink size={14} />发行版</button>
                </div>
              </section>
            )}
            <section className="desktop-system-card community-card" aria-labelledby="community-heading">
              <div className="desktop-card-heading">
                <div>
                  <h3 id="community-heading">社区交流</h3>
                  <p>{QQ_GROUP_NAME} · 群号 {QQ_GROUP_ID}。反馈问题、讨论用法、获取后续功能动态。{community.source && community.source !== "builtin" ? `（来自 ${community.source === "gitee" ? "Gitee" : "GitHub"}）` : ""}</p>
                </div>
                <span className="ready">QQ</span>
              </div>
              <div className="desktop-card-actions">
                <button className="primary" onClick={() => openExternalUrl(QQ_GROUP_JOIN_URL)}><Users size={13} />一键入群</button>
                <button onClick={() => void copyText(QQ_GROUP_ID)}><Copy size={13} />复制群号</button>
                <button onClick={() => setRoadmapOpen(true)}><Map size={13} />后续规划</button>
                <button onClick={() => openExternalUrl(OFFICIAL_SITE_URL)}><ExternalLink size={13} />官网</button>
              </div>
            </section>
            <section className="maker-version-settings" aria-labelledby="maker-version-heading">
              <div className="maker-version-heading">
                <div>
                  <h3 id="maker-version-heading">Maker MCP 版本</h3>
                  <p>默认跟随本机环境，也可固定稳定版、Beta 或某个已安装版本。</p>
                </div>
                <button
                  className="maker-check-button"
                  onClick={() => void checkMakerUpdates()}
                  disabled={Boolean(makerVersionBusy)}
                  aria-busy={makerVersionBusy === "check"}
                >
                  <RefreshCw size={13} className={makerVersionBusy === "check" ? "spin" : ""} aria-hidden="true" />
                  {makerVersionBusy === "check" ? "检查中…" : "检查更新"}
                </button>
              </div>

              <button
                className={`maker-auto-option ${makerVersions?.preference.mode === "device" ? "active" : ""}`}
                onClick={() => void selectMakerVersion("device")}
                disabled={Boolean(makerVersionBusy) || makerVersions?.preference.mode === "device"}
                aria-pressed={makerVersions?.preference.mode === "device"}
              >
                <span><CheckCircle2 size={15} aria-hidden="true" />设备自动</span>
                <small>自动使用设备中版本最高的 Maker MCP，不锁定版本。</small>
                <strong>{makerVersions?.active?.version || "未发现本机版本"}</strong>
              </button>

              <div className="maker-channel-grid">
                {(["stable", "beta"] as const).map((channel) => {
                  const channelInfo = makerVersions?.channels[channel];
                  const active = makerVersions?.preference.mode === channel;
                  const label = channel === "stable" ? "稳定版" : "Beta 版";
                  const canInstall = Boolean(channelInfo?.latest && (channelInfo.updateAvailable || !channelInfo.installed));
                  return (
                    <article key={channel} className={`maker-channel-card ${active ? "active" : ""}`}>
                      <div className="maker-channel-title">
                        <strong>{label}</strong>
                        {active && <span><CheckCircle2 size={12} aria-hidden="true" />当前通道</span>}
                      </div>
                      <dl>
                        <div><dt>本机</dt><dd>{channelInfo?.installed || "未安装"}</dd></div>
                        <div><dt>最新</dt><dd>{channelInfo?.latest || "尚未检查"}</dd></div>
                      </dl>
                      <div className="maker-channel-actions">
                        {channelInfo?.installed && (
                          <button
                            onClick={() => void selectMakerVersion(channel)}
                            disabled={Boolean(makerVersionBusy) || active}
                          >{active ? "正在使用" : `切换到${label}`}</button>
                        )}
                        <button
                          className="primary"
                          onClick={() => void installMakerChannel(channel)}
                          disabled={Boolean(makerVersionBusy) || !canInstall}
                          aria-busy={makerVersionBusy === channel}
                        >
                          <Download size={13} aria-hidden="true" />
                          {makerVersionBusy === channel ? "安装中…" : canInstall ? `${channelInfo?.installed ? "更新" : "安装"} ${channelInfo?.latest}` : channelInfo?.latest ? "已是最新" : "先检查更新"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              <article className="node-version-card" aria-labelledby="node-version-heading">
                <div className="node-version-title">
                  <div>
                    <strong id="node-version-heading">系统 Node.js</strong>
                    <small>始终跟随系统 PATH / Homebrew / Volta 中的 Node.js；不再用托管目录覆盖本机版本。</small>
                  </div>
                  <span className={nodeVersions?.active.source === "device" ? "device" : "managed"}>
                    {nodeVersions?.active.source === "device" ? "已同步系统" : "内置兜底"}
                  </span>
                </div>
                <dl>
                  <div><dt>系统</dt><dd>{nodeVersions?.device?.version || "未发现"}</dd></div>
                  <div><dt>当前使用</dt><dd>{nodeVersions?.active.version || "—"}</dd></div>
                  <div><dt>最新 LTS</dt><dd>{nodeVersions?.stable.latest || "尚未检查"}</dd></div>
                </dl>
                <button
                  className="primary"
                  onClick={() => void syncSystemNode()}
                  disabled={Boolean(makerVersionBusy)}
                  aria-busy={makerVersionBusy === "node"}
                >
                  <RefreshCw size={13} className={makerVersionBusy === "node" ? "spin" : ""} aria-hidden="true" />
                  {makerVersionBusy === "node" ? "同步中…" : "重新同步系统版本"}
                </button>
                {nodeVersions?.stable.updateAvailable && <small className="node-update-hint">系统 Node.js 低于最新 LTS {nodeVersions.stable.latest}，请用系统包管理器升级后重新同步。</small>}
              </article>

              <details className="maker-installed-list">
                <summary>已安装版本（{makerVersions?.installed.length ?? 0}）</summary>
                <div>
                  {makerVersions?.installed.length ? makerVersions.installed.map((runtime) => {
                    const active = makerVersions.active?.version === runtime.version;
                    const pinned = makerVersions.preference.mode === "version" && makerVersions.preference.version === runtime.version;
                    return (
                      <button
                        key={runtime.version}
                        onClick={() => void selectMakerVersion("version", runtime.version)}
                        disabled={Boolean(makerVersionBusy) || pinned}
                      >
                        <span>{active && <CheckCircle2 size={13} aria-hidden="true" />}{runtime.version}</span>
                        <small>{pinned ? "已固定" : active ? "当前生效" : "使用此版本"}</small>
                      </button>
                    );
                  }) : <p>没有发现本机 Maker MCP。</p>}
                </div>
              </details>
              <p className="maker-version-status" role="status" aria-live="polite">
                {makerVersions?.checkedAt ? `上次检查：${new Date(makerVersions.checkedAt).toLocaleString()}` : "尚未联网检查更新"}
              </p>
            </section>
            <div><h3>Runtime 适配器</h3><p>{adapterExport || (health?.runtimeAdapter?.installed ? `已安装：${health.runtimeAdapter.paths.join(", ")}` : "未安装到当前 Maker 项目")}</p><p>后端：{health?.uiBackend || health?.runtimeAdapter?.backend || "自动检测"} · Session：{health?.runtimeSessionId || "未连接"}</p><button onClick={() => void exportRuntimeAdapter()}>导出接入包到 outputs/runtime-adapter</button></div>
            <div><h3>能力</h3><p>Maker CLI：{health?.capabilities.makerCli ? "可用" : "不可用"}</p><p>UI Bridge：{health?.capabilities.uiBridge ? "可用" : "不可用"}</p><p>Runtime 帧：{health?.capabilities.runtimeFrames ? "可用" : "未接入"}</p><p>Shell 沙箱：{health?.capabilities.shellSandbox ? "就绪" : "锁定"}</p></div>
          </div>
        </section>
      )}

      <section
        className="workspace"
        style={{ gridTemplateColumns: `${layout.left}px 5px minmax(320px, 1fr) 5px ${layout.right}px` }}
      >
        <aside className="left-pane panel">
          <nav className="pane-tabs left-resource-tabs" aria-label="资源导航">
            <Tip label="项目文件">
              <button aria-label="项目文件" title="项目文件" aria-pressed={leftTab === "files"} className={leftTab === "files" ? "active" : ""} onClick={() => setLeftTab("files")}><Files size={14} /><span className="pane-tab-label">文件</span></button>
            </Tip>
            <Tip label="UI 界面列表">
              <button aria-label="UI 界面列表" title="UI 界面列表" aria-pressed={leftTab === "screens"} className={leftTab === "screens" ? "active" : ""} onClick={() => setLeftTab("screens")}><MonitorPlay size={14} /><span className="pane-tab-label">界面</span></button>
            </Tip>
            <Tip label="控件树">
              <button aria-label="控件树" title="控件树" aria-pressed={leftTab === "hierarchy"} className={leftTab === "hierarchy" ? "active" : ""} onClick={() => setLeftTab("hierarchy")}><Layers3 size={14} /><span className="pane-tab-label">层级</span></button>
            </Tip>
            <Tip label="图片资源">
              <button aria-label="图片资源" title="图片资源" aria-pressed={leftTab === "assets"} className={leftTab === "assets" ? "active" : ""} onClick={() => setLeftTab("assets")}><Image size={14} /><span className="pane-tab-label">资源</span></button>
            </Tip>
            <Tip label="Git 版本管理">
              <button aria-label="Git 版本管理" title="Git 版本管理" aria-pressed={leftTab === "git"} className={leftTab === "git" ? "active" : ""} onClick={() => { setLeftTab("git"); void loadGitStatus(); }}><GitBranch size={14} /><span className="pane-tab-label">Git</span></button>
            </Tip>
          </nav>
          <div className={`pane-body ${leftTab === "hierarchy" ? "hierarchy-pane-body" : ""}`}>
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
                    <option value="Node">空节点</option>
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
                  <Tip label="删除当前节点（根节点不可删）。已接入 Runtime 时会立即销毁真实控件。">
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
                <div className="hierarchy-tree-scroll" ref={hierarchyTreeRef}>
                  <HierarchyNode
                    node={snapshot.root}
                    selectedId={snapshot.selectedId}
                    selectedIds={selectedNodeIds}
                    onSelect={(id, additive) => {
                      selectCanvasNode(id, additive);
                      if (renamingId && renamingId !== id) setRenamingId(null);
                    }}
                    onContextMenuId={openNodeContextMenu}
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
              </div>
            )}
            {leftTab === "files" && (files.length ? files.map((entry) => <FileTreeEntry key={entry.path} entry={entry} depth={0} selectedPath={selectedFile} onOpen={(path) => void readFile(path)} />) : <p className="empty-state">项目目录为空。点击顶部项目名称可重新选择目录。</p>)}
            {leftTab === "screens" && <div className="screen-list">
              <div className="screen-list-heading"><span>检测到 {screens.length} 个 UI 入口</span><button onClick={() => void rescanUiScreens()} disabled={screensBusy} aria-busy={screensBusy} aria-label="重新扫描整个 scripts 目录"><RefreshCw size={13} className={screensBusy ? "spin" : ""} aria-hidden="true" /></button></div>
              {screens.map((screen) => <button key={screen.path} title={screen.path} className={`screen-row ${activeUiPath === screen.path ? "active" : ""}`} onClick={() => void openUiScreen(screen.path)}>
                <MonitorPlay size={15} /><span><strong>{screen.name}</strong><small>{screenLabel(screen)}</small></span>{activeUiPath === screen.path && <span className="active-dot" />}
              </button>)}
            </div>}
            {leftTab === "assets" && <div className="asset-list">
              <div className="screen-list-heading"><span>{assets.length ? `${assets.length} 个游戏素材` : "项目素材"}</span><button onClick={() => { void loadAssets(); void loadWorkflow(); }} aria-label="刷新资源"><RefreshCw size={13} /></button></div>
              {assets.length === 0 ? <p className="empty-state">未发现图片、音频、视频或模型素材。</p> : assets.slice(0, 160).map((asset) => {
                const status = asset.status ?? "unreferenced";
                const statusLabel = status === "referenced" ? `已绑定 ${asset.referencedBy?.length || 0}` : status === "external" ? "外部采纳" : "待确认";
                const statusClass = status === "referenced" ? "asset-bound" : status === "external" ? "asset-external" : "asset-unbound";
                const toastMessage = status === "referenced" ? `已绑定：${asset.path}` : status === "external" ? `外部采纳（来自 Windows 绝对路径）：${asset.path}` : `待确认：${asset.path}`;
                const toastKind = status === "referenced" ? "success" : status === "external" ? "info" : "warn";
                return (
                  <button key={asset.path} className="file-row asset-row" onClick={() => toast(toastMessage, toastKind)} title={`${asset.path}${asset.referencedBy?.length ? `\n引用：${asset.referencedBy.join(", ")}` : "\n未发现源码引用"}`}>
                    {asset.kind === "audio" ? <Music2 size={14} /> : asset.kind === "video" ? <Video size={14} /> : asset.kind === "model" ? <Box size={14} /> : <Image size={14} />}
                    <span>{asset.name}</span>
                    <small className={statusClass}>{statusLabel}</small>
                  </button>
                );
              })}
            </div>}
            {leftTab === "git" && <div className="git-panel">
              <header className="git-panel-head">
                <div><span>源代码管理</span><strong><GitBranch size={14} />{gitStatus?.branch || "未识别分支"}</strong></div>
                <div>
                  <button className="icon-command" aria-label="拉取远端修改" title="拉取" disabled={Boolean(gitBusy)} onClick={() => void runGitAction("pull")}><Download size={13} /></button>
                  <button className="icon-command" aria-label="刷新 Git 状态" title="刷新" onClick={() => void loadGitStatus()}><RefreshCw size={13} /></button>
                </div>
              </header>
              <div className="git-sync-status">
                <span title={gitStatus?.upstream || "尚未绑定上游"}>{gitStatus?.upstream || "未绑定上游"}</span>
                <small>↑ {gitStatus?.ahead || 0}</small><small>↓ {gitStatus?.behind || 0}</small>
              </div>
              <div className="git-commit-box">
                <input value={gitCommitMessage} onChange={(event) => setGitCommitMessage(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void runGitAction("commit"); }} placeholder={`消息（⌘/Ctrl+Enter 在“${gitStatus?.branch || "当前分支"}”提交）`} aria-label="Git 提交说明" />
                <button className="primary" disabled={Boolean(gitBusy) || !gitCommitMessage.trim() || !gitStatus?.dirty} onClick={() => void runGitAction("commit")}><Save size={14} />{gitBusy === "commit" ? "提交中…" : "提交"}</button>
              </div>

              {Boolean(gitStatus?.changes?.some((change) => change.staged)) && <section className="git-change-group">
                <header className="git-change-header" tabIndex={0} aria-label="暂存的更改；右键打开批量操作" onContextMenu={(event) => { event.preventDefault(); setGitFileMenu(null); setGitGroupMenu({ scope: "staged", x: Math.min(event.clientX, window.innerWidth - 230), y: Math.min(event.clientY, window.innerHeight - 130) }); }} onKeyDown={(event) => { if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setGitFileMenu(null); setGitGroupMenu({ scope: "staged", x: Math.min(rect.left + 12, window.innerWidth - 230), y: Math.min(rect.bottom, window.innerHeight - 130) }); }}><strong>暂存的更改</strong><span>{gitStatus?.changes?.filter((change) => change.staged).length}</span><button className="icon-command" aria-label="取消暂存全部" title="取消暂存全部" onClick={() => void runGitFileAction("unstage-all")}><Undo2 size={12} /></button></header>
                <div className="git-file-list">
                  {gitStatus?.changes?.filter((change) => change.staged).map((change) => <div key={`staged:${change.path}`} className={`git-file-row ${change.conflicted ? "conflicted" : ""} ${centerTab === "git-diff" && gitDiff?.path === change.path && gitDiff.scope === "staged" ? "active" : ""}`} onContextMenu={(event) => { event.preventDefault(); setGitGroupMenu(null); setGitFileMenu({ change, scope: "staged", x: Math.min(event.clientX, window.innerWidth - 230), y: Math.min(event.clientY, window.innerHeight - 210) }); }}>
                    <button className="git-file-open" title={`${change.path} · 点击查看暂存差异`} onClick={() => void openGitDiff(change, "staged")}><FileCode2 size={13} /><span><strong>{fileName(change.path)}</strong><small>{change.path.includes("/") ? change.path.slice(0, change.path.lastIndexOf("/")) : "项目根目录"}</small></span><code>{change.indexStatus}</code></button>
                    <button className="git-file-action" aria-label={`取消暂存 ${change.path}`} title="取消暂存" onClick={() => void runGitFileAction("unstage", change)}><Undo2 size={12} /></button>
                  </div>)}
                </div>
              </section>}

              <section className="git-change-group">
                <header className="git-change-header" tabIndex={0} aria-label="更改；右键打开批量操作" onContextMenu={(event) => { event.preventDefault(); setGitFileMenu(null); setGitGroupMenu({ scope: "unstaged", x: Math.min(event.clientX, window.innerWidth - 230), y: Math.min(event.clientY, window.innerHeight - 150) }); }} onKeyDown={(event) => { if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setGitFileMenu(null); setGitGroupMenu({ scope: "unstaged", x: Math.min(rect.left + 12, window.innerWidth - 230), y: Math.min(rect.bottom, window.innerHeight - 150) }); }}><strong>更改</strong><span>{gitStatus?.changes?.filter((change) => change.unstaged).length || 0}</span>{Boolean(gitStatus?.changes?.some((change) => change.unstaged)) && <button className="icon-command" aria-label="暂存全部更改" title="暂存全部" onClick={() => void runGitFileAction("stage-all")}><Plus size={13} /></button>}</header>
                <div className="git-file-list">
                  {!gitStatus?.changes?.some((change) => change.unstaged) ? <p className="empty-state">工作区没有未暂存修改。</p> : gitStatus.changes.filter((change) => change.unstaged).map((change) => <div key={`changed:${change.path}`} className={`git-file-row ${change.conflicted ? "conflicted" : ""} ${centerTab === "git-diff" && gitDiff?.path === change.path && gitDiff.scope === "worktree" ? "active" : ""}`} onContextMenu={(event) => { event.preventDefault(); setGitGroupMenu(null); setGitFileMenu({ change, scope: "unstaged", x: Math.min(event.clientX, window.innerWidth - 230), y: Math.min(event.clientY, window.innerHeight - 210) }); }}>
                    <button className="git-file-open" title={`${change.path} · 点击查看工作区差异，右键查看更多操作`} onClick={() => void openGitDiff(change, "unstaged")}><FileCode2 size={13} /><span><strong>{fileName(change.path)}</strong><small>{change.path.includes("/") ? change.path.slice(0, change.path.lastIndexOf("/")) : "项目根目录"}</small></span><code>{change.untracked ? "U" : change.workTreeStatus}</code></button>
                    <button className="git-file-action" aria-label={`暂存 ${change.path}`} title="暂存更改" onClick={() => void runGitFileAction("stage", change)}><Plus size={13} /></button>
                  </div>)}
                </div>
              </section>

              <div className="git-actions">
                <button className="primary" disabled={Boolean(gitBusy) || !gitCommitMessage.trim()} onClick={() => void runGitAction("push-build")}><Rocket size={13} />{gitBusy === "push-build" ? "推送并刷新中…" : "提交、推送并刷新"}</button>
              </div>
              {gitConflictPlan && <section className="git-conflict-plan" role="alert">
                <strong><ShieldAlert size={14} />需要处理 Git 冲突</strong>
                <p>已生成保留本地修改的处理上下文，可一键复制给 AI。</p>
                <textarea readOnly value={gitConflictPlan} aria-label="可复制给 AI 的 Git 冲突处理上下文" />
                <button disabled={copyBusy} onClick={() => void copyText(gitConflictPlan)}><Copy size={13} />{copyBusy ? "正在复制…" : "复制给 AI"}</button>
              </section>}
              <section className="git-graph" aria-label="Git 提交图谱">
                <header><strong>图谱</strong><span>{gitStatus?.commits?.length || 0}</span></header>
                <div>{gitStatus?.commits?.map((commit, index) => <article key={commit.hash} title={`${commit.hash}\n${commit.author} · ${commit.relativeDate}`}>
                  <span className="git-graph-line"><i />{index < (gitStatus.commits?.length || 0) - 1 && <b />}</span>
                  <div><strong>{commit.subject}</strong><small><code>{commit.shortHash}</code>{commit.relativeDate}</small></div>
                  {commit.refs.slice(0, 1).map((ref) => <em key={ref}>{ref.replace(/^HEAD -> /, "")}</em>)}
                </article>)}</div>
              </section>
            </div>}
          </div>
        </aside>
        <PanelResizer orientation="col" label="调节左侧栏宽度" onPointerDown={beginLayoutDrag("left")} />

        <div className="center-pane-host">
        <section
          className={`center-pane panel ${previewDockOpen && centerTab !== "runtime" ? "with-preview-dock" : ""} ${floatingWorkspace ? "floating-workspace" : ""}`}
          style={floatingWorkspace ? { left: floatingWorkspace.x, top: floatingWorkspace.y, width: floatingWorkspace.width, height: floatingWorkspace.height } : undefined}
        >
          <nav ref={documentTabsRef} className="document-tabs" onPointerDown={beginFloatingWorkspaceMove}>
            {floatingWorkspace && <span className="floating-workspace-grip" title="拖回顶部标签栏即可重新停靠"><GripVertical size={14} /></span>}
            {documentTabs.map((tab) => {
              const isActive = tab === "preview" ? previewDockOpen : centerTab === tab;
              const activate = () => {
                if (tab === "preview") {
                  const next = !previewDockOpen;
                  setPreviewDockOpen(next);
                  if (next) void loadPreviewPanel();
                } else if (tab === "workflow") {
                  setCenterTab("workflow");
                  void loadWorkflow();
                } else if (tab === "visual") {
                  setMode("inspect");
                  setCanvasAutoFit(true);
                  setCenterTab("visual");
                } else if (tab === "runtime") {
                  setMode(mode === "live-edit" ? "live-edit" : "inspect");
                  setCenterTab("runtime");
                  setPreviewDockOpen(false);
                } else {
                  setCenterTab("code");
                }
              };
              return (
                <button
                  key={tab}
                  draggable
                  data-document-tab={tab}
                  aria-pressed={isActive}
                  className={isActive ? "active" : ""}
                  title="拖动可排序；拖出标签栏可浮动"
                  onClick={activate}
                  onDragStart={(event) => {
                    // The panel that leaves the dock must match the tab under
                    // the pointer, even when the user starts dragging an
                    // inactive tab.
                    if (tab === "preview") {
                      if (!previewDockOpen) {
                        setPreviewDockOpen(true);
                        void loadPreviewPanel();
                      }
                    } else {
                      activate();
                    }
                    setDraggedDocumentTab(tab);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", tab);
                  }}
                  onDragOver={(event) => { event.preventDefault(); reorderDocumentTab(tab); }}
                  onDragEnd={finishDocumentTabDrag}
                  onKeyDown={(event) => {
                    if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
                    event.preventDefault();
                    moveDocumentTab(tab, event.key === "ArrowLeft" ? -1 : 1);
                  }}
                >
                  {tab === "workflow" ? <LayoutDashboard size={14} />
                    : tab === "visual" ? <SlidersHorizontal size={14} />
                      : tab === "runtime" ? <MonitorPlay size={14} />
                        : tab === "code" ? <Code2 size={14} /> : <Columns2 size={14} />}
                  {tab === "workflow" ? "交付工作台"
                    : tab === "visual" ? `结构草图 · ${fileName(activeUiPath).replace(/\.lua$/i, ".ui")}`
                      : tab === "runtime" ? "运行时场景"
                        : tab === "code" ? fileName(selectedFile) : "Web 预览"}
                  {tab === "code" && codeDirty && <span className="dirty-dot" aria-label="有未保存更改">●</span>}
                </button>
              );
            })}
            {gitDiff && <div className="git-diff-document-tab">
              <button type="button" className={centerTab === "git-diff" ? "active" : ""} aria-pressed={centerTab === "git-diff"} title={gitDiff.path} onClick={() => setCenterTab("git-diff")}><Columns2 size={14} />{fileName(gitDiff.path)} <code>{gitDiff.scope === "staged" ? "暂存" : "工作区"}</code></button>
              <button type="button" className="git-diff-tab-close" aria-label={`关闭 ${gitDiff.path} 差异`} title="关闭差异" onClick={() => { setGitDiff(null); if (centerTab === "git-diff") setCenterTab("code"); }}><X size={12} /></button>
            </div>}
            {floatingWorkspace && <button className="workspace-dock-button" type="button" title="重新停靠工作区" onClick={() => { setFloatingWorkspace(null); toast("工作区已重新停靠", "success"); }}><PanelTop size={14} />停靠</button>}
            {centerTab === "code" && <button className="document-save" onClick={() => void saveFile()} disabled={!codeDirty || saveState === "saving"} title="保存 (⌘/Ctrl S)"><Save size={14} />{saveState === "saving" ? "保存中" : saveState === "saved" ? "已保存" : saveState === "error" ? "失败" : "保存"}</button>}
          </nav>
          <div className={`center-body ${previewDockOpen && centerTab !== "runtime" ? "split" : ""}`}>
            <div className="center-main">
              {centerTab === "workflow" ? (
                <ProjectCockpit
                  overview={workflow}
                  loading={workflowLoading}
                  busyAction={workflowBusyAction}
                  onRefresh={() => void loadWorkflow()}
                  onAction={(action) => void runWorkflowAction(action)}
                  onObjectiveSaved={(nextObjective) => setWorkflow((current) => current ? { ...current, objective: nextObjective } : current)}
                  onToast={toast}
                />
              ) : centerTab === "git-diff" && gitDiff ? (
                <section className="git-diff-view" aria-label={`${gitDiff.path} Git 差异`}>
                  <header className="git-diff-toolbar">
                    <div>
                      <Columns2 size={15} />
                      <span><strong>{fileName(gitDiff.path)}</strong><small>{gitDiff.path}</small></span>
                    </div>
                    <div className="git-diff-meta">
                      <span>{gitDiff.scope === "staged" ? "HEAD ↔ 暂存区" : "暂存区 ↔ 工作区"}</span>
                      {gitDiff.added && <em>新增</em>}
                      {gitDiff.deleted && <em className="deleted">删除</em>}
                      {!gitDiff.loading && !gitDiff.error && !gitDiff.binary && <><code className="added">+{gitDiff.additions}</code><code className="deleted">−{gitDiff.deletions}</code></>}
                      <button type="button" disabled={gitDiff.deleted || gitDiff.loading} onClick={() => void readFile(gitDiff.path).catch(() => toast("该文件无法在代码编辑器中打开", "warn"))}><FileCode2 size={13} />打开文件</button>
                    </div>
                  </header>
                  <div className="git-diff-editor">
                    {gitDiff.loading ? <div className="git-diff-message"><RefreshCw className="spin" size={22} /><strong>正在读取修改内容…</strong><span>正在准备原始版本与当前版本。</span></div>
                      : gitDiff.error ? <div className="git-diff-message error"><AlertTriangle size={22} /><strong>无法显示更改</strong><span>{gitDiff.error}</span></div>
                        : gitDiff.binary ? <div className="git-diff-message"><FileCode2 size={22} /><strong>二进制文件无法进行文本比较</strong><span>文件状态仍可在左侧源代码管理中操作。</span></div>
                          : <DiffEditor
                            theme="vs-dark"
                            language={languageForFile(gitDiff.path)}
                            original={gitDiff.original}
                            modified={gitDiff.modified}
                            options={{
                              readOnly: true,
                              originalEditable: false,
                              automaticLayout: true,
                              renderSideBySide: true,
                              renderOverviewRuler: true,
                              minimap: { enabled: false },
                              fontSize: 13,
                              padding: { top: 12 },
                              scrollBeyondLastLine: false,
                              diffAlgorithm: "advanced"
                            }}
                          />}
                  </div>
                </section>
              ) : centerTab === "runtime" ? (
                <RuntimeMirror
                  runtimeLive={runtimeLive}
                  runtimeBusy={runtimeBusy}
                  runtimeConnected={Boolean(health?.runtimeSessionId)}
                  adapterInstalled={Boolean(health?.runtimeAdapter?.installed)}
                  installBusy={adapterInstallBusy}
                  projectName={project?.name || ""}
                  orientation={previewPanel?.orientation || (makerMeta.orientation === "landscape" ? "landscape" : "portrait")}
                  snapshot={snapshot}
                  snapshotSource={effectiveSource}
                  selectedIds={selectedNodeIds}
                  editRevision={runtimeEditRevision}
                  mode={mode}
                  coachRuntimeStart={coachRuntimeStart}
                  onCoachRuntimeStartDone={() => {
                    dismissCoachMark(COACH_RUNTIME_START_KEY);
                    setCoachRuntimeStart(false);
                  }}
                  onModeChange={(next) => { if (next !== "play") setMode(next); }}
                  onStart={() => { toast("正在启动 Maker 预览…", "info"); void runtimeAction("start"); }}
                  onInstallAdapter={() => void installRuntimeEditor()}
                  onSelect={selectCanvasNode}
                  onContextMenu={openNodeContextMenu}
                  onPatch={patchNodeById}
                  onToast={toast}
                />
              ) : centerTab === "visual" ? (
                <div className="canvas-area">
                  <div className="canvas-meta">
                    <span>真实画布 {Math.round(previewWidth)}×{Math.round(previewHeight)}</span>
                    <span>{snapshot?.viewport?.physicalWidth && snapshot?.viewport?.physicalHeight ? `物理 ${snapshot.viewport.physicalWidth}×${snapshot.viewport.physicalHeight}` : `DPR ${device.dpr}`}</span>
                    <span>可视化编辑</span>
                    <span className="canvas-source">画布：{canvasSourceLabel}</span>
                    {runtimeLive && (
                      <span className="canvas-source runtime-scene">
                        真机：{runtimeScene === "live" ? "活树可同步" : runtimeScene === "loading" ? "加载/启动画面" : "已连接"}
                      </span>
                    )}
                    <div className="canvas-transform-tools" role="toolbar" aria-label="结构草图变换工具">
                      {([
                        ["select", "Q", "选择", <MousePointer2 size={15} />],
                        ["move", "W", "移动", <Move size={15} />],
                        ["rotate", "E", "旋转", <RotateCw size={15} />],
                        ["scale", "R", "缩放", <Scaling size={15} />],
                        ["rect", "T", "矩形变换", <BoxSelect size={15} />]
                      ] as Array<[TransformTool, string, string, ReactNode]>).map(([tool, shortcut, label, icon]) => (
                        <button key={tool} type="button" className={canvasTool === tool ? "active" : ""} aria-pressed={canvasTool === tool} title={`${label} (${shortcut})`} onClick={() => setCanvasTool(tool)}>
                          {icon}<kbd>{shortcut}</kbd>
                        </button>
                      ))}
                      <button type="button" className={canvasSnapEnabled ? "active" : ""} aria-pressed={canvasSnapEnabled} title="吸附到 10px 网格；旋转吸附 15°" onClick={() => setCanvasSnapEnabled((enabled) => !enabled)}><Magnet size={15} /></button>
                    </div>
                    <div className="canvas-zoom" role="group" aria-label="场景缩放">
                      <button type="button" aria-label="缩小场景" title="缩小" onClick={() => { setCanvasAutoFit(false); setStageScale((value) => Math.max(.1, value - .1)); }}><ZoomOut size={13} /></button>
                      <input
                        type="range"
                        min="10"
                        max="400"
                        step="1"
                        value={Math.round(stageScale * 100)}
                        aria-label={`场景缩放 ${Math.round(stageScale * 100)}%`}
                        onChange={(event) => { setCanvasAutoFit(false); setStageScale(Number(event.target.value) / 100); }}
                      />
                      <output>{Math.round(stageScale * 100)}%</output>
                      <button type="button" aria-label="放大场景" title="放大" onClick={() => { setCanvasAutoFit(false); setStageScale((value) => Math.min(4, value + .1)); }}><ZoomIn size={13} /></button>
                      <button type="button" className={canvasAutoFit ? "active" : ""} aria-pressed={canvasAutoFit} title="一键最佳比例" onClick={applyBestCanvasScale}><Maximize2 size={13} />最佳</button>
                    </div>
                  </div>
                  <div
                    ref={canvasViewportRef}
                    className="canvas-viewport canvas-editor-viewport"
                    tabIndex={0}
                    aria-label="结构草图可视化编辑画布；拖动节点调整位置，拖动控制点调整大小，方向键微调位置"
                    onPointerDown={(event) => {
                      if (event.target === event.currentTarget) event.currentTarget.focus();
                    }}
                    onKeyDown={(event) => {
                      if (!snapshot?.selectedId || snapshot.selectedId === snapshot.root.id || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
                      event.preventDefault();
                      const node = findUiNode(snapshot.root, snapshot.selectedId);
                      if (!node) return;
                      const box = runtimeLayoutBox(node.props);
                      const step = event.shiftKey ? 10 : 1;
                      const left = box.x ?? (typeof node.props.left === "number" ? node.props.left : 0);
                      const top = box.y ?? (typeof node.props.top === "number" ? node.props.top : 0);
                      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
                      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
                      void patchNodeById(node.id, { position: "absolute", left: left + dx, top: top + dy }, { historyGroup: `canvas-nudge-${node.id}` });
                    }}
                  >
                    <div
                      ref={stageRef}
                      className="device-stage"
                      style={{ width: previewWidth * stageScale, height: previewHeight * stageScale }}
                    >
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
                            rootId={snapshot.root.id}
                            selectedId={snapshot.selectedId}
                            selectedIds={selectedNodeIds}
                            onSelect={selectCanvasNode}
                            onDragStart={beginNodeDrag}
                            onContextMenu={openNodeContextMenu}
                            mode={mode}
                            canvasTool={canvasTool}
                            editable
                          />
                        )}
                      </div>
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
                        拖动节点调整位置，拖动蓝色控制点调整大小；方向键微调，Shift + 方向键移动 10px。右键可创建、复制或删除节点。
                        <button type="button" onClick={() => void syncFromRuntime()}>从真机同步结构</button>
                        {" · 修改会自动写入 .ui.json"}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <Editor
                  theme="vs-dark"
                  language={languageForFile(selectedFile)}
                  value={code}
                  onChange={(value) => { setCode(value ?? ""); setCodeDirty(true); setSaveState("idle"); }}
                  onMount={onEditorMount}
                  options={{ readOnly: false, minimap: { enabled: false }, fontSize: 13, padding: { top: 14 }, automaticLayout: true }}
                />
              )}
            </div>
            {previewDockOpen && centerTab !== "runtime" && (
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
                    onClose={() => {
                      setPreviewDockOpen(false);
                      void window.tapMakerWork?.preview?.unmount().catch(() => undefined);
                      toast("预览已关闭", "info");
                    }}
                  />
                </aside>
              </>
            )}
          </div>
          {floatingWorkspace && <button
            className="floating-workspace-resize"
            type="button"
            aria-label="调整浮动工作区大小；方向键微调，Shift 加速"
            title="拖动调整窗口大小"
            onPointerDown={beginFloatingWorkspaceResize}
            onKeyDown={(event) => {
              const amount = event.shiftKey ? 40 : 10;
              const dx = event.key === "ArrowRight" ? amount : event.key === "ArrowLeft" ? -amount : 0;
              const dy = event.key === "ArrowDown" ? amount : event.key === "ArrowUp" ? -amount : 0;
              if (!dx && !dy) return;
              event.preventDefault();
              setFloatingWorkspace((current) => current ? {
                ...current,
                width: clamp(current.width + dx, 480, Math.max(480, window.innerWidth - current.x - 8)),
                height: clamp(current.height + dy, 340, Math.max(340, window.innerHeight - current.y - 8))
              } : current);
            }}
          />}
        </section>
        </div>
        <PanelResizer orientation="col" label="调节右侧属性栏宽度" onPointerDown={beginLayoutDrag("right", true)} />

        {centerTab === "workflow" ? <aside className="right-pane panel workflow-tools-pane">
          <nav className="pane-tabs"><button className="active" aria-pressed="true"><Rocket size={14} aria-hidden="true" />交付工具</button></nav>
          <div className="workflow-tools-body">
            <section>
              <span className="section-kicker">当前状态</span>
              <h3>{workflow?.score ?? 0} 分就绪</h3>
              <p>{workflow?.nextAction?.reason || "等待项目检查结果。"}</p>
              <button className="workflow-primary-tool" disabled={!workflow?.nextAction || workflowBusyAction === workflow.nextAction.action} onClick={() => workflow?.nextAction && void runWorkflowAction(workflow.nextAction.action)}><Play size={14} aria-hidden="true" />{workflow?.nextAction?.label || "暂无下一步"}</button>
            </section>
            <section>
              <span className="section-kicker">环境与项目</span>
              <div className="workflow-tool-grid">
                <button onClick={() => void runWorkflowAction("doctor")} disabled={workflowBusyAction === "doctor"}><Activity size={15} aria-hidden="true" /><strong>Doctor</strong><small>检查工具链与绑定</small></button>
                <button onClick={() => void runWorkflowAction("open-design")}><SlidersHorizontal size={15} aria-hidden="true" /><strong>设计</strong><small>编辑 UI 与旁路</small></button>
              </div>
            </section>
            <section>
              <span className="section-kicker">运行与证据</span>
              <div className="workflow-tool-grid">
                <button onClick={() => void runWorkflowAction("start-preview")} disabled={workflowBusyAction === "start-preview"}><CirclePlay size={15} aria-hidden="true" /><strong>启动预览</strong><small>官方 Maker Runtime</small></button>
                <button onClick={() => void runWorkflowAction("open-preview")}><Columns2 size={15} aria-hidden="true" /><strong>内嵌预览</strong><small>并排查看游戏流</small></button>
                <button onClick={() => void runWorkflowAction("generate-qrcode")} disabled={workflowBusyAction === "generate-qrcode"}><QrCode size={15} aria-hidden="true" /><strong>测试二维码</strong><small>生成测试入口</small></button>
              </div>
            </section>
            <section>
              <span className="section-kicker">提交与交付</span>
              <button className="workflow-build-tool" onClick={() => void runWorkflowAction("build")} disabled={workflowBusyAction === "build" || !health?.capabilities.makerCli}><Hammer size={15} aria-hidden="true" /><span><strong>远端构建</strong><small>显式触发，不会自动提交</small></span></button>
            </section>
          </div>
        </aside> : <aside className="right-pane panel">
          <nav className="pane-tabs">
            <button aria-pressed={inspectorTab === "properties"} className={inspectorTab === "properties" ? "active" : ""} onClick={() => setInspectorTab("properties")}><SlidersHorizontal size={14} />属性</button>
            <button aria-pressed={inspectorTab === "events"} className={inspectorTab === "events" ? "active" : ""} onClick={() => setInspectorTab("events")}><CirclePlay size={14} />事件</button>
            <button aria-pressed={inspectorTab === "animation"} className={inspectorTab === "animation" ? "active" : ""} onClick={() => setInspectorTab("animation")}><Sparkles size={14} />动画</button>
          </nav>
          {selected ? <div className="inspector-body">
            <div className="selection-heading"><span className="selection-icon">{iconForType(selected.type)}</span><div><strong>{selected.name}</strong><small>{selected.type} · {selected.id}</small></div></div>
            {inspectorTab === "properties" && <><section className="property-group"><h3>布局</h3>
              <InspectorField label="定位" property="position" value={selected.props.position} onCommit={patchNode} />
              <InspectorField label="X / 左" property="left" value={selected.props.left} onCommit={patchNode} />
              <InspectorField label="Y / 上" property="top" value={selected.props.top} onCommit={patchNode} />
              <InspectorField label="宽度" property="width" value={selected.props.width} onCommit={patchNode} />
              <InspectorField label="高度" property="height" value={selected.props.height} onCommit={patchNode} />
              <InspectorField label="旋转" property="rotate" value={selected.props.rotate} onCommit={patchNode} />
              <InspectorField label="缩放" property="transform.scale" value={selectedTransform.scale ?? 1} onCommit={(_property, value) => void patchNodeProps({ transform: { ...selectedTransform, scale: value } })} />
              <InspectorField label="间距" property="gap" value={selected.props.gap} onCommit={patchNode} />
              <InspectorField label="Flex 方向" property="flexDirection" value={selected.props.flexDirection} onCommit={patchNode} />
            </section>
            <section className="property-group"><h3>外观</h3>
              <InspectorField label="文字" property="text" value={selected.props.text} onCommit={patchNode} live />
              <InspectorField label="字号" property="fontSize" value={selected.props.fontSize} onCommit={patchNode} />
              <InspectorAssetField value={selected.props.backgroundImage} assets={assets} onCommit={patchNode} onAssetsChanged={loadAssets} toast={toast} />
              {selectedHasImage && <InspectorColorField label="图片颜色" property="color" value={selected.props.color ?? [255, 255, 255, 255]} onCommit={patchNode} />}
              {selectedHasText && <InspectorColorField label="文字颜色" property={selectedTextColorProperty} value={selected.props[selectedTextColorProperty] ?? [255, 255, 255, 255]} onCommit={patchNode} />}
              <InspectorField label="透明度" property="opacity" value={selected.props.opacity} onCommit={patchNode} />
              <InspectorColorField label="背景颜色" property="backgroundColor" value={selected.props.backgroundColor ?? [0, 0, 0, 0]} onCommit={patchNode} />
              <InspectorField label="圆角" property="borderRadius" value={selected.props.borderRadius} onCommit={patchNode} />
            </section>
            <Tip label="打开当前选中节点对应的 Lua 源码，并定位到构造行。">
              <button className="source-link" onClick={() => selected ? void jumpToSource(selected) : setCenterTab("code")}><FileCode2 size={14} />{selected.source?.file ?? "运行时节点"}:{selected.source?.line ?? "?"}</button>
            </Tip>
            <section className="inspector-node-ops">
              <div><h3>节点操作</h3><small>同级顺序决定渲染遮挡关系</small></div>
              <div className="inspector-order-row">
                <button type="button" disabled={snapshot?.root.id === selected.id} onClick={() => void runTreeOp({ type: "move", nodeId: selected.id, direction: "up" }, "上移节点")}><ArrowUp size={13} />上移</button>
                <button type="button" disabled={snapshot?.root.id === selected.id} onClick={() => void runTreeOp({ type: "move", nodeId: selected.id, direction: "down" }, "下移节点")}><ArrowDown size={13} />下移</button>
                <button type="button" disabled={snapshot?.root.id === selected.id} onClick={duplicateSelected}><Copy size={13} />复制</button>
              </div>
              <button type="button" className="inspector-delete" disabled={snapshot?.root.id === selected.id} onClick={() => void runTreeOp({ type: "delete", nodeId: selected.id }, `删除 ${selected.name}`)}><Trash2 size={13} />删除节点</button>
            </section>
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
        </aside>}
      </section>

      {gitFileMenu && (
        <div
          className="node-context-menu git-context-menu"
          role="menu"
          aria-label={`${gitFileMenu.change.path} Git 操作`}
          style={{ left: gitFileMenu.x, top: gitFileMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="node-context-heading"><span><GitBranch size={14} /></span><div><strong>{fileName(gitFileMenu.change.path)}</strong><small>{gitFileMenu.change.path}</small></div></div>
          <button type="button" role="menuitem" onClick={() => void openGitDiff(gitFileMenu.change, gitFileMenu.scope)}><Columns2 size={14} /><span>查看更改</span></button>
          <button type="button" role="menuitem" onClick={() => { const change = gitFileMenu.change; setGitFileMenu(null); void readFile(change.path).catch(() => toast("该文件无法在代码编辑器中打开", "warn")); }}><FileCode2 size={14} /><span>打开文件</span></button>
          <button type="button" role="menuitem" onClick={() => void runGitFileAction(gitFileMenu.scope === "staged" ? "unstage" : "stage", gitFileMenu.change)}>{gitFileMenu.scope === "staged" ? <Undo2 size={14} /> : <Plus size={14} />}<span>{gitFileMenu.scope === "staged" ? "取消暂存更改" : "暂存更改"}</span></button>
          <button type="button" role="menuitem" onClick={() => { void copyText(gitFileMenu.change.path); setGitFileMenu(null); }}><Copy size={14} /><span>复制相对路径</span></button>
          {gitFileMenu.change.unstaged && <><div className="node-context-divider" /><button type="button" role="menuitem" className="danger" onClick={() => void runGitFileAction("discard", gitFileMenu.change)}><Trash2 size={14} /><span>丢弃本地修改…</span></button></>}
        </div>
      )}

      {gitGroupMenu && (
        <div
          className="node-context-menu git-context-menu git-group-context-menu"
          role="menu"
          aria-label={gitGroupMenu.scope === "staged" ? "暂存更改批量操作" : "工作区更改批量操作"}
          style={{ left: gitGroupMenu.x, top: gitGroupMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <span className="node-context-section">{gitGroupMenu.scope === "staged" ? "暂存的更改" : "所有更改"}</span>
          {gitGroupMenu.scope === "staged" ? (
            <button type="button" role="menuitem" onClick={() => void runGitFileAction("unstage-all")}><Undo2 size={14} /><span>取消暂存所有更改</span></button>
          ) : (
            <>
              <button type="button" role="menuitem" disabled={!gitStatus?.changes?.some((change) => change.unstaged)} onClick={() => void runGitFileAction("stage-all")}><Plus size={14} /><span>暂存所有更改</span></button>
              <div className="node-context-divider" />
              <button type="button" role="menuitem" className="danger" disabled={!gitStatus?.changes?.some((change) => change.unstaged)} onClick={() => void runGitFileAction("discard-all")}><Trash2 size={14} /><span>放弃所有更改…</span></button>
            </>
          )}
        </div>
      )}

      {nodeContextMenu && contextNode && (
        <div
          className="node-context-menu"
          role="menu"
          aria-label={`${contextNode.name} 节点菜单`}
          style={{ left: nodeContextMenu.x, top: nodeContextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="node-context-heading">
            <span>{iconForType(contextNode.type)}</span>
            <div><strong>{contextNode.name}</strong><small>{contextNode.type}</small></div>
          </div>
          <span className="node-context-section">创建子节点</span>
          <div className="node-context-create">
            {([
              ["Node", "空节点"],
              ["Label", "Label"],
              ["Image", "图片"],
              ["Button", "按钮"],
              ["Panel", "Panel"]
            ] as [UiNodeType, string][]).map(([nodeType, label]) => (
              <button key={nodeType} type="button" role="menuitem" onClick={() => {
                setNodeContextMenu(null);
                void runTreeOp({ type: "insert-child", nodeId: contextNode.id, nodeType }, `创建 ${label}`);
              }}>
                {iconForType(nodeType)}<span>{label}</span>
              </button>
            ))}
          </div>
          <div className="node-context-divider" />
          <button type="button" role="menuitem" disabled={snapshot?.root.id === contextNode.id} onClick={() => {
            setNodeContextMenu(null);
            void runTreeOp({ type: "duplicate", nodeId: contextNode.id }, `复制 ${contextNode.name}`);
          }}><Copy size={14} /><span>复制节点</span></button>
          <button type="button" role="menuitem" onClick={() => {
            setNodeContextMenu(null);
            selectNode(contextNode.id);
            setRenamingId(contextNode.id);
            setRenameDraft(contextNode.name);
          }}><FileCode2 size={14} /><span>重命名</span></button>
          <button type="button" role="menuitem" disabled={snapshot?.root.id === contextNode.id} onClick={() => {
            setNodeContextMenu(null);
            void runTreeOp({ type: "move", nodeId: contextNode.id, direction: "up" }, "上移节点");
          }}><ArrowUp size={14} /><span>上移一层</span></button>
          <button type="button" role="menuitem" disabled={snapshot?.root.id === contextNode.id} onClick={() => {
            setNodeContextMenu(null);
            void runTreeOp({ type: "move", nodeId: contextNode.id, direction: "down" }, "下移节点");
          }}><ArrowDown size={14} /><span>下移一层</span></button>
          <div className="node-context-divider" />
          <button type="button" role="menuitem" className="danger" disabled={snapshot?.root.id === contextNode.id} onClick={() => {
            setNodeContextMenu(null);
            void runTreeOp({ type: "delete", nodeId: contextNode.id }, `删除 ${contextNode.name}`);
          }}><Trash2 size={14} /><span>删除节点</span><kbd>⌫</kbd></button>
        </div>
      )}

      <section className="terminal-panel panel">
        <PanelResizer orientation="row" label="调节终端高度" onPointerDown={beginLayoutDrag("terminal", false, true)} />
        <nav className="terminal-tabs">
          <span className="terminal-title"><PanelBottom size={14} />终端</span>
          {channels.map((channel) => <button key={channel.id} aria-pressed={activeTerminal === channel.id} className={activeTerminal === channel.id ? "active" : ""} onClick={() => setActiveTerminal(channel.id)}>{channel.label}</button>)}
          <button className="terminal-size" onClick={() => persistLayout({ ...layout, terminal: layout.terminal <= 42 ? DEFAULT_LAYOUT.terminal : 40 })}>{layout.terminal <= 42 ? "展开" : "收起"}</button>
          <button className="terminal-size" onClick={() => persistLayout({ ...layout, terminal: terminalMaxHeight() })}>最大化</button>
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
    </main>{legalOverlay}{projectRejectOverlay}{runtimeErrorOverlay}{sponsorOverlay}{roadmapOverlay}{newbieOverlay}{permissionOverlay}{updatePromptOverlay}</>
  );
}
