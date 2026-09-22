import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface TelemetrySummary {
  enabled: boolean;
  provider: "gamealgo";
  installId: string;
  sessionId: string;
  sessionMs: number;
  activeMs: number;
  lifetimeActiveMs: number;
  lifetimeSessionMs: number;
  sessionCount: number;
}

export interface TelemetryPersistedState {
  installId: string;
  lifetimeActiveMs: number;
  lifetimeSessionMs: number;
  sessionCount: number;
}

export function createInstallId(): string {
  return crypto.randomUUID();
}

export function createSessionId(): string {
  return crypto.randomUUID();
}

export function formatDurationMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分 ${seconds} 秒`;
  return `${seconds} 秒`;
}

export function readPersistedState(filePath: string): TelemetryPersistedState {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<TelemetryPersistedState>;
    return {
      installId: typeof raw.installId === "string" && raw.installId ? raw.installId : createInstallId(),
      lifetimeActiveMs: Number(raw.lifetimeActiveMs) > 0 ? Number(raw.lifetimeActiveMs) : 0,
      lifetimeSessionMs: Number(raw.lifetimeSessionMs) > 0 ? Number(raw.lifetimeSessionMs) : 0,
      sessionCount: Number(raw.sessionCount) > 0 ? Number(raw.sessionCount) : 0
    };
  } catch {
    return {
      installId: createInstallId(),
      lifetimeActiveMs: 0,
      lifetimeSessionMs: 0,
      sessionCount: 0
    };
  }
}

export function writePersistedState(filePath: string, state: TelemetryPersistedState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export interface TelemetryControllerOptions {
  userDataPath: string;
  enabled: boolean;
  now?: () => number;
  onSessionEnd?: (payload: { session_ms: number; active_ms: number }) => void;
}

/** Local session/active duration only. Product events go through GameAlgo in the renderer. */
export class TelemetryController {
  readonly sessionId = createSessionId();
  private readonly statePath: string;
  private readonly now: () => number;
  private readonly onSessionEnd: ((payload: { session_ms: number; active_ms: number }) => void) | undefined;
  private enabled: boolean;
  private state: TelemetryPersistedState;
  private sessionStartedAt: number;
  private activeStartedAt: number | undefined;
  private activeMs = 0;
  private focused = false;
  private running = false;

  constructor(options: TelemetryControllerOptions) {
    this.statePath = path.join(options.userDataPath, "telemetry-state.json");
    this.now = options.now ?? Date.now;
    this.onSessionEnd = options.onSessionEnd;
    this.enabled = options.enabled;
    this.state = readPersistedState(this.statePath);
    this.sessionStartedAt = this.now();
    writePersistedState(this.statePath, this.state);
  }

  start(): void {
    if (!this.enabled) return;
    this.running = true;
    this.setFocused(true);
  }

  stop(): void {
    this.setFocused(false);
    const sessionMs = this.sessionMs();
    const activeMs = Math.round(this.activeMs);
    if (this.enabled && this.running) {
      this.state.lifetimeActiveMs += activeMs;
      this.state.lifetimeSessionMs += sessionMs;
      this.state.sessionCount += 1;
      writePersistedState(this.statePath, this.state);
      this.onSessionEnd?.({ session_ms: sessionMs, active_ms: activeMs });
    }
    this.running = false;
  }

  setEnabled(enabled: boolean): TelemetrySummary {
    const next = Boolean(enabled);
    if (next === this.enabled) return this.summary();
    this.enabled = next;
    if (next) {
      this.running = true;
      this.sessionStartedAt = this.now();
      this.activeMs = 0;
      this.activeStartedAt = this.focused ? this.now() : undefined;
    } else {
      this.running = false;
    }
    return this.summary();
  }

  setFocused(focused: boolean): void {
    if (focused === this.focused) return;
    if (this.focused && this.activeStartedAt !== undefined) {
      this.activeMs += Math.max(0, this.now() - this.activeStartedAt);
    }
    this.focused = focused;
    this.activeStartedAt = focused ? this.now() : undefined;
  }

  summary(): TelemetrySummary {
    const live = this.enabled && this.running;
    return {
      enabled: this.enabled,
      provider: "gamealgo",
      installId: this.state.installId,
      sessionId: this.sessionId,
      sessionMs: live ? this.sessionMs() : 0,
      activeMs: live ? this.currentActiveMs() : 0,
      lifetimeActiveMs: this.state.lifetimeActiveMs + (live ? this.currentActiveMs() : 0),
      lifetimeSessionMs: this.state.lifetimeSessionMs + (live ? this.sessionMs() : 0),
      sessionCount: this.state.sessionCount + (live ? 1 : 0)
    };
  }

  private sessionMs(): number {
    return Math.max(0, Math.round(this.now() - this.sessionStartedAt));
  }

  private currentActiveMs(): number {
    const live = this.focused && this.activeStartedAt !== undefined ? Math.max(0, this.now() - this.activeStartedAt) : 0;
    return Math.round(this.activeMs + live);
  }
}
