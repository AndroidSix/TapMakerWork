import { Cpu } from "lucide-react";
import type { Health } from "./types";

declare const __APP_VERSION__: string;

export function StatusBar({
  health,
  projectMakerBound,
  gitStatus,
  snapshotRevision,
  sidecarInfo,
  runningPreviewCount,
  connected,
  onOpenRuntimeManager
}: {
  health: Health | undefined;
  projectMakerBound: boolean;
  gitStatus: { branch?: string | undefined; dirty?: boolean | undefined } | undefined;
  snapshotRevision: number | undefined;
  sidecarInfo: { exists: boolean; dirty?: boolean | undefined; path?: string | undefined };
  runningPreviewCount: number;
  connected: boolean;
  onOpenRuntimeManager: () => void;
}) {
  return (
    <footer className="statusbar">
      <span>{health?.capabilities.makerCli ? `Maker ${health.makerVersion}` : "Maker CLI 未发现"}</span>
      <span>{projectMakerBound ? "Maker 项目已绑定" : "模拟项目"}</span>
      <span>{gitStatus ? `Git ${gitStatus.branch}${gitStatus.dirty ? " •" : ""}` : "Git —"}</span>
      <span>{snapshotRevision !== undefined ? `UI rev ${snapshotRevision}` : "UI 未连接"}</span>
      <span>{sidecarInfo.exists ? (sidecarInfo.dirty ? `${sidecarInfo.path || "ui.json"} ●` : `${sidecarInfo.path || "ui.json"} 已同步`) : "视觉旁路未创建"}</span>
      <span className="status-spacer" />
      <button type="button" className={`statusbar-button ${runningPreviewCount ? "is-live" : ""}`} title="打开 Runtime 管理：查看所有项目的本地预览进程" onClick={onOpenRuntimeManager}>
        <Cpu size={11} aria-hidden="true" />{runningPreviewCount ? `Runtime 运行中 ×${runningPreviewCount}` : "Runtime 未运行"}
      </button>
      <span>{health?.runtimeAdapter?.installed ? "Runtime 适配器已安装" : "Runtime 适配器未安装"}</span>
      <span>{health?.capabilities.shellSandbox ? "沙箱就绪" : "沙箱锁定"}</span>
      <span>{connected ? "本机连接" : "离线"}</span>
      <span>TapMakerWork {__APP_VERSION__}</span>
    </footer>
  );
}
