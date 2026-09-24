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

  it("flags _external adoption directory", () => {
    const root = project();
    fs.mkdirSync(path.join(root, "assets", "_external"), { recursive: true });
    fs.writeFileSync(path.join(root, "assets", "_external", "pasted.png"), "png", "utf8");
    const assets = listProjectAssets(root);
    const adopted = assets.find((asset) => asset.name === "pasted.png");
    expect(adopted?.status).toBe("external");
    expect(adopted?.path).toBe("assets/_external/pasted.png");
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

  it("offers one-click Maker CLI repair when runtime is missing", () => {
    const root = project();
    const overview = buildProjectWorkflowOverview({
      projectRoot: root,
      projectName: "demo",
      makerBound: false,
      makerCli: false,
      uiScreenCount: 0,
      previewPanel: {
        url: "",
        urlSource: "none",
        orientation: "portrait",
        autoRefreshIframe: true,
        autoRefreshMaker: false,
        transport: "auto",
        reloadToken: 1
      },
      assets: []
    });
    const makerCheck = overview.stages.find((stage) => stage.id === "environment")?.checks.find((check) => check.id === "maker-cli");
    expect(makerCheck?.status).toBe("blocked");
    expect(makerCheck?.action).toBe("install-maker");
    expect(makerCheck?.actionLabel).toBe("一键修复");
    expect(overview.nextAction).toEqual({
      action: "install-maker",
      label: "一键修复",
      reason: "未发现 @taptap/maker runtime"
    });
  });
});
