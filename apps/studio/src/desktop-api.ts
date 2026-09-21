export interface DesktopPermissionState {
  platform: string;
  packaged: boolean;
  stableIdentity: boolean;
  screen: "granted" | "denied" | "restricted" | "not-determined" | "unavailable";
  accessibility: "granted" | "denied" | "restricted" | "not-determined" | "unavailable";
  ready: boolean;
}

export interface DesktopUpdateState {
  phase: "idle" | "checking" | "available" | "up-to-date" | "downloading" | "downloaded" | "error" | "unconfigured";
  currentVersion: string;
  availableVersion?: string | undefined;
  percent?: number | undefined;
  transferred?: number | undefined;
  total?: number | undefined;
  message?: string | undefined;
  updateUrl?: string | undefined;
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
