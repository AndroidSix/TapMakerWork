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
  releaseUrl?: string | undefined;
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
  endpoint: string;
  installId: string;
  sessionId: string;
  sessionMs: number;
  activeMs: number;
  lifetimeActiveMs: number;
  lifetimeSessionMs: number;
  sessionCount: number;
  pendingEvents: number;
  sessionLabel: string;
  activeLabel: string;
  lifetimeActiveLabel: string;
  lifetimeSessionLabel: string;
  lastFlushAt?: string | undefined;
  lastFlushError?: string | undefined;
}
