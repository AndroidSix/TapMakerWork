import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installRuntimeAdapter } from "./adapter-pack.js";

const temporary: string[] = [];

function makerProject(options: { clientEntry?: boolean } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-adapter-"));
  temporary.push(root);
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  const entryName = options.clientEntry ? "client_main.lua" : "main.lua";
  fs.writeFileSync(path.join(root, "scripts", entryName), `local app_ = nil

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
  if (options.clientEntry) {
    fs.mkdirSync(path.join(root, ".project"), { recursive: true });
    fs.writeFileSync(path.join(root, ".project", "project.json"), JSON.stringify({
      entry: "main.lua",
      "entry@client": "client_main.lua",
      "entry@server": "server_main.lua"
    }), "utf8");
    fs.writeFileSync(path.join(root, "scripts", "main.lua"), "-- shared fallback entry\n", "utf8");
    fs.writeFileSync(path.join(root, "scripts", "server_main.lua"), "-- server entry\n", "utf8");
  }
  return root;
}

afterEach(() => {
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("runtime adapter installer", () => {
  it("backs up and wires a Maker entry without duplicating hooks", () => {
    const root = makerProject();
    const first = installRuntimeAdapter({ bridgePackageRoot: process.cwd(), projectRoot: root });
    expect(first.changed).toBe(true);
    expect(first.backupPath && fs.existsSync(first.backupPath)).toBe(true);
    expect(fs.existsSync(first.adapterPath)).toBe(true);

    const entry = fs.readFileSync(first.entryPath, "utf8");
    expect(entry.match(/TapMakerWork live editor \(managed\)/g)).toHaveLength(2);
    expect(entry.match(/TapMakerWorkLiveEditorStart\(\) -- TapMakerWork managed/g)).toHaveLength(1);
    expect(entry.match(/TapMakerWorkLiveEditorUpdate\(dt\) -- TapMakerWork managed/g)).toHaveLength(1);

    const second = installRuntimeAdapter({ bridgePackageRoot: process.cwd(), projectRoot: root });
    expect(second.changed).toBe(false);
    expect(second.backupPath).toBeUndefined();
    expect(fs.existsSync(path.join(root, "scripts/tapmakerwork/UiOverrides.lua"))).toBe(true);
  });

  it("keeps a generated replay module when the adapter is installed again", () => {
    const root = makerProject();
    installRuntimeAdapter({ bridgePackageRoot: process.cwd(), projectRoot: root });
    const overrides = path.join(root, "scripts/tapmakerwork/UiOverrides.lua");
    const saved = "return { version = 1, overrides = { kept = true } }\n";
    fs.writeFileSync(overrides, saved, "utf8");
    const second = installRuntimeAdapter({ bridgePackageRoot: process.cwd(), projectRoot: root });
    expect(second.changed).toBe(false);
    expect(fs.readFileSync(overrides, "utf8")).toBe(saved);
  });

  it("refuses an unsupported entry instead of partially editing it", () => {
    const root = makerProject();
    fs.writeFileSync(path.join(root, "scripts", "main.lua"), "print('no lifecycle')\n", "utf8");
    expect(() => installRuntimeAdapter({ bridgePackageRoot: process.cwd(), projectRoot: root }))
      .toThrow("runtime_adapter_start_hook_not_found");
    expect(fs.existsSync(path.join(root, "scripts", "tapmakerwork", "TapMakerWorkBridge.lua"))).toBe(false);
  });

  it("moves the editor functions above an earlier update loop", () => {
    const root = makerProject();
    fs.writeFileSync(path.join(root, "scripts", "main.lua"), `function HandleUpdate(eventType, eventData)
    local dt = eventData:GetFloat("TimeStep")
    TapMakerWorkLiveEditorUpdate(dt) -- TapMakerWork managed
end

-- >>> TapMakerWork live editor (managed)
local function TapMakerWorkLiveEditorUpdate(dt)
end
-- <<< TapMakerWork live editor (managed)

function Start()
    TapMakerWorkLiveEditorStart() -- TapMakerWork managed
    UI.Init({})
end
`, "utf8");
    const result = installRuntimeAdapter({ bridgePackageRoot: process.cwd(), projectRoot: root });
    const entry = fs.readFileSync(result.entryPath, "utf8");
    const definedAt = entry.indexOf("local function TapMakerWorkLiveEditorUpdate");
    const calledAt = entry.indexOf("TapMakerWorkLiveEditorUpdate(dt) -- TapMakerWork managed");
    expect(definedAt).toBeGreaterThanOrEqual(0);
    expect(definedAt).toBeLessThan(calledAt);
    expect(entry.match(/TapMakerWork live editor \(managed\)/g)).toHaveLength(2);
  });

  it("wires UI.Init projects that start from function Start", () => {
    const root = makerProject();
    fs.writeFileSync(path.join(root, "scripts", "main.lua"), `function Start()
    UI.Init({ theme = "dark" })
end

function HandleUpdate(eventType, eventData)
    local dt = eventData:GetFloat("TimeStep")
end
`, "utf8");
    const result = installRuntimeAdapter({ bridgePackageRoot: process.cwd(), projectRoot: root });
    const entry = fs.readFileSync(result.entryPath, "utf8");
    expect(entry).toMatch(/function Start\(\)\r?\n {4}TapMakerWorkLiveEditorStart\(\) -- TapMakerWork managed/);
    expect(entry).toMatch(/GetFloat\("TimeStep"\)\r?\n {4}TapMakerWorkLiveEditorUpdate\(dt\) -- TapMakerWork managed/);
  });

  it("wires NanoVG-style TimeStep via eventData index GetFloat", () => {
    const root = makerProject();
    fs.writeFileSync(path.join(root, "scripts", "main.lua"), `function Start()
    vg_ = nvgCreate(1)
end

function HandleUpdate(eventType, eventData)
    local dt = eventData["TimeStep"]:GetFloat()
    if dt == nil or dt < 0 then dt = 0.016 end
end
`, "utf8");
    const result = installRuntimeAdapter({ bridgePackageRoot: process.cwd(), projectRoot: root });
    expect(result.backend).toBe("nanovg");
    const entry = fs.readFileSync(result.entryPath, "utf8");
    expect(entry).toContain('tapmakerwork/TapMakerWorkNanoVGBridge');
    expect(entry).toMatch(
      /eventData\["TimeStep"\]:GetFloat\(\)\r?\n {4}TapMakerWorkLiveEditorUpdate\(dt\) -- TapMakerWork managed/
    );
  });

  it("wires the configured client entry instead of an unused shared entry", () => {
    const root = makerProject({ clientEntry: true });
    const result = installRuntimeAdapter({ bridgePackageRoot: process.cwd(), projectRoot: root });

    expect(result.entryPath).toBe(path.join(root, "scripts", "client_main.lua"));
    expect(path.basename(result.backupPath || "")).toMatch(/^client_main\.lua\./);
    expect(fs.readFileSync(result.entryPath, "utf8")).toContain("TapMakerWorkLiveEditorStart()");
    expect(fs.readFileSync(path.join(root, "scripts", "main.lua"), "utf8")).toBe("-- shared fallback entry\n");
    expect(fs.readFileSync(path.join(root, "scripts", "server_main.lua"), "utf8")).toBe("-- server entry\n");
  });
});
