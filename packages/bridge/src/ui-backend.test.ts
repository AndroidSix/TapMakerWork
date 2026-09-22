import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectUiBackend, scoreUiBackendMarkers } from "./ui-backend.js";
import { installRuntimeAdapter } from "./adapter-pack.js";

const temporary: string[] = [];

afterEach(() => {
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempProject(scripts: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-backend-"));
  temporary.push(root);
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  for (const [relative, source] of Object.entries(scripts)) {
    const filename = path.join(root, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, source, "utf8");
  }
  return root;
}

describe("ui backend detection", () => {
  it("scores Yoga and NanoVG markers independently", () => {
    expect(scoreUiBackendMarkers(`local UI = require("urhox-libs/UI")\nUI.Init({})`).yoga).toBeGreaterThan(0);
    expect(scoreUiBackendMarkers("nvgBeginFrame(720,1280,1)\nnvgText(10,20,'hi')\nnvgEndFrame()").nanovg).toBeGreaterThan(0);
  });

  it("detects NanoVG-only projects", () => {
    const root = tempProject({
      "scripts/main.lua": `function Start() end
function HandleUpdate(eventType, eventData)
    local dt = eventData:GetFloat("TimeStep")
end
`,
      "scripts/ui/HomeScreen.lua": `
function DrawHome()
  nvgBeginFrame(720, 1280, 1)
  nvgBeginPath()
  nvgRect(40, 80, 200, 48)
  nvgFill()
  nvgText(48, 110, "台球大师")
  nvgEndFrame()
end
`
    });
    expect(detectUiBackend(root)).toBe("nanovg");
  });

  it("prefers Yoga when both exist at similar strength", () => {
    const root = tempProject({
      "scripts/main.lua": `local UI = require("urhox-libs/UI")\nUI.Init({})\nfunction Start() UI.GetRoot() end\n`,
      "scripts/fx.lua": "nvgBeginFrame(1,1,1)\nnvgEndFrame()\n"
    });
    expect(detectUiBackend(root)).toBe("yoga");
  });

  it("ignores managed Yoga bootstrap when scoring NanoVG projects", () => {
    const managedYoga = `-- >>> TapMakerWork live editor (managed)
local okUi, UI = pcall(require, "urhox-libs/UI")
bridge.Start({ rootProvider = function() return UI.GetRoot() end })
-- <<< TapMakerWork live editor (managed)

nvgBeginFrame(vg, 720, 1280, 1)
nvgText(vg, 10, 20, "hi")
nvgEndFrame(vg)
`;
    expect(scoreUiBackendMarkers(managedYoga).yoga).toBe(0);
    expect(scoreUiBackendMarkers(managedYoga).nanovg).toBeGreaterThan(0);
  });
});

describe("NanoVG adapter installer", () => {
  it("injects the NanoVG bridge without requiring urhox-libs/UI", () => {
    const root = tempProject({
      "scripts/main.lua": `function Start()
    app_:Init()
end

function HandleAppUpdate(eventType, eventData)
    local dt = eventData:GetFloat("TimeStep")
    app_:Update(dt)
end
`,
      "scripts/HomeScreen.lua": `
nvgBeginFrame(720, 1280, 1)
nvgText(10, 20, "Hello")
nvgRect(0, 0, 100, 40)
nvgFill()
nvgEndFrame()
`
    });
    // maker entry needs app_:Init pattern - fix entry
    fs.writeFileSync(path.join(root, "scripts", "main.lua"), `local app_ = nil

function Start()
    local App = require("App")
    app_ = App.new()
    app_:Init()
end

function HandleAppUpdate(eventType, eventData)
    local dt = eventData:GetFloat("TimeStep")
    app_:Update(dt)
end
`, "utf8");

    const result = installRuntimeAdapter({ bridgePackageRoot: process.cwd(), projectRoot: root });
    expect(result.backend).toBe("nanovg");
    expect(result.adapterPath).toContain("TapMakerWorkNanoVGBridge.lua");
    expect(fs.existsSync(result.adapterPath)).toBe(true);
    const entry = fs.readFileSync(result.entryPath, "utf8");
    expect(entry).toContain("tapmakerwork/TapMakerWorkNanoVGBridge");
    expect(entry).not.toContain("urhox-libs/UI");
  });

  it("rewires a Yoga-managed entry when the project is NanoVG", () => {
    const root = tempProject({
      "scripts/main.lua": `local app_ = nil

function Start()
    local App = require("App")
    app_ = App.new()
    app_:Init()
end

function HandleAppUpdate(eventType, eventData)
    local dt = eventData:GetFloat("TimeStep")
    app_:Update(dt)
end
`,
      "scripts/draw.lua": "nvgBeginFrame(1,1,1)\nnvgText(0,0,'x')\nnvgRect(0,0,1,1)\nnvgFill()\nnvgEndFrame()\n"
    });
    installRuntimeAdapter({ bridgePackageRoot: process.cwd(), projectRoot: root, backend: "yoga" });
    const yogaEntry = fs.readFileSync(path.join(root, "scripts", "main.lua"), "utf8");
    expect(yogaEntry).toContain("TapMakerWorkBridge");

    const next = installRuntimeAdapter({ bridgePackageRoot: process.cwd(), projectRoot: root });
    expect(next.backend).toBe("nanovg");
    expect(next.changed).toBe(true);
    const entry = fs.readFileSync(next.entryPath, "utf8");
    expect(entry).toContain("TapMakerWorkNanoVGBridge");
    expect(entry).not.toContain("urhox-libs/UI");
  });
});
