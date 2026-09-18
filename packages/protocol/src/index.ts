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

export interface UiSnapshot {
  revision: number;
  root: UiNode;
  selectedId?: string;
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
  confidence: "static" | "hybrid" | "runtime";
  root: UiNode;
  diagnostics: UiConversionDiagnostic[];
}

export interface UiPatch {
  requestId: string;
  baseRevision: number;
  nodeId: string;
  props: Record<string, UiValue | undefined>;
}

export interface BridgeCapabilities {
  makerCli: boolean;
  runtimeFrames: boolean;
  uiBridge: boolean;
  shellSandbox: boolean;
  luaRepl: boolean;
  platform: "aix" | "android" | "darwin" | "freebsd" | "haiku" | "linux" | "openbsd" | "sunos" | "win32" | "cygwin" | "netbsd";
}

export type BridgeEvent =
  | { type: "session.hello"; protocolVersion: typeof PROTOCOL_VERSION; capabilities: BridgeCapabilities }
  | { type: "ui.snapshot"; snapshot: UiSnapshot }
  | { type: "ui.patch.applied"; requestId: string; snapshot: UiSnapshot }
  | { type: "ui.patch.rejected"; requestId: string; reason: string; snapshot: UiSnapshot }
  | { type: "log.append"; channel: LogChannel; lines: string[] }
  | { type: "runtime.frame"; frameId: number; mimeType: string; data: string; width: number; height: number };

export type RuntimeCommand =
  | { id: number; type: "ui.patch"; patch: UiPatch }
  | { id: number; type: "ui.replace"; snapshot: UiSnapshot }
  | { id: number; type: "runtime.pause"; paused: boolean };

export function findUiNode(root: UiNode, id: string): UiNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children) {
    const match = findUiNode(child, id);
    if (match) return match;
  }
  return undefined;
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
    const children = node.children.map(visit);
    return children.some((child, index) => child !== node.children[index]) ? { ...node, children } : node;
  };

  const root = visit(snapshot.root);
  if (!changed) throw new Error(`node_not_found:${patch.nodeId}`);
  return { ...snapshot, revision: snapshot.revision + 1, root, selectedId: patch.nodeId };
}

export const DEFAULT_DEVICE_PROFILES: DeviceProfile[] = [
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
