import type { BridgeCapabilities, UiSnapshot } from "@tapmakerwork/protocol";

export interface CommunityInfo {
  qqGroupId: string;
  qqGroupName: string;
  qqGroupJoinUrl: string;
  officialSiteUrl?: string;
  source?: "gitee" | "github" | "builtin";
}

export interface Health {
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

export interface MakerProjectMeta {
  title?: string | undefined;
  appId?: string | undefined;
  orientation?: string | undefined;
  publishStatus?: number | undefined;
  qrcodeUrl?: string | undefined;
  qrcodeGeneratedAt?: string | undefined;
}

export interface MakerPreviewStatus {
  state?: string;
  process_alive?: boolean | null;
  runtime_pid?: number;
  error?: string;
}

export type MakerRuntimeMode = "device" | "stable" | "beta" | "version";

export interface MakerVersionState {
  preference: { mode: MakerRuntimeMode; version?: string };
  active?: { version: string; entry: string };
  installed: Array<{ version: string; entry: string }>;
  channels: {
    stable: { installed?: string; latest?: string; updateAvailable: boolean };
    beta: { installed?: string; latest?: string; updateAvailable: boolean };
  };
  checkedAt?: string;
}

export type MakerVersionBusy = "" | "check" | "switch" | "stable" | "beta" | "node" | "node-upgrade";

export interface NodeVersionState {
  device: { version: string; executable: string } | null;
  embedded: { version: string; executable: string };
  active: { version: string; executable: string; source: "device" | "managed" | "embedded" };
  installed: Array<{ version: string; executable: string; source: "managed" }>;
  stable: { installed?: string; latest?: string; updateAvailable: boolean };
  upgrade?: { manager: string; label: string; command: string; terminal: string; note?: string; oneClick: boolean };
  checkedAt?: string;
}

export interface ProjectState {
  project?: { root: string; name: string; makerBound: boolean };
  snapshot?: UiSnapshot;
  activeUiEntry?: string;
}

export type RecentProject = { root: string; name: string };

export interface FileEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
}

export interface UiScreenSummary {
  path: string;
  name: string;
  confidence?: "static" | "hybrid" | "runtime" | "module";
  nodeCount?: number;
  error?: string;
}

export interface SearchHit {
  path: string;
  line: number;
  preview: string;
}

export interface AssetEntry {
  name: string;
  path: string;
  bytes: number;
  extension?: string;
  kind?: "image" | "audio" | "video" | "model" | "font" | "other";
  referencedBy?: string[];
  status?: "referenced" | "unreferenced" | "external";
}

export interface GitStatusState {
  branch: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  dirty?: boolean;
  changes?: GitChangeState[];
  commits?: Array<{ hash: string; shortHash: string; subject: string; author: string; relativeDate: string; refs: string[] }>;
}

export interface GitChangeState {
  path: string;
  status: string;
  indexStatus: string;
  workTreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
}

export interface GitFileDiffState {
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

export type ToastKind = "info" | "success" | "error" | "warn";
export interface ToastItem { id: number; kind: ToastKind; message: string; busy?: boolean }
export type WorkspaceLayout = { left: number; right: number; previewDock: number; terminal: number };
export type CenterTab = "workflow" | "visual" | "runtime" | "code" | "git-diff";
export type DocumentTab = Exclude<CenterTab, "git-diff"> | "preview";
export type FloatingWorkspace = { x: number; y: number; width: number; height: number };

export type PermissionAction = "screen" | "accessibility" | "restart" | "refresh" | "confirm";
export type DesktopUpdateAction = "check" | "download" | "restart" | "snooze" | "mute";
