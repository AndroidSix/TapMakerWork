import { Copy, Cpu, ExternalLink, LifeBuoy, Map, ScrollText, Users } from "lucide-react";
import { MakerAccountsCard } from "../MakerAccountsCard";
import type { DesktopHardwareAccelerationState, DesktopLegalState, DesktopPermissionState, DesktopTelemetryState, DesktopUpdateState } from "../desktop-api";
import { DesktopPermissionsCard, DesktopTelemetryCard, DesktopUpdateCard, MakerVersionSettings } from "./settings-cards";
import { OFFICIAL_SITE_URL } from "./constants";
import type {
  CommunityInfo,
  DesktopUpdateAction,
  Health,
  MakerRuntimeMode,
  MakerVersionBusy,
  MakerVersionState,
  NodeVersionState,
  PermissionAction,
  ToastKind
} from "./types";

/** systemInfo 是 Bridge 返回的松散结构，取值前统一收窄成字符串。 */
function systemText(systemInfo: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = systemInfo?.[key];
  return typeof value === "string" ? value : undefined;
}

/** 设置 / 系统面板：连接与能力速览 + 桌面端各项开关。所有状态由 App 与 useDesktopSystem 持有。 */
export function SettingsPanel({
  apiBase,
  systemInfo,
  health,
  projectRoot,
  activeUiPath,
  adapterExport,
  onExportRuntimeAdapter,
  onClose,
  hardware,
  hardwareBusy,
  onToggleHardware,
  onRestartHardware,
  legal,
  onOpenLegalDialog,
  telemetry,
  telemetryBusy,
  onToggleTelemetry,
  permissions,
  permissionBusy,
  permissionConfirmed,
  onPermissionAction,
  onOpenPermissionGuide,
  update,
  updateBusy,
  onUpdateAction,
  onOpenUrl,
  community,
  runtimeErrorText,
  onOpenFeedbackPack,
  onOpenRoadmap,
  onCopy,
  makerAccountsProjectRoot,
  onOpenMakerConsole,
  notify,
  makerVersions,
  nodeVersions,
  makerVersionBusy,
  onCheckMakerVersions,
  onSelectMakerVersion,
  onInstallRequiredMakerMcp,
  onInstallMakerChannel,
  onSyncNode,
  onUpgradeNode
}: {
  apiBase: string;
  systemInfo: Record<string, unknown> | undefined;
  health: Health | undefined;
  projectRoot: string;
  activeUiPath: string | undefined;
  adapterExport: string;
  onExportRuntimeAdapter: () => Promise<void>;
  onClose: () => void;
  hardware: DesktopHardwareAccelerationState | undefined;
  hardwareBusy: boolean;
  onToggleHardware: (enabled: boolean) => Promise<void>;
  onRestartHardware: () => void;
  legal: DesktopLegalState | undefined;
  onOpenLegalDialog: () => void;
  telemetry: DesktopTelemetryState | undefined;
  telemetryBusy: boolean;
  onToggleTelemetry: (enabled: boolean) => Promise<void>;
  permissions: DesktopPermissionState | undefined;
  permissionBusy: string;
  permissionConfirmed: boolean;
  onPermissionAction: (action: PermissionAction) => Promise<void>;
  onOpenPermissionGuide: () => void;
  update: DesktopUpdateState | undefined;
  updateBusy: string;
  onUpdateAction: (action: DesktopUpdateAction) => Promise<void>;
  onOpenUrl: (url: string) => void;
  community: CommunityInfo;
  runtimeErrorText: string | undefined;
  onOpenFeedbackPack: (runtimeError?: string) => void;
  onOpenRoadmap: () => void;
  onCopy: (text: string) => Promise<void>;
  makerAccountsProjectRoot: string | undefined;
  onOpenMakerConsole: (accountId?: string) => void;
  notify: (message: string, kind?: ToastKind) => void;
  makerVersions: MakerVersionState | undefined;
  nodeVersions: NodeVersionState | undefined;
  makerVersionBusy: MakerVersionBusy;
  onCheckMakerVersions: () => Promise<void>;
  onSelectMakerVersion: (mode: MakerRuntimeMode, version?: string) => Promise<void>;
  onInstallRequiredMakerMcp: () => Promise<void>;
  onInstallMakerChannel: (channel: "stable" | "beta") => Promise<void>;
  onSyncNode: () => Promise<void>;
  onUpgradeNode: () => Promise<void>;
}) {
  const reportedProtocol = systemInfo?.protocolVersion;
  const protocolVersion = typeof reportedProtocol === "number" ? reportedProtocol : health ? 1 : "—";
  const nodeVersion = systemText(systemInfo, "node") ?? "—";
  const platform = systemText(systemInfo, "platform") ?? "—";
  const activeEntry = systemText(systemInfo, "activeUiEntry") ?? activeUiPath ?? "—";

  return (
    <section className="overlay-panel panel settings-panel" aria-label="设置">
      <div className="overlay-heading"><strong>设置 / 系统</strong><button onClick={onClose}>关闭</button></div>
      <div className="settings-grid">
        <div>
          <h3>连接</h3>
          <p>Bridge：{apiBase}</p>
          <p>协议：{String(protocolVersion)}</p>
          <p>Node：{nodeVersion}</p>
          <p>平台：{platform}</p>
        </div>
        <div>
          <h3>Maker</h3>
          <p>版本：{health?.makerVersion || "未发现"}</p>
          <p>项目：{projectRoot}</p>
          <p>当前 UI：{activeEntry}</p>
        </div>

        {window.tapMakerWork?.hardwareAcceleration && hardware && (
          <section className="desktop-system-card" aria-labelledby="hardware-acceleration-heading">
            <div className="desktop-card-heading">
              <div><h3 id="hardware-acceleration-heading">硬件加速</h3><p>默认开启，用 GPU 渲染 IDE 与 Web 预览。关闭后改用软件渲染，CPU 与功耗会明显升高；改动需重启应用生效。</p></div>
              <span className={hardware.active ? "ready" : "neutral"}>{hardware.active ? "运行中" : "已关闭"}</span>
            </div>
            <label className="settings-switch-row">
              <span><Cpu size={15} /><strong>启用硬件加速</strong><small>遇到花屏、驱动崩溃或远程桌面兼容问题时请保持关闭。</small></span>
              <input type="checkbox" checked={hardware.enabled} disabled={hardwareBusy} onChange={(event) => void onToggleHardware(event.target.checked)} />
            </label>
            {hardware.restartRequired && (
              <div className="desktop-card-actions">
                <span className="desktop-card-note">设置已更改，重启后生效。</span>
                <button className="primary" onClick={onRestartHardware}>立即重启</button>
              </div>
            )}
          </section>
        )}

        {window.tapMakerWork?.legal && (
          <section className="desktop-system-card" aria-labelledby="legal-settings-heading">
            <div className="desktop-card-heading">
              <div><h3 id="legal-settings-heading">用户协议与隐私</h3><p>{legal?.acceptedAt ? `已于 ${new Date(legal.acceptedAt).toLocaleString()} 接受` : "首次使用前需要确认"}</p></div>
              <ScrollText size={18} />
            </div>
            <div className="desktop-card-actions"><button onClick={onOpenLegalDialog}>查看 EULA 与隐私政策</button></div>
          </section>
        )}

        {window.tapMakerWork?.telemetry && telemetry && (
          <DesktopTelemetryCard telemetry={telemetry} busy={telemetryBusy} onToggle={onToggleTelemetry} />
        )}
        {window.tapMakerWork?.permissions && permissions && (
          <DesktopPermissionsCard
            permissions={permissions}
            busy={permissionBusy}
            confirmed={permissionConfirmed}
            onAction={onPermissionAction}
            onOpenGuide={onOpenPermissionGuide}
          />
        )}
        {window.tapMakerWork?.updates && update && (
          <DesktopUpdateCard update={update} busy={updateBusy} onAction={onUpdateAction} onOpenUrl={onOpenUrl} />
        )}

        <section className="desktop-system-card community-card" aria-labelledby="community-heading">
          <div className="desktop-card-heading">
            <div>
              <h3 id="community-heading">社区交流</h3>
              <p>
                {community.qqGroupName} · 群号 {community.qqGroupId}。反馈问题、讨论用法、获取后续功能动态。
                {community.source && community.source !== "builtin" ? `（来自 ${community.source === "gitee" ? "Gitee" : "GitHub"}）` : ""}
              </p>
            </div>
            <span className="ready">QQ</span>
          </div>
          <div className="desktop-card-actions">
            <button className="primary" onClick={() => onOpenUrl(community.qqGroupJoinUrl)}><Users size={13} />一键入群</button>
            <button onClick={() => void onCopy(community.qqGroupId)}><Copy size={13} />复制群号</button>
            <button onClick={() => onOpenFeedbackPack(runtimeErrorText)}><LifeBuoy size={13} />一键反馈包</button>
            <button onClick={onOpenRoadmap}><Map size={13} />后续规划</button>
            <button onClick={() => onOpenUrl(community.officialSiteUrl || OFFICIAL_SITE_URL)}><ExternalLink size={13} />官网</button>
          </div>
        </section>

        <MakerAccountsCard
          open
          {...(makerAccountsProjectRoot ? { projectRoot: makerAccountsProjectRoot } : {})}
          notify={notify}
          onOpenConsole={onOpenMakerConsole}
        />
        <MakerVersionSettings
          makerVersions={makerVersions}
          nodeVersions={nodeVersions}
          busy={makerVersionBusy}
          onCheck={onCheckMakerVersions}
          onSelect={onSelectMakerVersion}
          onInstallRequired={onInstallRequiredMakerMcp}
          onInstallChannel={onInstallMakerChannel}
          onSyncNode={onSyncNode}
          onUpgradeNode={onUpgradeNode}
          onCopy={onCopy}
        />

        <div>
          <h3>Runtime 适配器</h3>
          <p>{adapterExport || (health?.runtimeAdapter?.installed ? `已安装：${health.runtimeAdapter.paths.join(", ")}` : "未安装到当前 Maker 项目")}</p>
          <p>后端：{health?.uiBackend || health?.runtimeAdapter?.backend || "自动检测"} · Session：{health?.runtimeSessionId || "未连接"}</p>
          <button onClick={() => void onExportRuntimeAdapter()}>导出接入包到 outputs/runtime-adapter</button>
        </div>
        <div>
          <h3>能力</h3>
          <p>Maker CLI：{health?.capabilities.makerCli ? "可用" : "不可用"}</p>
          <p>UI Bridge：{health?.capabilities.uiBridge ? "可用" : "不可用"}</p>
          <p>Runtime 帧：{health?.capabilities.runtimeFrames ? "可用" : "未接入"}</p>
          <p>Shell 沙箱：{health?.capabilities.shellSandbox ? "就绪" : "锁定"}</p>
        </div>
      </div>
    </section>
  );
}
