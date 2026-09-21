import { describe, expect, it } from "vitest";
import { extractRuntimeErrorReport } from "./runtime-error";

describe("runtime error report", () => {
  it("extracts a copy-ready TapTap Maker error report", () => {
    const report = extractRuntimeErrorReport([
      "[INFO] Runtime started",
      "[ERROR] scripts/ui/HomePage.lua:92: attempt to index a nil value",
      "stack traceback:",
      "  scripts/ui/HomePage.lua:92: in function 'open'"
    ]);
    expect(report?.errorText).toContain("HomePage.lua:92");
    expect(report?.clipboardText).toContain("请修复游戏中的以下错误");
    expect(report?.clipboardText).toContain("TapTap Maker - Error Report");
  });

  it("ignores healthy summaries", () => {
    expect(extractRuntimeErrorReport(["[INFO] validation complete: 0 errors"])).toBeUndefined();
  });
});
