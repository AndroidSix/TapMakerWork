import os from "node:os";
import { describe, expect, it, vi } from "vitest";
import { createAssetRoutes } from "./asset-routes.js";
import { createGitRoutes } from "./git-routes.js";
import { findRoute, type BridgeRoute } from "./route-table.js";
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
