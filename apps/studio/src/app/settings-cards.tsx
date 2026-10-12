import { CheckCircle2, Clock3, Copy, Download, ExternalLink, RefreshCw, ShieldAlert } from "lucide-react";
import { REQUIRED_MAKER_MCP_VERSION, isRequiredMakerMcpVersion } from "@tapmakerwork/protocol";
import type { DesktopPermissionState, DesktopTelemetryState, DesktopUpdateState } from "../desktop-api";
import { OFFICIAL_SITE_URL } from "./constants";
import type { DesktopUpdateAction, MakerRuntimeMode, MakerVersionBusy, MakerVersionState, NodeVersionState, PermissionAction } from "./types";
import { UpdateDocLinks, UpdateNoteText } from "./update-dialogs";

export function DesktopTelemetryCard({ telemetry: desktopTelemetry, busy: telemetryBusy, onToggle: setTelemetryEnabled }: {
  telemetry: DesktopTelemetryState;
  busy: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
}) {
  return (
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
  );
}

export function DesktopPermissionsCard({ permissions: desktopPermissions, busy: permissionBusy, confirmed: permissionConfirmed, onAction: runPermissionAction, onOpenGuide }: {
  permissions: DesktopPermissionState;
  busy: string;
  confirmed: boolean;
  onAction: (action: PermissionAction) => Promise<void>;
  onOpenGuide: () => void;
}) {
  return (
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
        <button onClick={onOpenGuide}>查看授权向导</button>
        <button onClick={() => void runPermissionAction("refresh")} disabled={Boolean(permissionBusy)}><RefreshCw size={13} />重新检测</button>
        <button onClick={() => void runPermissionAction("confirm")} disabled={Boolean(permissionBusy)}><CheckCircle2 size={13} />{permissionConfirmed ? "已确认授权" : "我已授权"}</button>
        <button className="primary" onClick={() => void runPermissionAction("restart")} disabled={!desktopPermissions.ready && !permissionConfirmed}>重启应用</button>
      </div>
      {!desktopPermissions.stableIdentity && <p className="desktop-card-note">开发模式的授权归属 Electron；请用签名后的正式安装包在新机器授权。</p>}
    </section>
  );
}

export function DesktopUpdateCard({ update: desktopUpdate, busy: desktopUpdateBusy, onAction: runDesktopUpdateAction, onOpenUrl: openExternalUrl }: {
  update: DesktopUpdateState;
  busy: string;
  onAction: (action: DesktopUpdateAction) => Promise<void>;
  onOpenUrl: (url: string) => void;
}) {
  return (
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
          {desktopUpdate.notes.map((note) => (
            <li key={note}><UpdateNoteText text={note} onOpen={openExternalUrl} /></li>
          ))}
        </ul>
      )}
      {desktopUpdate.phase === "available" && (
        <UpdateDocLinks links={desktopUpdate.links} onOpen={openExternalUrl} />
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
  );
}

export function MakerVersionSettings({
  makerVersions,
  nodeVersions,
  busy: makerVersionBusy,
  onCheck: checkMakerUpdates,
  onSelect: selectMakerVersion,
  onInstallRequired: installRequiredMakerMcp,
  onInstallChannel: installMakerChannel,
  onSyncNode: syncSystemNode,
  onUpgradeNode: upgradeSystemNode,
  onCopy: copyText
}: {
  makerVersions: MakerVersionState | undefined;
  nodeVersions: NodeVersionState | undefined;
  busy: MakerVersionBusy;
  onCheck: () => Promise<void>;
  onSelect: (mode: MakerRuntimeMode, version?: string) => Promise<void>;
  onInstallRequired: () => Promise<void>;
  onInstallChannel: (channel: "stable" | "beta") => Promise<void>;
  onSyncNode: () => Promise<void>;
  onUpgradeNode: () => Promise<void>;
  onCopy: (text: string) => Promise<void>;
}) {
  return (
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
      {!isRequiredMakerMcpVersion(makerVersions?.active?.version) && (
        <button
          className="primary maker-required-upgrade"
          onClick={() => void installRequiredMakerMcp()}
          disabled={Boolean(makerVersionBusy)}
        >升级到 {REQUIRED_MAKER_MCP_VERSION}</button>
      )}

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
        {nodeVersions?.upgrade && (nodeVersions.stable.updateAvailable || !nodeVersions.device) && (
          <div className="node-upgrade">
            <small className="node-update-hint">
              {nodeVersions.device
                ? `系统 Node.js 低于最新 LTS ${nodeVersions.stable.latest}，检测到由 ${nodeVersions.upgrade.label} 安装。`
                : `未发现系统 Node.js，可通过 ${nodeVersions.upgrade.label} 安装。`}
            </small>
            <div className="node-upgrade-command">
              <code title={nodeVersions.upgrade.command}>{nodeVersions.upgrade.command}</code>
              <button type="button" onClick={() => void copyText(nodeVersions.upgrade!.command)}><Copy size={12} aria-hidden="true" />复制</button>
              {nodeVersions.upgrade.oneClick && (
                <button
                  type="button"
                  className="primary"
                  disabled={Boolean(makerVersionBusy)}
                  aria-busy={makerVersionBusy === "node-upgrade"}
                  onClick={() => void upgradeSystemNode()}
                >
                  <Download size={12} aria-hidden="true" />{makerVersionBusy === "node-upgrade" ? "升级中…" : "一键升级"}
                </button>
              )}
            </div>
            <small>
              {nodeVersions.upgrade.oneClick ? "一键升级的输出会显示在构建终端；" : `请粘贴到${nodeVersions.upgrade.terminal}执行；`}
              完成后点「重新同步系统版本」。{nodeVersions.upgrade.note ?? ""}
            </small>
          </div>
        )}
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
  );
}
