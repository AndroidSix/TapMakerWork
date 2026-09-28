import { describe, expect, it } from "vitest";
import { privateBrowserOpenScript } from "./private-browser.js";

describe("privateBrowserOpenScript", () => {
  it("macOS 登录页走无痕窗口", () => {
    const script = privateBrowserOpenScript("darwin");
    expect(script).toContain("--incognito --new-window");
    expect(script).toContain("--inprivate --new-window");
    expect(script).toContain("--private-window");
    expect(script).toContain('exec /usr/bin/open "$@"');
  });
});
