import { describe, expect, it } from "vitest";
import { giteeReleaseDownloadBase, isVersionNewer, normalizeReleaseVersion } from "./release-update.js";

describe("Gitee release updates", () => {
  it("normalizes release tags", () => {
    expect(normalizeReleaseVersion("v1.2.3")).toBe("1.2.3");
  });

  it("compares stable and prerelease versions", () => {
    expect(isVersionNewer("v0.2.0", "0.1.9")).toBe(true);
    expect(isVersionNewer("0.1.0", "0.1.0")).toBe(false);
    expect(isVersionNewer("0.1.0", "0.1.0-beta.2")).toBe(true);
    expect(isVersionNewer("0.1.0-beta.1", "0.1.0")).toBe(false);
  });

  it("builds the generic updater directory from the release tag", () => {
    expect(giteeReleaseDownloadBase("v0.2.0")).toBe("https://gitee.com/AndroidSUP/tap-maker-work/releases/download/v0.2.0/");
  });
});
