import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listProjectAssets } from "./ide-tools.js";
import { buildProjectWorkflowOverview, saveProjectWorkflow } from "./project-workflow.js";

const temporary: string[] = [];

function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-workflow-"));
  temporary.push(root);
  fs.mkdirSync(path.join(root, ".maker-mcp"), { recursive: true });
  fs.writeFileSync(path.join(root, ".maker-mcp", "config.json"), "{}", "utf8");
  fs.mkdirSync(path.join(root, "scripts", "ui"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "ui", "HomePage.lua"), 'local hero = "assets/image/hero.png"', "utf8");
  fs.mkdirSync(path.join(root, "assets", "image"), { recursive: true });
  fs.writeFileSync(path.join(root, "assets", "image", "hero.png"), "png", "utf8");
  fs.writeFileSync(path.join(root, "assets", "image", "unused.png"), "png", "utf8");
  return root;
}

afterEach(() => {
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("project workflow", () => {
  it("classifies assets and detects source references", () => {
    const root = project();
    const assets = listProjectAssets(root);
    expect(assets).toHaveLength(2);
    expect(assets.find((asset) => asset.name === "hero.png")?.status).toBe("referenced");
    expect(assets.find((asset) => asset.name === "unused.png")?.status).toBe("unreferenced");
  });

  it("builds a persistent validation-oriented overview", () => {
    const root = project();
    fs.writeFileSync(path.join(root, "scripts", "ui", "HomePage.ui.json"), "{}", "utf8");
    saveProjectWorkflow(root, { objective: "完成首页交付" });
    const overview = buildProjectWorkflowOverview({
      projectRoot: root,
      projectName: "demo",
      makerBound: true,
      makerCli: true,
      makerVersion: "0.0.33",
      uiScreenCount: 1,
      runtimeSessionId: "runtime-1",
      runtimeScene: "live",
      runtimeSnapshotPath: path.join(root, "runtime-snapshot.json"),
      previewPanel: {
        url: "https://example.test/game",
        urlSource: "manual",
        orientation: "portrait",
        autoRefreshIframe: true,
        autoRefreshMaker: false,
        transport: "auto",
        reloadToken: 1
      },
      qrcodeUrl: "https://example.test/qr",
      git: { branch: "main", ahead: 0, behind: 0, dirty: false, changes: [], commits: [] },
      assets: listProjectAssets(root)
    });
    expect(overview.objective).toBe("完成首页交付");
    expect(overview.stages).toHaveLength(6);
    expect(overview.evidence.map((item) => item.kind)).toEqual(expect.arrayContaining(["ui-sidecar", "runtime-snapshot", "qrcode"]));
    expect(overview.assets.referenced).toBe(1);
  });
});
