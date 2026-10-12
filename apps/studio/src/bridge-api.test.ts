import { describe, expect, it } from "vitest";
import { capLogChannels, isEmbeddablePreviewUrl, isWebUrl, readJsonResponse } from "./bridge-api";

describe("bridge api helpers", () => {
  it("only treats http(s) as web urls", () => {
    expect(isWebUrl("https://maker.taptap.cn/")).toBe(true);
    expect(isWebUrl("http://127.0.0.1:5173/")).toBe(true);
    expect(isWebUrl("javascript:alert(1)")).toBe(false);
    expect(isWebUrl("file:///etc/passwd")).toBe(false);
    expect(isWebUrl("")).toBe(false);
  });

  it("refuses qrcode images as embeddable previews", () => {
    expect(isEmbeddablePreviewUrl("http://127.0.0.1:5173/index.html")).toBe(true);
    expect(isEmbeddablePreviewUrl("https://cdn.example/qrcode.png")).toBe(false);
    expect(isEmbeddablePreviewUrl("data:text/html,<script>1</script>")).toBe(false);
  });

  it("keeps only the newest lines of each log channel", () => {
    const logs = { build: ["1", "2", "3", "4"], runtime: ["a"] };
    expect(capLogChannels(logs, 2)).toEqual({ build: ["3", "4"], runtime: ["a"] });
    expect(capLogChannels(logs, 10)).toBe(logs);
  });

  it("turns non-ok responses into errors with the bridge message", async () => {
    await expect(readJsonResponse(new Response(JSON.stringify({ error: "project_not_open" }), { status: 400 }), "读取失败")).rejects.toThrow("project_not_open");
    await expect(readJsonResponse(new Response("oops", { status: 502 }), "读取失败")).rejects.toThrow("读取失败（HTTP 502）");
    await expect(readJsonResponse<{ ok: boolean }>(new Response(JSON.stringify({ ok: true })), "读取失败")).resolves.toEqual({ ok: true });
  });
});
