export const PROTOCOL_VERSION = 1 as const;

export type WorkspaceMode = "play" | "inspect" | "live-edit";
export type LogChannel = "runtime" | "build" | "lua" | "shell" | "repl" | "qrcode" | "agent";

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface DeviceProfile {
  id: string;
  label: string;
  width: number;
  height: number;
  dpr: number;
  safeArea: Insets;
  orientation: "portrait" | "landscape";
}

export type UiScalar = string | number | boolean | null;
export type UiValue = UiScalar | UiValue[] | { [key: string]: UiValue };

export interface UiSourceLocation {
  file: string;
  line?: number;
  jsonPath?: string;
}

export interface UiNode {
  id: string;
  type: string;
  name: string;
  props: Record<string, UiValue>;
  source?: UiSourceLocation;
  children: UiNode[];
}

export type UiBackend = "yoga" | "nanovg";

export interface UiSnapshot {
  revision: number;
  root: UiNode;
  selectedId?: string;
  /** Runtime tree backend. Yoga walks Widget trees; NanoVG rebuilds virtual nodes from draw proxies. */
  backend?: UiBackend;
  viewport?: {
    width: number;
    height: number;
    scale?: number;
    physicalWidth?: number;
    physicalHeight?: number;
  };
}

export interface UiConversionDiagnostic {
  severity: "info" | "warning" | "error";
  message: string;
  line?: number;
}

export interface UiConversionDocument {
  formatVersion: 1;
  sourceFile: string;
  sourceHash: string;
  confidence: "static" | "hybrid" | "runtime" | "module";
  root: UiNode;
  diagnostics: UiConversionDiagnostic[];
}

export interface UiPatch {
  requestId: string;
  baseRevision: number;
  nodeId: string;
  props: Record<string, UiValue | undefined>;
  source?: UiSourceLocation | undefined;
  /** Consecutive patches with the same group collapse into one undo step. */
  historyGroup?: string | undefined;
  /** When false, the live widget updates but the change is not queued for Lua writeback. */
  persist?: boolean | undefined;
}

export interface BridgeCapabilities {
  makerCli: boolean;
  runtimeFrames: boolean;
  uiBridge: boolean;
  shellSandbox: boolean;
  luaRepl: boolean;
  platform: "aix" | "android" | "darwin" | "freebsd" | "haiku" | "linux" | "openbsd" | "sunos" | "win32" | "cygwin" | "netbsd";
}

export type PreviewTransport = "auto" | "iframe" | "webcontentsview";

export interface PreviewPanelState {
  url: string;
  urlSource: "manual" | "qrcode" | "none";
  orientation: "portrait" | "landscape";
  autoRefreshIframe: boolean;
  autoRefreshMaker: boolean;
  transport: PreviewTransport;
  lastRefreshedAt?: string | undefined;
  reloadToken: number;
}

export type ProjectWorkflowStatus = "pass" | "warning" | "blocked" | "pending";

export type ProjectWorkflowAction =
  | "doctor"
  | "install-maker"
  | "open-design"
  | "open-code"
  | "start-preview"
  | "open-preview"
  | "generate-qrcode"
  | "build";

export interface ProjectWorkflowCheck {
  id: string;
  label: string;
  status: ProjectWorkflowStatus;
  detail: string;
  action?: ProjectWorkflowAction | undefined;
  actionLabel?: string | undefined;
}

export interface ProjectWorkflowStage {
  id: "environment" | "project" | "content" | "runtime" | "evidence" | "delivery";
  label: string;
  description: string;
  status: ProjectWorkflowStatus;
  checks: ProjectWorkflowCheck[];
}

export interface ProjectWorkflowEvidence {
  id: string;
  kind: "ui-sidecar" | "runtime-snapshot" | "qrcode";
  label: string;
  detail: string;
  path?: string | undefined;
  capturedAt?: string | undefined;
}

export interface ProjectAssetSummary {
  total: number;
  referenced: number;
  unreferenced: number;
  bytes: number;
  byKind: Record<"image" | "audio" | "video" | "model" | "font" | "other", number>;
}

export interface ProjectWorkflowOverview {
  generatedAt: string;
  score: number;
  status: ProjectWorkflowStatus;
  objective: string;
  stages: ProjectWorkflowStage[];
  evidence: ProjectWorkflowEvidence[];
  assets: ProjectAssetSummary;
  nextAction?: {
    action: ProjectWorkflowAction;
    label: string;
    reason: string;
  } | undefined;
}

export type SnapshotSource = "conversion" | "sidecar" | "runtime" | "empty";

export type BridgeEvent =
  | { type: "session.hello"; protocolVersion: typeof PROTOCOL_VERSION; capabilities: BridgeCapabilities }
  | { type: "ui.snapshot"; snapshot: UiSnapshot; source?: SnapshotSource }
  | { type: "ui.patch.applied"; requestId: string; snapshot: UiSnapshot; source?: SnapshotSource }
  | { type: "ui.patch.rejected"; requestId: string; reason: string; snapshot: UiSnapshot }
  | { type: "log.append"; channel: LogChannel; lines: string[] }
  | { type: "runtime.frame"; frameId: number; mimeType: string; data: string; width: number; height: number }
  | { type: "preview.panel"; panel: PreviewPanelState; reason?: string };

export type RuntimeCommand =
  | { id: number; type: "ui.patch"; patch: UiPatch }
  | { id: number; type: "ui.tree"; mutation: RuntimeTreeMutation }
  | { id: number; type: "ui.replace"; snapshot: UiSnapshot }
  | { id: number; type: "runtime.pause"; paused: boolean };

export type RuntimeTreeMutation =
  | { action: "create"; parentId: string; index: number; node: UiNode }
  | { action: "delete"; nodeId: string }
  | { action: "move"; nodeId: string; parentId: string; index: number };

function nodeChildren(node: UiNode): UiNode[] {
  return Array.isArray(node.children) ? node.children : [];
}

export function findUiNode(root: UiNode, id: string): UiNode | undefined {
  if (!root || typeof root !== "object") return undefined;
  if (root.id === id) return root;
  for (const child of nodeChildren(root)) {
    const match = findUiNode(child, id);
    if (match) return match;
  }
  return undefined;
}

/**
 * Shared UI kit factories (`UiStyle.lua`) build widgets for many screens.
 * Runtime `AddChild` stamps kit-internal parts with this file, so a node whose
 * source is a kit file (and has no explicit `id`) cannot be moved on its own —
 * only the kit call site in the screen Lua is persistable.
 */
export function isUiKitSourceFile(file: string | undefined | null): boolean {
  if (!file) return false;
  const base = file.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase() ?? "";
  return base === "uistyle.lua" || /^ui[-_]?style\.lua$/.test(base);
}

export function isKitInternalUiNode(
  node: { props: Record<string, UiValue>; source?: UiSourceLocation | undefined } | undefined
): boolean {
  if (!node) return false;
  const explicitId = node.props?.id;
  if (typeof explicitId === "string" && explicitId !== "") return false;
  return isUiKitSourceFile(node.source?.file);
}

export function findParentInfo(root: UiNode, nodeId: string): { parentId: string; index: number } | null {
  const kids = nodeChildren(root);
  const index = kids.findIndex((child) => child.id === nodeId);
  if (index >= 0) return { parentId: root.id, index };
  for (const child of kids) {
    const found = findParentInfo(child, nodeId);
    if (found) return found;
  }
  return null;
}

export function applyUiPatch(snapshot: UiSnapshot, patch: UiPatch): UiSnapshot {
  if (patch.baseRevision !== snapshot.revision) {
    throw new Error(`revision_conflict:${snapshot.revision}`);
  }

  let changed = false;
  const visit = (node: UiNode): UiNode => {
    if (node.id === patch.nodeId) {
      changed = true;
      const props = { ...node.props };
      for (const [key, value] of Object.entries(patch.props)) {
        if (value === undefined) delete props[key];
        else props[key] = value;
      }
      return { ...node, props };
    }
    const children = nodeChildren(node).map(visit);
    return children.some((child, index) => child !== nodeChildren(node)[index]) ? { ...node, children } : node;
  };

  const root = visit(snapshot.root);
  if (!changed) throw new Error(`node_not_found:${patch.nodeId}`);
  return { ...snapshot, revision: snapshot.revision + 1, root, selectedId: patch.nodeId };
}

export type UiNodeType = "Node" | "Panel" | "Label" | "Button" | "Image";

export type UiTreeOp =
  | { type: "toggle-visible"; nodeId: string }
  | { type: "move"; nodeId: string; direction: "up" | "down" }
  | { type: "delete"; nodeId: string }
  | { type: "insert-child"; nodeId: string; nodeType?: UiNodeType; name?: string }
  | { type: "insert-sibling"; nodeId: string; nodeType?: UiNodeType; name?: string }
  | { type: "rename"; nodeId: string; name: string }
  | { type: "duplicate"; nodeId: string }
  | { type: "relocate"; nodeId: string; parentId: string; index: number };

function cloneNode(node: UiNode): UiNode {
  return {
    ...node,
    props: { ...node.props },
    children: nodeChildren(node).map(cloneNode)
  };
}

function defaultNode(type: UiNodeType, name: string, id: string): UiNode {
  const base: UiNode = {
    id,
    type,
    name,
    props: { id: name },
    children: []
  };
  if (type === "Node") {
    base.props = {
      id: name,
      position: "absolute",
      left: 0,
      top: 0,
      width: 100,
      height: 100
    };
  } else if (type === "Panel") {
    base.props = {
      id: name,
      width: "100%",
      minHeight: 48,
      flexDirection: "column",
      backgroundColor: [30, 40, 58, 180]
    };
  } else if (type === "Label") {
    base.props = { id: name, text: name, fontSize: 16, fontColor: [232, 237, 245, 255] };
  } else if (type === "Button") {
    base.props = { id: name, text: name, height: 40, backgroundColor: [48, 78, 130, 255], borderRadius: 8 };
  } else if (type === "Image") {
    base.props = { id: name, width: 64, height: 64, backgroundColor: [20, 28, 40, 255] };
  }
  return base;
}

function reassignIds(node: UiNode, suffix: string, path = "0"): UiNode {
  const id = `${node.id}#${suffix}:${path}`;
  const props = { ...node.props };
  if (typeof props.id === "string") props.id = `${props.id}_copy`;
  return {
    ...node,
    id,
    name: `${node.name}_copy`,
    props,
    children: nodeChildren(node).map((child, index) => reassignIds(child, suffix, `${path}.${index}`))
  };
}

function isAncestor(root: UiNode, ancestorId: string, nodeId: string): boolean {
  if (ancestorId === nodeId) return true;
  const ancestor = findUiNode(root, ancestorId);
  if (!ancestor) return false;
  return Boolean(findUiNode(ancestor, nodeId));
}

export function applyUiTreeOp(snapshot: UiSnapshot, op: UiTreeOp): UiSnapshot {
  if (!op?.nodeId) throw new Error("tree_op_node_required");
  const isRoot = snapshot.root.id === op.nodeId;
  let selectedId = op.nodeId;

  const mapNodeSelf = (node: UiNode): UiNode => {
    if (op.type === "toggle-visible") {
      const hidden = node.props.visible === false;
      return { ...cloneNode(node), props: { ...node.props, visible: !hidden ? false : true } };
    }
    if (op.type === "rename") {
      const name = op.name || node.name;
      return { ...cloneNode(node), name, props: { ...node.props, id: name } };
    }
    if (op.type === "insert-child") {
      const type = op.nodeType || "Panel";
      const name = op.name || `New${type}`;
      const childId = `${node.id}:new:${Date.now()}`;
      selectedId = childId;
      return {
        ...cloneNode(node),
        children: [...nodeChildren(node).map(cloneNode), defaultNode(type, name, childId)]
      };
    }
    return cloneNode(node);
  };

  if (isRoot && (op.type === "delete" || op.type === "move" || op.type === "insert-sibling")) {
    throw new Error(op.type === "delete" ? "tree_op_cannot_delete_root" : "tree_op_root_no_sibling_or_move");
  }
  if (op.type === "duplicate" && isRoot) {
    throw new Error("tree_op_cannot_duplicate_root");
  }

  if (op.type === "relocate") {
    if (isRoot) throw new Error("tree_op_cannot_relocate_root");
    if (isAncestor(snapshot.root, op.nodeId, op.parentId)) throw new Error("tree_op_relocate_cycle");
    const source = findUiNode(snapshot.root, op.nodeId);
    if (!source) throw new Error(`node_not_found:${op.nodeId}`);
    const extracted = cloneNode(source);
    const strip = (node: UiNode): UiNode => {
      const next = nodeChildren(node)
        .filter((child) => child.id !== op.nodeId)
        .map(strip);
      return { ...cloneNode(node), children: next };
    };
    const stripped = strip(snapshot.root);
    const insert = (node: UiNode): UiNode => {
      if (node.id === op.parentId) {
        const kids = nodeChildren(node).map(cloneNode);
        const index = Math.max(0, Math.min(op.index, kids.length));
        kids.splice(index, 0, extracted);
        selectedId = extracted.id;
        return { ...cloneNode(node), children: kids };
      }
      return { ...cloneNode(node), children: nodeChildren(node).map(insert) };
    };
    const root = insert(stripped);
    return { revision: snapshot.revision + 1, root, selectedId: extracted.id };
  }

  const walk = (node: UiNode): UiNode | null => {
    if (!isRoot && node.id === op.nodeId && (op.type === "toggle-visible" || op.type === "rename" || op.type === "insert-child")) {
      return mapNodeSelf(node);
    }
    if (isRoot && node.id === op.nodeId) {
      return mapNodeSelf(node);
    }

    const children = nodeChildren(node);

    // Parent-level structural ops
    const childIndex = children.findIndex((child) => child.id === op.nodeId);
    if (childIndex >= 0 && (op.type === "delete" || op.type === "move" || op.type === "insert-sibling" || op.type === "duplicate")) {
      if (op.type === "delete") {
        selectedId = node.id;
        return { ...cloneNode(node), children: children.filter((_, index) => index !== childIndex).map(cloneNode) };
      }
      if (op.type === "move") {
        const dest = op.direction === "up" ? childIndex - 1 : childIndex + 1;
        if (dest < 0 || dest >= children.length) throw new Error("tree_op_edge");
        const reordered = children.map(cloneNode);
        const [moved] = reordered.splice(childIndex, 1);
        reordered.splice(dest, 0, moved!);
        return { ...cloneNode(node), children: reordered };
      }
      if (op.type === "insert-sibling") {
        const type = op.nodeType || "Panel";
        const name = op.name || `New${type}`;
        const siblingId = `${node.id}:new:${Date.now()}`;
        selectedId = siblingId;
        const reordered = children.map(cloneNode);
        reordered.splice(childIndex + 1, 0, defaultNode(type, name, siblingId));
        return { ...cloneNode(node), children: reordered };
      }
      if (op.type === "duplicate") {
        const copy = reassignIds(cloneNode(children[childIndex]!), String(Date.now()));
        selectedId = copy.id;
        const reordered = children.map(cloneNode);
        reordered.splice(childIndex + 1, 0, copy);
        return { ...cloneNode(node), children: reordered };
      }
    }

    let changed = false;
    const nextChildren = children.map((child) => {
      const rewritten = walk(child);
      if (rewritten && rewritten.id !== child.id) changed = true;
      if (rewritten && rewritten !== child) changed = true;
      return rewritten ?? cloneNode(child);
    });
    if (!changed) return null;
    return { ...cloneNode(node), children: nextChildren };
  };

  const root = walk(snapshot.root);
  if (!root) throw new Error(`node_not_found:${op.nodeId}`);
  return {
    revision: snapshot.revision + 1,
    root,
    selectedId
  };
}

export const DEFAULT_DEVICE_PROFILES: DeviceProfile[] = [
  {
    id: "maker-portrait",
    label: "Maker 720 竖屏",
    width: 720,
    height: 1280,
    dpr: 2,
    safeArea: { top: 36, right: 0, bottom: 28, left: 0 },
    orientation: "portrait"
  },
  {
    id: "phone-portrait",
    label: "手机竖屏",
    width: 393,
    height: 852,
    dpr: 3,
    safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
    orientation: "portrait"
  },
  {
    id: "phone-landscape",
    label: "手机横屏",
    width: 852,
    height: 393,
    dpr: 3,
    safeArea: { top: 0, right: 59, bottom: 21, left: 59 },
    orientation: "landscape"
  },
  {
    id: "tablet",
    label: "平板",
    width: 1024,
    height: 1366,
    dpr: 2,
    safeArea: { top: 24, right: 0, bottom: 20, left: 0 },
    orientation: "portrait"
  },
  {
    id: "desktop",
    label: "桌面",
    width: 1440,
    height: 900,
    dpr: 1,
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    orientation: "landscape"
  }
];
