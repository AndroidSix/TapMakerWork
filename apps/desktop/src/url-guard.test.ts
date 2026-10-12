import { describe, expect, it } from "vitest";
import { bridgeExitMessage, isHttpsUrl, isWebUrl, safeExternalUrl } from "./url-guard.js";

describe("url guard", () => {
  it("accepts only https for external opens", () => {
    expect(isHttpsUrl("https://maker.taptap.cn/")).toBe(true);
    expect(isHttpsUrl("http://example.com")).toBe(false);
    expect(isHttpsUrl("file:///C:/Windows/System32/calc.exe")).toBe(false);
    expect(isHttpsUrl("ms-settings:privacy")).toBe(false);
    expect(isHttpsUrl("not a url")).toBe(false);
    expect(isHttpsUrl(undefined)).toBe(false);
  });

  it("accepts http and https for the embedded preview", () => {
    expect(isWebUrl("http://127.0.0.1:5173/")).toBe(true);
    expect(isWebUrl("https://preview.taptap.cn/x")).toBe(true);
    expect(isWebUrl("javascript:alert(1)")).toBe(false);
    expect(isWebUrl("file:///etc/passwd")).toBe(false);
  });

  it("falls back when the external url is unsafe", () => {
    expect(safeExternalUrl("file:///tmp/x.exe", "https://fallback.example/")).toBe("https://fallback.example/");
    expect(safeExternalUrl("https://ok.example/", "https://fallback.example/")).toBe("https://ok.example/");
  });

  it("explains a port conflict and keeps the last stderr lines", () => {
    expect(bridgeExitMessage(98, "a\nb\nc\nd")).toContain("43121 已被占用");
    expect(bridgeExitMessage(98, "a\nb\nc\nd")).toMatch(/b\nc\nd$/);
    expect(bridgeExitMessage(1, "")).toBe("Bridge 进程意外退出（退出码 1）。");
  });
});
