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
  });

  it("refuses an unsupported entry instead of partially editing it", () => {
    const root = makerProject();
    fs.writeFileSync(path.join(root, "scripts", "main.lua"), "function Start()\nend\n", "utf8");
    expect(() => installRuntimeAdapter({ bridgePackageRoot: process.cwd(), projectRoot: root }))
      .toThrow("runtime_adapter_start_hook_not_found");
    expect(fs.existsSync(path.join(root, "scripts", "tapmakerwork", "TapMakerWorkBridge.lua"))).toBe(false);
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
