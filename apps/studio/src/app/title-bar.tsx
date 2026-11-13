import { CircleHelp, Folder, GitBranch, Lightbulb, Plus, Search, Settings2, Wifi, WifiOff, X } from "lucide-react";
import { sameProjectPath } from "./paths";
import type { RecentProject } from "./types";
import { Tip } from "../Tip";

declare const __APP_VERSION__: string;

/** 标题栏上四个互斥面板（说明 / 技巧 / 搜索 / 设置）的标识。 */
export type TitlePanelId = "guide" | "tips" | "search" | "settings";

export function TitleBar({
  openProjects,
  activeProjectRoot,
  projectOpening,
  runningPreviewRoots,
  gitStatus,
  connected,
  runtimeLive,
  activePanel,
  onOpenPanel,
  onOpenProject,
  onCloseProject,
  onChooseProject
}: {
  openProjects: RecentProject[];
  activeProjectRoot: string | undefined;
  projectOpening: boolean;
  runningPreviewRoots: string[];
  gitStatus: { branch?: string | undefined; dirty?: boolean | undefined } | undefined;
  connected: boolean;
  runtimeLive: boolean;
  activePanel: TitlePanelId | null;
  onOpenPanel: (panel: TitlePanelId) => void;
  onOpenProject: (root: string) => void;
  onCloseProject: (root: string) => void;
  onChooseProject: () => void;
}) {
  const panelButton = (id: TitlePanelId, label: string, hint: string, icon: React.ReactNode) => (
    <Tip label={hint}>
      <button aria-label={label} aria-pressed={activePanel === id} className={activePanel === id ? "active" : ""} onClick={() => onOpenPanel(id)}>{icon}</button>
    </Tip>
  );

  return (
    <header className="titlebar">
      <div className="brand"><span className="brand-mark">T</span><strong>TapMakerWork</strong><span className="phase-badge">v{__APP_VERSION__}</span></div>
      <div className="project-tabs" role="tablist" aria-label="已打开项目">
        {openProjects.map((item) => {
          const active = item.root === activeProjectRoot;
          const running = runningPreviewRoots.some((root) => sameProjectPath(root, item.root));
          return (
            <div key={item.root} className={`project-tab ${active ? "active" : ""}`} title={item.root}>
              <button type="button" role="tab" aria-selected={active} disabled={projectOpening} onClick={() => onOpenProject(item.root)}>
                <Folder size={14} aria-hidden="true" /><span>{item.name}</span>
                {running && <i className="project-tab-runtime" title="该项目的 Runtime 正在运行" aria-label="Runtime 运行中" />}
                {active && <><GitBranch size={12} aria-hidden="true" /><small>{gitStatus?.branch || "—"}</small>{gitStatus?.dirty ? <small className="dirty-branch">•</small> : null}</>}
              </button>
              <button type="button" className="project-tab-close" aria-label={`关闭项目 ${item.name}`} disabled={projectOpening} onClick={() => onCloseProject(item.root)}><X size={13} /></button>
            </div>
          );
        })}
        <button type="button" className="project-tab-add" aria-label="打开另一个项目" title="打开另一个项目" disabled={projectOpening} onClick={onChooseProject}><Plus size={15} /></button>
      </div>
      <div className="runtime-status" role="status">
        {connected ? <Wifi size={14} aria-hidden="true" /> : <WifiOff size={14} aria-hidden="true" />}
        <span>{connected ? "Bridge 已连接" : "Bridge 断开"}</span>
        {runtimeLive ? <small className="runtime-live">Runtime 运行中</small> : <small>Runtime 未启动</small>}
      </div>
      <div className="title-actions">
        {panelButton("guide", "使用说明", "看看各按钮做什么、从哪开始改界面。", <CircleHelp size={15} />)}
        {panelButton("tips", "开发技巧", "本地预览 Token 优化、grill-me、发布前检查等开发经验，可一键复制给 AI。", <Lightbulb size={15} />)}
        {panelButton("search", "搜索", "在项目文件中全文搜索。输入关键词后回车，点击结果可跳转到源码行。", <Search size={15} />)}
        {panelButton("settings", "设置", "查看 Bridge / Maker / Runtime 适配器状态；可导出本地接入包（不会写入游戏 git）。", <Settings2 size={15} />)}
      </div>
    </header>
  );
}
