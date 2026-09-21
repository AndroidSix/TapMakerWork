import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TelemetryController,
  formatDurationMs,
  sanitizeProps
} from "./telemetry.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-telemetry-"));
  tempDirs.push(dir);
  return dir;
}

describe("telemetry helpers", () => {
  it("formats duration in Chinese units", () => {
    expect(formatDurationMs(1_500)).toBe("1 秒");
    expect(formatDurationMs(65_000)).toBe("1 分 5 秒");
    expect(formatDurationMs(3_720_000)).toBe("1 小时 2 分");
  });

  it("keeps only primitive props and truncates strings", () => {
    expect(sanitizeProps({
      ok: true,
      count: 3,
      note: "x".repeat(200),
      nested: { a: 1 },
      "bad key": 1
    })).toEqual({
      ok: true,
      count: 3,
      note: "x".repeat(120)
    });
  });
});

describe("TelemetryController", () => {
  it("tracks session and active duration, and flushes to endpoint", async () => {
    const dir = tempDir();
    let now = 1_000;
    const posts: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      posts.push(JSON.parse(String(init?.body || "{}")));
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const telemetry = new TelemetryController({
      userDataPath: dir,
      appVersion: "0.1.0",
      platform: "darwin",
      enabled: true,
      endpoint: "http://127.0.0.1:8787/v1/events",
      fetchImpl,
      now: () => now
    });

    telemetry.start();
    telemetry.track("project.open", { has_adapter: true });
    now += 5_000;
    telemetry.setFocused(false);
    now += 2_000;
    telemetry.setFocused(true);
    now += 3_000;
    telemetry.stop();

    const summary = telemetry.summary();
    expect(summary.sessionMs).toBe(10_000);
    expect(summary.activeMs).toBe(8_000);
    expect(summary.lifetimeSessionMs).toBeGreaterThanOrEqual(10_000);
    expect(summary.sessionCount).toBeGreaterThanOrEqual(1);

    await telemetry.flush(true);
    expect(posts.length).toBeGreaterThan(0);
    const body = posts[0] as { events: Array<{ name: string }> };
    expect(body.events.some((event) => event.name === "app.launch")).toBe(true);
    expect(body.events.some((event) => event.name === "project.open")).toBe(true);
    expect(body.events.some((event) => event.name === "app.quit")).toBe(true);
  });

  it("ignores track calls when disabled", () => {
    const dir = tempDir();
    const telemetry = new TelemetryController({
      userDataPath: dir,
      appVersion: "0.1.0",
      platform: "win32",
      enabled: false
    });
    telemetry.track("project.open", {});
    expect(telemetry.summary().pendingEvents).toBe(0);
  });
});
