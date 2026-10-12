import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createLogRing } from "../feedback-pack.js";
import { createAssetRoutes } from "./asset-routes.js";
import { createFeedbackRoutes } from "./feedback-routes.js";
import { createGitRoutes } from "./git-routes.js";
import { findRoute, type BridgeRoute } from "./route-table.js";
import { createRuntimeRoutes } from "./runtime-routes.js";
import { callRoute } from "./route-test-helpers.js";
import { createToolsRoutes } from "./tools-routes.js";

describe("route table", () => {
  const routes: BridgeRoute[] = [
    { method: "GET", path: "/api/a", handle: () => undefined },
    { method: "POST", path: "/api/a", handle: () => undefined }
  ];

  it("matches on both method and exact path", () => {
    expect(findRoute(routes, "POST", "/api/a")).toBe(routes[1]);
    expect(findRoute(routes, "GET", "/api/a/b")).toBeUndefined();
    expect(findRoute(routes, "DELETE", "/api/a")).toBeUndefined();
  });
});

describe("tools routes", () => {
  const tools = createToolsRoutes({ projectRoot: () => undefined, broadcast: vi.fn() });

  it("reports no image compress job before one starts", async () => {
    const result = await callRoute(tools, "GET", "/api/tools/image-compress/job");
    expect(result.status).toBe(200);
    expect(result.json()).toEqual({ job: null });
  });

  it("rejects an image compress run without a target", async () => {
    const result = await callRoute(tools, "POST", "/api/tools/image-compress", { action: "run", target: "  " });
    expect(result.status).toBe(400);
    expect(result.json()).toEqual({ error: "target_required" });
  });

  it("rejects unknown radar actions", async () => {
    const result = await callRoute(tools, "POST", "/api/tools/new-game-radar", { action: "nope" });
    expect(result.status).toBe(400);
  });
});

describe("git routes", () => {
  const git = createGitRoutes({
    broadcast: vi.fn(),
    currentProject: () => undefined,
    currentMakerRuntime: () => undefined,
    freshAccount: vi.fn(),
    previewHome: vi.fn()
  });

  it("requires an open project", async () => {
    await expect(callRoute(git, "GET", "/api/git/status")).rejects.toThrow("project_not_open");
  });
});

describe("runtime routes", () => {
  const runtimes = createRuntimeRoutes({ presence: () => "missing", currentProjectRoot: () => "/p/current" });

  it("reports the current project alongside preview sessions", async () => {
    const result = await callRoute(runtimes, "GET", "/api/runtimes");
    expect(result.json()).toMatchObject({ currentProjectRoot: "/p/current" });
  });

  it("only serves logs for a known preview session", async () => {
    const result = await callRoute(runtimes, "GET", `/api/runtimes/logs?projectRoot=${encodeURIComponent("/etc")}`);
    expect(result.status).toBe(404);
  });
});

describe("feedback routes", () => {
  const generatedAt = new Date("2026-10-12T08:30:15Z");
  const bridgeLog = createLogRing(10, () => generatedAt);
  bridgeLog.push("[TapMakerWork] Bridge listening");
  const context = {
    environment: { platform: "linux", arch: "x64", osRelease: "6.12", node: "v22", protocolVersion: 1 },
    recentErrors: [],
    runtimeLogs: []
  };

  it("builds a pack from bridge context and studio input without saving by default", async () => {
    const outputDir = vi.fn(() => os.tmpdir());
    const routes = createFeedbackRoutes({ bridgeLog, collectContext: () => context, outputDir, now: () => generatedAt });
    const result = await callRoute(routes, "POST", "/api/feedback/pack", {
      description: "保存失败",
      client: { appVersion: "0.1.7", screen: 42 },
      studioLogs: { agent: ["保存失败：disk_full", 7], bad: "x" }
    });
    const body = result.json() as { markdown: string; fileName: string; savedPath?: string };
    expect(body.fileName).toBe("tapmakerwork-feedback-20261012-083015.md");
    expect(body.savedPath).toBeUndefined();
    expect(outputDir).not.toHaveBeenCalled();
    expect(body.markdown).toContain("保存失败：disk_full");
    expect(body.markdown).toContain("Bridge listening");
    expect(body.markdown).toContain("- 屏幕：未知");
    expect(body.markdown).not.toContain("Studio 终端：bad");
  });

  it("saves the pack when asked", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tmw-feedback-route-"));
    const routes = createFeedbackRoutes({ bridgeLog, collectContext: () => context, outputDir: () => directory, now: () => generatedAt });
    const body = (await callRoute(routes, "POST", "/api/feedback/pack", { save: true })).json() as { markdown: string; savedPath: string };
    expect(path.dirname(body.savedPath)).toBe(directory);
    expect(fs.readFileSync(body.savedPath, "utf8")).toBe(body.markdown);
  });
});

describe("asset routes", () => {
  it("validates the request body before touching the project", async () => {
    const assets = createAssetRoutes({ projectRoot: () => os.tmpdir() });
    await expect(callRoute(assets, "POST", "/api/assets/trash", { paths: "assets/a.png" })).rejects.toThrow("asset_paths_required");
    await expect(callRoute(assets, "POST", "/api/assets/restore", {})).rejects.toThrow("trash_ids_required");
  });

  it("requires an open project", async () => {
    const assets = createAssetRoutes({ projectRoot: () => undefined });
    await expect(callRoute(assets, "GET", "/api/assets/report")).rejects.toThrow("project_not_open");
  });
});
