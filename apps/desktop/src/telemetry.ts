import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type TelemetryProp = string | number | boolean | null;
export type TelemetryProps = Record<string, TelemetryProp>;

export interface TelemetryEvent {
  name: string;
  ts: string;
  sessionId: string;
  installId: string;
  appVersion: string;
  platform: string;
  props: TelemetryProps;
}

export interface TelemetrySummary {
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
  lastFlushAt?: string | undefined;
  lastFlushError?: string | undefined;
}

export interface TelemetryPersistedState {
  installId: string;
  lifetimeActiveMs: number;
  lifetimeSessionMs: number;
  sessionCount: number;
  lastFlushAt?: string | undefined;
  lastFlushError?: string | undefined;
}

const MAX_QUEUE = 500;
const FLUSH_BATCH = 40;
const HEARTBEAT_MS = 60_000;
const FLUSH_INTERVAL_MS = 90_000;
const ALLOWED_EVENT = /^[a-z][a-z0-9_.]{1,63}$/;

export function createInstallId(): string {
  return crypto.randomUUID();
}

export function createSessionId(): string {
  return crypto.randomUUID();
}

export function sanitizeProps(input: Record<string, unknown> | undefined): TelemetryProps {
  const out: TelemetryProps = {};
  if (!input) return out;
  for (const [key, value] of Object.entries(input)) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/.test(key)) continue;
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      if (typeof value === "string") out[key] = value.slice(0, 120);
      else if (typeof value === "number") out[key] = Number.isFinite(value) ? value : null;
      else out[key] = value;
    }
  }
  return out;
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
      sessionCount: Number(raw.sessionCount) > 0 ? Number(raw.sessionCount) : 0,
      ...(typeof raw.lastFlushAt === "string" ? { lastFlushAt: raw.lastFlushAt } : {}),
      ...(typeof raw.lastFlushError === "string" ? { lastFlushError: raw.lastFlushError } : {})
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

export function appendQueue(filePath: string, events: TelemetryEvent[]): void {
  if (events.length === 0) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
}

export function readQueue(filePath: string): TelemetryEvent[] {
  try {
    const text = fs.readFileSync(filePath, "utf8");
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as TelemetryEvent;
        } catch {
          return undefined;
        }
      })
      .filter((event): event is TelemetryEvent => Boolean(event?.name));
  } catch {
    return [];
  }
}

export function rewriteQueue(filePath: string, events: TelemetryEvent[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (events.length === 0) {
    if (fs.existsSync(filePath)) fs.writeFileSync(filePath, "", "utf8");
    return;
  }
  const trimmed = events.slice(-MAX_QUEUE);
  fs.writeFileSync(filePath, `${trimmed.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
}

export interface TelemetryControllerOptions {
  userDataPath: string;
  appVersion: string;
  platform: string;
  enabled: boolean;
  endpoint?: string | undefined;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (message: string) => void;
}

export class TelemetryController {
  readonly sessionId = createSessionId();
  private readonly statePath: string;
  private readonly queuePath: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private readonly appVersion: string;
  private readonly platform: string;
  private enabled: boolean;
  private endpoint: string;
  private state: TelemetryPersistedState;
  private sessionStartedAt: number;
  private activeStartedAt: number | undefined;
  private activeMs = 0;
  private focused = false;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private flushTimer: NodeJS.Timeout | undefined;
  private flushing = false;
  private pendingMemory: TelemetryEvent[] = [];

  constructor(options: TelemetryControllerOptions) {
    this.statePath = path.join(options.userDataPath, "telemetry-state.json");
    this.queuePath = path.join(options.userDataPath, "telemetry-queue.jsonl");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => undefined);
    this.appVersion = options.appVersion;
    this.platform = options.platform;
    this.enabled = options.enabled;
    this.endpoint = (options.endpoint || "").trim();
    this.state = readPersistedState(this.statePath);
    this.sessionStartedAt = this.now();
    writePersistedState(this.statePath, this.state);
  }

  start(): void {
    if (!this.enabled) return;
    this.track("app.launch", {
      session_count: this.state.sessionCount + 1,
      lifetime_active_ms: this.state.lifetimeActiveMs
    });
    this.setFocused(true);
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    this.flushTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
  }

  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.heartbeatTimer = undefined;
    this.flushTimer = undefined;
    this.setFocused(false);
    const sessionMs = this.sessionMs();
    if (this.enabled) {
      this.track("app.quit", {
        session_ms: sessionMs,
        active_ms: Math.round(this.activeMs)
      });
      this.state.lifetimeActiveMs += Math.round(this.activeMs);
      this.state.lifetimeSessionMs += sessionMs;
      this.state.sessionCount += 1;
      writePersistedState(this.statePath, this.state);
    }
    void this.flush(true);
  }

  setEnabled(enabled: boolean): TelemetrySummary {
    const next = Boolean(enabled);
    if (next === this.enabled) return this.summary();
    this.enabled = next;
    if (next) {
      this.sessionStartedAt = this.now();
      this.activeMs = 0;
      this.activeStartedAt = this.focused ? this.now() : undefined;
      this.track("telemetry.enabled", {});
      if (!this.heartbeatTimer) this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
      if (!this.flushTimer) this.flushTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    } else {
      this.track("telemetry.disabled", {
        session_ms: this.sessionMs(),
        active_ms: Math.round(this.activeMs)
      });
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      if (this.flushTimer) clearInterval(this.flushTimer);
      this.heartbeatTimer = undefined;
      this.flushTimer = undefined;
      void this.flush(true);
    }
    return this.summary();
  }

  setEndpoint(endpoint: string): TelemetrySummary {
    this.endpoint = endpoint.trim();
    if (this.enabled && this.endpoint) void this.flush();
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

  track(name: string, props?: Record<string, unknown>): void {
    if (!this.enabled) return;
    if (!ALLOWED_EVENT.test(name)) return;
    const event: TelemetryEvent = {
      name,
      ts: new Date(this.now()).toISOString(),
      sessionId: this.sessionId,
      installId: this.state.installId,
      appVersion: this.appVersion,
      platform: this.platform,
      props: sanitizeProps(props)
    };
    this.pendingMemory.push(event);
    if (this.pendingMemory.length >= 8) this.persistPending();
    if (this.pendingMemory.length + readQueue(this.queuePath).length >= FLUSH_BATCH) void this.flush();
  }

  summary(): TelemetrySummary {
    this.persistPending();
    const queued = readQueue(this.queuePath).length;
    return {
      enabled: this.enabled,
      endpoint: this.endpoint,
      installId: this.state.installId,
      sessionId: this.sessionId,
      sessionMs: this.sessionMs(),
      activeMs: this.currentActiveMs(),
      lifetimeActiveMs: this.state.lifetimeActiveMs + (this.enabled ? this.currentActiveMs() : 0),
      lifetimeSessionMs: this.state.lifetimeSessionMs + (this.enabled ? this.sessionMs() : 0),
      sessionCount: this.state.sessionCount + (this.enabled ? 1 : 0),
      pendingEvents: queued,
      ...(this.state.lastFlushAt ? { lastFlushAt: this.state.lastFlushAt } : {}),
      ...(this.state.lastFlushError ? { lastFlushError: this.state.lastFlushError } : {})
    };
  }

  async flush(force = false): Promise<{ ok: boolean; sent: number; error?: string }> {
    if (this.flushing) return { ok: true, sent: 0 };
    this.persistPending();
    const queue = readQueue(this.queuePath);
    if (queue.length === 0) return { ok: true, sent: 0 };
    if (!this.endpoint) {
      if (queue.length > MAX_QUEUE) rewriteQueue(this.queuePath, queue.slice(-MAX_QUEUE));
      return { ok: true, sent: 0 };
    }
    if (!force && queue.length < 5) return { ok: true, sent: 0 };
    this.flushing = true;
    const batch = queue.slice(0, FLUSH_BATCH);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": `TapMakerWork/${this.appVersion}` },
        body: JSON.stringify({
          schemaVersion: 1,
          sentAt: new Date(this.now()).toISOString(),
          events: batch
        })
      });
      if (!response.ok) throw new Error(`telemetry_http_${response.status}`);
      rewriteQueue(this.queuePath, queue.slice(batch.length));
      this.state.lastFlushAt = new Date(this.now()).toISOString();
      delete this.state.lastFlushError;
      writePersistedState(this.statePath, this.state);
      return { ok: true, sent: batch.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state.lastFlushError = message.slice(0, 200);
      writePersistedState(this.statePath, this.state);
      this.log(`telemetry flush failed: ${message}`);
      return { ok: false, sent: 0, error: message };
    } finally {
      this.flushing = false;
    }
  }

  private heartbeat(): void {
    this.track("session.heartbeat", {
      session_ms: this.sessionMs(),
      active_ms: this.currentActiveMs()
    });
  }

  private sessionMs(): number {
    return Math.max(0, Math.round(this.now() - this.sessionStartedAt));
  }

  private currentActiveMs(): number {
    const live = this.focused && this.activeStartedAt !== undefined ? Math.max(0, this.now() - this.activeStartedAt) : 0;
    return Math.round(this.activeMs + live);
  }

  private persistPending(): void {
    if (this.pendingMemory.length === 0) return;
    const batch = this.pendingMemory.splice(0, this.pendingMemory.length);
    appendQueue(this.queuePath, batch);
    const queue = readQueue(this.queuePath);
    if (queue.length > MAX_QUEUE) rewriteQueue(this.queuePath, queue.slice(-MAX_QUEUE));
  }
}
