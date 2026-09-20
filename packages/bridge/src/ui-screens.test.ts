import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
});
