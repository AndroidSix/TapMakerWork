import { Box, Files, GitBranch, Image, Layers3, MonitorPlay, Music2, RefreshCw, Stethoscope, Video } from "lucide-react";
import type { UiNodeType, UiSnapshot, UiTreeOp } from "@tapmakerwork/protocol";
import type { AssetEntry, CenterTab, FileEntry, GitChangeState, GitStatusState, ToastKind, UiScreenSummary } from "./types";
import { FileTreeEntry } from "./tree-nodes";
import { GitPanel, type GitMenuAnchor } from "./git-panel";
import { HierarchyPane } from "./hierarchy-pane";
import { Tip } from "../Tip";

export type LeftTab = "files" | "screens" | "hierarchy" | "assets" | "git";

/** 左栏顶部五个资源标签；顺序与视觉一致。 */
const LEFT_TABS: Array<{ id: LeftTab; label: string; hint: string; icon: React.ReactNode }> = [
  { id: "files", label: "文件", hint: "项目文件", icon: <Files size={14} /> },
  { id: "screens", label: "界面", hint: "UI 界面列表", icon: <MonitorPlay size={14} /> },
  { id: "hierarchy", label: "层级", hint: "控件树", icon: <Layers3 size={14} /> },
  { id: "assets", label: "资源", hint: "图片资源", icon: <Image size={14} /> },
  { id: "git", label: "Git", hint: "Git 版本管理", icon: <GitBranch size={14} /> }
];

const ASSET_STATUS: Record<NonNullable<AssetEntry["status"]>, { label: (count: number) => string; className: string; kind: "success" | "info" | "warn" }> = {
  referenced: { label: (count) => `已绑定 ${count}`, className: "asset-bound", kind: "success" },
  external: { label: () => "外部采纳", className: "asset-external", kind: "info" },
  unreferenced: { label: () => "待确认", className: "asset-unbound", kind: "warn" }
};

function assetIcon(kind: AssetEntry["kind"]) {
  if (kind === "audio") return <Music2 size={14} />;
  if (kind === "video") return <Video size={14} />;
  if (kind === "model") return <Box size={14} />;
  return <Image size={14} />;
}

/** 左侧资源栏：文件 / 界面 / 控件树 / 资源 / Git 五个视图共用同一个面板容器。 */
export function LeftPane({
  leftTab,
  onSelectTab,
  hierarchy,
  files,
  selectedFilePath,
  onOpenFile,
  screens,
  screensBusy,
  activeUiPath,
  onRescanScreens,
  onOpenScreen,
  assets,
  onOpenAssetCheckup,
  onRefreshAssets,
  onShowAssetStatus,
  git
}: {
  leftTab: LeftTab;
  onSelectTab: (tab: LeftTab) => void;
  hierarchy: {
    snapshot: UiSnapshot | undefined;
    selectedNodeIds: string[];
    newNodeType: UiNodeType;
    renamingId: string | null;
    renameDraft: string;
    dragId: string | null;
    dropHint: { id: string; pos: "before" | "after" | "inside" } | null;
    treeRef: React.RefObject<HTMLDivElement | null>;
    onNewNodeTypeChange: (type: UiNodeType) => void;
    onRenameDraftChange: (value: string) => void;
    onCommitRename: () => void;
    onCancelRename: () => void;
    onSelect: (id: string, additive?: boolean) => void;
    onContextMenu: (id: string, x: number, y: number) => void;
    onDragStart: (id: string) => void;
    onDragOver: (id: string, event: React.DragEvent) => void;
    onDrop: (id: string, event: React.DragEvent) => void;
    onRunTreeOp: (op: UiTreeOp, label: string) => void;
    onDuplicate: () => void;
    onBeginRename: () => void;
    notify: (message: string, kind?: ToastKind) => void;
  };
  files: FileEntry[];
  selectedFilePath: string | undefined;
  onOpenFile: (path: string) => void;
  screens: UiScreenSummary[];
  screensBusy: boolean;
  activeUiPath: string | undefined;
  onRescanScreens: () => void;
  onOpenScreen: (path: string) => void;
  assets: AssetEntry[];
  onOpenAssetCheckup: () => void;
  onRefreshAssets: () => void;
  onShowAssetStatus: (message: string, kind?: ToastKind) => void;
  git: {
    gitStatus: GitStatusState | undefined;
    gitBusy: string | undefined;
    gitCommitMessage: string;
    onCommitMessageChange: (value: string) => void;
    gitConflictPlan: string | null;
    copyBusy: boolean;
    centerTab: CenterTab;
    gitDiffPath: string | undefined;
    gitDiffScope: "staged" | "worktree" | undefined;
    onLoadStatus: () => void;
    onRunAction: (action: "pull" | "commit" | "push-build") => void;
    onRunFileAction: (action: "stage" | "unstage" | "stage-all" | "unstage-all", change?: GitChangeState) => void;
    onOpenDiff: (change: GitChangeState, scope: "staged" | "unstaged") => void;
    onCopy: (text: string) => void;
    onOpenGroupMenu: (scope: "staged" | "unstaged", anchor: GitMenuAnchor) => void;
    onOpenFileMenu: (change: GitChangeState, scope: "staged" | "unstaged", anchor: GitMenuAnchor) => void;
  };
}) {
  const screenLabel = (screen: UiScreenSummary): string => {
    const directory = screen.path.split("/").slice(1, -1).join("/");
    const location = directory && directory !== "ui" ? `${directory} · ` : "";
    if (screen.confidence === "module" || screen.error === "module_only") return `${location}逻辑模块 · 非界面`;
    if (screen.error) return `${location}仅代码 · 无法静态预览`;
    return `${location}${screen.nodeCount ?? 0} 个节点 · ${screen.confidence === "static" ? "完整" : "混合"}`;
  };

  return (
    <aside className="left-pane panel">
      <nav className="pane-tabs left-resource-tabs" aria-label="资源导航">
        {LEFT_TABS.map((tab) => (
          <Tip key={tab.id} label={tab.hint}>
            <button
              aria-label={tab.hint}
              title={tab.hint}
              aria-pressed={leftTab === tab.id}
              className={leftTab === tab.id ? "active" : ""}
              onClick={() => onSelectTab(tab.id)}
            >{tab.icon}<span className="pane-tab-label">{tab.label}</span></button>
          </Tip>
        ))}
      </nav>
      <div className={`pane-body ${leftTab === "hierarchy" ? "hierarchy-pane-body" : ""}`}>
        {leftTab === "hierarchy" && hierarchy.snapshot && <HierarchyPane {...hierarchy} snapshot={hierarchy.snapshot} />}

        {leftTab === "files" && (files.length
          ? files.map((entry) => <FileTreeEntry key={entry.path} entry={entry} depth={0} selectedPath={selectedFilePath} onOpen={onOpenFile} />)
          : <p className="empty-state">项目目录为空。点击顶部项目名称可重新选择目录。</p>)}

        {leftTab === "screens" && <div className="screen-list">
          <div className="screen-list-heading">
            <span>检测到 {screens.length} 个 UI 入口</span>
            <button onClick={onRescanScreens} disabled={screensBusy} aria-busy={screensBusy} aria-label="重新扫描整个 scripts 目录">
              <RefreshCw size={13} className={screensBusy ? "spin" : ""} aria-hidden="true" />
            </button>
          </div>
          {screens.map((screen) => <button
            key={screen.path}
            title={screen.path}
            className={`screen-row ${activeUiPath === screen.path ? "active" : ""}`}
            onClick={() => onOpenScreen(screen.path)}
          >
            <MonitorPlay size={15} />
            <span><strong>{screen.name}</strong><small>{screenLabel(screen)}</small></span>
            {activeUiPath === screen.path && <span className="active-dot" />}
          </button>)}
        </div>}

        {leftTab === "assets" && <div className="asset-list">
          <div className="screen-list-heading">
            <span>{assets.length ? `${assets.length} 个游戏素材` : "项目素材"}</span>
            <span className="screen-list-actions">
              <button onClick={onOpenAssetCheckup} aria-label="资源体检" title="资源体检：包体报告与未引用素材清理"><Stethoscope size={13} /></button>
              <button onClick={onRefreshAssets} aria-label="刷新资源"><RefreshCw size={13} /></button>
            </span>
          </div>
          {assets.length === 0 ? <p className="empty-state">未发现图片、音频、视频或模型素材。</p> : assets.slice(0, 160).map((asset) => {
            const status = ASSET_STATUS[asset.status ?? "unreferenced"];
            const referenceCount = asset.referencedBy?.length || 0;
            const references = referenceCount ? `\n引用：${asset.referencedBy?.join(", ")}` : "\n未发现源码引用";
            return (
              <button
                key={asset.path}
                className="file-row asset-row"
                title={`${asset.path}${references}`}
                onClick={() => onShowAssetStatus(`${status.label(referenceCount)}：${asset.path}`, status.kind)}
              >
                {assetIcon(asset.kind)}
                <span>{asset.name}</span>
                <small className={status.className}>{status.label(referenceCount)}</small>
              </button>
            );
          })}
        </div>}

        {leftTab === "git" && <GitPanel {...git} />}
      </div>
    </aside>
  );
}
