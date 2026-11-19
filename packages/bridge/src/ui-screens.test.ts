import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import luaparse from "luaparse";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isUiScreenCandidate, scanUiScreens } from "./ui-screens.js";

const temporaryDirectories: string[] = [];

function temporaryProject(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-screens-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeProjectFile(root: string, relativePath: string, source: string): void {
  const filename = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, source, "utf8");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("project UI screen discovery", () => {
  it("recognizes Maker widgets outside scripts/ui without accepting ordinary Lua modules", () => {
    expect(isUiScreenCandidate("scripts/network/Dialog.lua", "return deps.UI.Panel { id = 'dialog' }")).toBe(true);
    expect(isUiScreenCandidate("scripts/game/Combat.lua", "return { damage = 10 }")).toBe(false);
    expect(isUiScreenCandidate("scripts/ui/Theme.lua", "return { primary = '#fff' }")).toBe(true);
  });

  it("scans the complete scripts tree and keeps explicit UI helper modules", () => {
    const root = temporaryProject();
    writeProjectFile(root, "scripts/ui/Home.lua", "return UI.Panel { id = 'home', children = { UI.Label { text = 'Home' } } }");
    writeProjectFile(root, "scripts/ui/Theme.lua", "return { primary = '#fff' }");
    writeProjectFile(root, "scripts/network/RoomDialog.lua", "return deps.UI.Modal { id = 'roomDialog' }");
    writeProjectFile(root, "scripts/game/Combat.lua", "return { damage = 10 }");

    const result = scanUiScreens(root);
    expect(result.summaries.map((screen) => screen.path)).toEqual([
      "scripts/network/RoomDialog.lua",
      "scripts/ui/Home.lua",
      "scripts/ui/Theme.lua"
    ]);
    expect(result.documents.has("scripts/network/RoomDialog.lua")).toBe(true);
    expect(result.summaries.find((screen) => screen.path.endsWith("Theme.lua"))?.confidence).toBe("module");
  });

  it("reads and parses a shared dependency once per scan and picks up edits on the next scan", () => {
    const root = temporaryProject();
    const relative = "scripts/config/Palette.lua";
    const settings = 'Palette.COLOR = "#112233"\nreturn Palette';
    writeProjectFile(root, relative, settings);
    for (const name of ["Home", "Shop"]) {
      writeProjectFile(root, `scripts/ui/${name}.lua`, 'local Palette = require("config.Palette")\nreturn UI.Panel { backgroundColor = Palette.COLOR }');
    }
    const read = vi.spyOn(fs, "readFileSync");
    const parse = vi.spyOn(luaparse, "parse");
    try {
      const first = scanUiScreens(root);
      expect(first.documents.get("scripts/ui/Home.lua")?.root.props.backgroundColor).toBe("#112233");
      expect(read.mock.calls.filter(([file]) => file === fs.realpathSync(path.join(root, relative)))).toHaveLength(1);
      expect(parse.mock.calls.filter(([source]) => source === settings)).toHaveLength(1);
      writeProjectFile(root, relative, settings.replace("#112233", "#445566"));
      expect(scanUiScreens(root).documents.get("scripts/ui/Shop.lua")?.root.props.backgroundColor).toBe("#445566");
    } finally {
      read.mockRestore();
      parse.mockRestore();
    }
  });
});
