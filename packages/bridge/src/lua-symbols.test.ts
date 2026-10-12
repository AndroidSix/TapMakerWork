import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { diagnoseLuaSource, extractLuaSymbols, indexProjectLuaSymbols } from "./lua-symbols.js";

describe("diagnoseLuaSource", () => {
  it("returns nothing for valid Lua", () => {
    expect(diagnoseLuaSource("local x = 1\nreturn x\n")).toEqual([]);
  });

  it("reports the first syntax error with a 1-based column", () => {
    expect(diagnoseLuaSource("local x = \nfunction(")).toEqual([
      { line: 2, column: 10, message: "<name> or '...' expected near '<eof>'" }
    ]);
  });

  it("accepts Lua 5.4 const/close attributes", () => {
    expect(diagnoseLuaSource("local LIMIT <const> = 10\nlocal f <close> = nil\n")).toEqual([]);
  });
});

describe("extractLuaSymbols", () => {
  const source = [
    "--- 创建面板",
    "---@param props table",
    "function UI.Panel(props, ...) end",
    "local function helper(a) end",
    "UI.Theme = { primary = { 255, 200, 0, 255 } }",
    "function Game:Start(level) end",
    "M.go = function(x, y) end",
    "local hidden = 1",
    ""
  ].join("\n");

  it("collects global functions, members and doc comments but skips locals", () => {
    expect(extractLuaSymbols(source, "urhox-libs/UI/init.lua")).toEqual([
      { name: "UI.Panel", kind: "function", signature: "UI.Panel(props, ...)", doc: "创建面板\n@param props table", file: "urhox-libs/UI/init.lua", line: 3 },
      { name: "UI.Theme", kind: "field", signature: "UI.Theme = { primary = { 255, 200, 0, 255 } }", file: "urhox-libs/UI/init.lua", line: 5 },
      { name: "Game:Start", kind: "function", signature: "Game:Start(level)", file: "urhox-libs/UI/init.lua", line: 6 },
      { name: "M.go", kind: "function", signature: "M.go(x, y)", file: "urhox-libs/UI/init.lua", line: 7 }
    ]);
  });

  it("returns no symbols for unparsable files", () => {
    expect(extractLuaSymbols("function (", "bad.lua")).toEqual([]);
  });
});

describe("indexProjectLuaSymbols", () => {
  it("indexes scripts/ and urhox-libs/ and refreshes after a file changes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tmw-lua-symbols-"));
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(root, "urhox-libs", "UI"), { recursive: true });
    fs.writeFileSync(path.join(root, "urhox-libs", "UI", "init.lua"), "function UI.Button(props) end\n");
    fs.writeFileSync(path.join(root, "scripts", "main.lua"), "function Game.Start() end\n");
    expect(indexProjectLuaSymbols(root).map((symbol) => symbol.name).sort()).toEqual(["Game.Start", "UI.Button"]);

    fs.writeFileSync(path.join(root, "scripts", "main.lua"), "function Game.Start() end\nfunction Game.Stop() end\n");
    expect(indexProjectLuaSymbols(root).map((symbol) => symbol.name)).toContain("Game.Stop");
  });
});
