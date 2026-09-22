import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  TelemetryController,
  formatDurationMs
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
});

describe("TelemetryController", () => {
  it("tracks session and active duration locally", () => {
    const dir = tempDir();
    let now = 1_000;
    let ended: { session_ms: number; active_ms: number } | undefined;
    const telemetry = new TelemetryController({
      userDataPath: dir,
      enabled: true,
      now: () => now,
      onSessionEnd: (payload) => { ended = payload; }
    });

    telemetry.start();
    now += 5_000;
    telemetry.setFocused(false);
    now += 2_000;
    telemetry.setFocused(true);
    now += 3_000;
    telemetry.stop();

    const summary = telemetry.summary();
    expect(summary.provider).toBe("gamealgo");
    expect(summary.sessionMs).toBe(0);
    expect(ended?.session_ms).toBe(10_000);
    expect(ended?.active_ms).toBe(8_000);
    expect(summary.lifetimeSessionMs).toBe(10_000);
    expect(summary.lifetimeActiveMs).toBe(8_000);
    expect(summary.sessionCount).toBe(1);
  });

  it("ignores duration accrual when disabled", () => {
    const dir = tempDir();
    const telemetry = new TelemetryController({
      userDataPath: dir,
      enabled: false
    });
    telemetry.start();
    expect(telemetry.summary().enabled).toBe(false);
  });
});
