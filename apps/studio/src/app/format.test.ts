import { describe, expect, it } from "vitest";
import { formatBytes, formatUptime } from "./format";

describe("formatBytes", () => {
  it("picks a readable unit", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.00 MB");
  });
});

describe("formatUptime", () => {
  const now = Date.parse("2026-10-12T10:00:00Z");

  it("describes how long a runtime has been running", () => {
    expect(formatUptime("2026-10-12T09:59:30Z", now)).toBe("刚刚启动");
    expect(formatUptime("2026-10-12T09:48:00Z", now)).toBe("已运行 12 分钟");
    expect(formatUptime("2026-10-12T07:30:00Z", now)).toBe("已运行 2 小时 30 分");
    expect(formatUptime("2026-10-09T10:00:00Z", now)).toBe("已运行 3 天");
  });

  it("handles missing timestamps", () => {
    expect(formatUptime(undefined, now)).toBe("启动时间未知");
    expect(formatUptime("garbage", now)).toBe("启动时间未知");
  });
});
