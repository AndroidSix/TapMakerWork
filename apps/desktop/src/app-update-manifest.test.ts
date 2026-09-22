import { describe, expect, it } from "vitest";
import {
  normalizeUpdateManifest,
  nextSnoozeUntil,
  pickPlatformDownloadUrl,
  resolveUpdateReminder,
  shouldPromptUpdate
} from "./app-update-manifest.js";

describe("app update manifest", () => {
  it("normalizes version.json payloads", () => {
    const manifest = normalizeUpdateManifest({
      latest: "v0.1.2",
      title: "修复注入",
      notes: ["a", "", "b"],
      force: true,
      downloads: {
        macArm64: "https://example.com/arm.dmg",
        page: "https://example.com/releases"
      }
    }, "gitee");
    expect(manifest).toMatchObject({
      latest: "0.1.2",
      title: "修复注入",
      notes: ["a", "b"],
      force: true,
      source: "gitee"
    });
    expect(manifest?.downloads.macArm64).toContain("arm.dmg");
  });

  it("picks platform download urls", () => {
    const downloads = {
      macArm64: "arm",
      macX64: "x64",
      windowsX64: "win",
      page: "page"
    };
    expect(pickPlatformDownloadUrl(downloads, "darwin", "arm64")).toBe("arm");
    expect(pickPlatformDownloadUrl(downloads, "darwin", "x64")).toBe("x64");
    expect(pickPlatformDownloadUrl(downloads, "win32", "x64")).toBe("win");
    expect(pickPlatformDownloadUrl({}, "linux", "x64")).toBeUndefined();
  });

  it("respects mute and snooze unless force", () => {
    expect(shouldPromptUpdate({ currentVersion: "0.1.0", latestVersion: "0.1.1" })).toBe(true);
    expect(shouldPromptUpdate({
      currentVersion: "0.1.0",
      latestVersion: "0.1.1",
      mutedVersion: "0.1.1"
    })).toBe(false);
    expect(shouldPromptUpdate({
      currentVersion: "0.1.0",
      latestVersion: "0.1.1",
      snoozeUntil: Date.now() + 60_000
    })).toBe(false);
    expect(shouldPromptUpdate({
      currentVersion: "0.1.0",
      latestVersion: "0.1.1",
      mutedVersion: "0.1.1",
      force: true
    })).toBe(true);
    expect(resolveUpdateReminder({
      currentVersion: "0.1.0",
      latestVersion: "0.1.1",
      mutedVersion: "0.1.1"
    })).toBe("muted");
    expect(nextSnoozeUntil(1_000)).toBe(1_000 + 24 * 60 * 60 * 1000);
  });
});
