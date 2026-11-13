export interface DesktopPermissionState {
  platform: string;
  packaged: boolean;
  stableIdentity: boolean;
  /** 安装包签名是否通过 codesign 校验；无效时系统无法保存录屏授权。 */
  signatureValid?: boolean | undefined;
  screen: "granted" | "denied" | "restricted" | "not-determined" | "unavailable";
  accessibility: "granted" | "denied" | "restricted" | "not-determined" | "unavailable";
  ready: boolean;
  /** 用户已确认过授权（主进程持久化，跨重启与缓存清理有效）。 */
  acknowledged?: boolean | undefined;
  /** 用户主动选择过「稍后设置」（主进程持久化）。 */
  dismissed?: boolean | undefined;
}

export interface DesktopUpdateState {
  phase: "idle" | "checking" | "available" | "up-to-date" | "downloading" | "downloaded" | "error" | "unconfigured";
  currentVersion: string;
  availableVersion?: string | undefined;
  percent?: number | undefined;
  transferred?: number | undefined;
  total?: number | undefined;
  message?: string | undefined;
  releaseUrl?: string | undefined;
  downloadUrl?: string | undefined;
  siteUrl?: string | undefined;
  title?: string | undefined;
  notes?: string[] | undefined;
  links?: Array<{ label: string; url: string }> | undefined;
  reminder?: "show" | "snoozed" | "muted" | "hidden" | undefined;
  source?: "gitee" | "github" | "builtin" | "gitee-release" | undefined;
  force?: boolean | undefined;
  packaged: boolean;
}

export interface DesktopHardwareAccelerationState {
  enabled: boolean;
  active: boolean;
  restartRequired: boolean;
}

export interface DesktopLegalState {
  version: string;
  accepted: boolean;
  acceptedAt?: string | undefined;
}

export interface DesktopTelemetryState {
  enabled: boolean;
  provider: "gamealgo";
  installId: string;
  sessionId: string;
  sessionMs: number;
  activeMs: number;
  lifetimeActiveMs: number;
  lifetimeSessionMs: number;
  sessionCount: number;
  sessionLabel: string;
  activeLabel: string;
  lifetimeActiveLabel: string;
  lifetimeSessionLabel: string;
  gameKey: string;
  gameKeyConfigured: boolean;
  baseUrl: string;
  dashboardUrl: string;
}
