import { describe, expect, it } from "vitest";
import type { LuaSymbol } from "@tapmakerwork/protocol";
import { dottedWordAt, dottedWordBefore, findLuaSymbol, luaCompletions } from "./lua-language";

const symbols: LuaSymbol[] = [
  { name: "UI.Panel", kind: "function", signature: "UI.Panel(props)", doc: "创建面板", file: "urhox-libs/UI/init.lua", line: 3 },
  { name: "UI.Theme.primary", kind: "field", signature: "UI.Theme.primary = {}", file: "urhox-libs/UI/init.lua", line: 9 },
  { name: "Game:Start", kind: "function", signature: "Game:Start(level)", file: "scripts/main.lua", line: 1 }
];

describe("dotted words", () => {
  it("reads the expression before the cursor", () => {
    expect(dottedWordBefore("local p = UI.Pa", 16)).toBe("UI.Pa");
    expect(dottedWordBefore("  UI.", 6)).toBe("UI.");
    expect(dottedWordBefore("x = 1 + ", 9)).toBe("");
  });

  it("reads the whole expression under the cursor", () => {
    expect(dottedWordAt("UI.Panel { }", 5)).toBe("UI.Panel");
    expect(dottedWordAt("game:Start(1)", 8)).toBe("game:Start");
    expect(dottedWordAt("game:Start(1)", 3)).toBe("game");
  });
});

describe("luaCompletions", () => {
  it("offers top-level namespaces when nothing is qualified", () => {
    expect(luaCompletions(symbols, "U").map((item) => item.label).sort()).toEqual(["Game", "UI"]);
  });

  it("offers members with signature and docs after a qualifier", () => {
    expect(luaCompletions(symbols, "UI.")).toEqual([
      { label: "Panel", kind: "function", detail: "UI.Panel(props)", documentation: "创建面板\n\nurhox-libs/UI/init.lua:3" },
      { label: "Theme", kind: "namespace", detail: "UI.Theme" }
    ]);
  });

  it("supports method calls with a colon", () => {
    expect(luaCompletions(symbols, "Game:S").map((item) => item.label)).toEqual(["Start"]);
  });
});

describe("findLuaSymbol", () => {
  it("matches dotted and colon method names", () => {
    expect(findLuaSymbol(symbols, "UI.Panel")?.line).toBe(3);
    expect(findLuaSymbol(symbols, "Game.Start")?.signature).toBe("Game:Start(level)");
    expect(findLuaSymbol(symbols, "")).toBeUndefined();
  });
});
