import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectDirtyLiteralOverrides,
  patchLuaWidgetLiterals,
  writeBackMatchingTextLiterals,
  writeBackUiOverridesToLua,
  writeBackUiTreeLiteralsToLua
} from "./lua-prop-writeback.js";
import type { UiSidecarOverride } from "./ui-sidecar.js";
import type { UiNode } from "@tapmakerwork/protocol";

describe("lua prop writeback", () => {
  it("rewrites literal fields by default and skips expressions", () => {
    const source = `
local Screen = {}
function Screen.Create(options)
  local root = UI.Panel {
    width = "100%",
    height = style.pageHeight,
    backgroundColor = { 20, 24, 32, 255 },
    children = {
      UI.Label { text = "标题", fontSize = 40, fontColor = options.theme.title },
      options.primaryButton {
        text = "开始",
        width = "100%",
        height = style.buttonHeight,
        textColor = { 255, 255, 255, 255 },
        onClick = options.onStart,
      },
    },
  }
  return root
end
return Screen
`;
    const label = patchLuaWidgetLiterals(source, { line: 9, type: "Label" }, {
      text: "新标题",
      fontSize: 44,
      fontColor: [255, 200, 100, 255]
    });
    expect(label.applied.sort()).toEqual(["fontSize", "text"]);
    expect(label.skipped.map((item) => item.key)).toContain("fontColor");
    expect(label.text).toContain('text = "新标题"');
    expect(label.text).toContain("fontSize = 44");
    expect(label.text).toContain("fontColor = options.theme.title");

    const button = patchLuaWidgetLiterals(label.text, { line: 10, type: "Button" }, {
      text: "开战",
      textColor: [10, 20, 30, 255],
      height: 64,
      onClick: { $expression: "options.onStart" } as never
    });
    expect(button.applied.sort()).toEqual(["text", "textColor"]);
    expect(button.skipped.map((item) => `${item.key}:${item.reason}`)).toEqual(
      expect.arrayContaining(["height:ast_not_literal", "onClick:key_not_writable"])
    );
    expect(button.text).toContain('text = "开战"');
    expect(button.text).toContain("textColor = { 10, 20, 30, 255 }");
    expect(button.text).toContain("height = style.buttonHeight");
  });

  it("freezes user-edited visual expressions into project Lua and inserts missing fields", () => {
    const source = `
function Screen.Create(options)
  return options.primaryButton {
    text = "开始",
    height = style.buttonHeight,
    textColor = { 255, 255, 255, 255 },
    onClick = options.onStart,
  }
end
`;
    const result = patchLuaWidgetLiterals(source, { line: 3, type: "Button" }, {
      height: 72,
      left: 16,
      backgroundColor: [170, 65, 50, 255],
      onClick: { $expression: "options.onStart" } as never
    }, { replaceExpressions: true, insertMissingFields: true });

    expect(result.applied.sort()).toEqual(["backgroundColor", "height", "left"]);
    expect(result.skipped.map((item) => item.key)).toContain("onClick");
    expect(result.text).toContain("height = 72");
    expect(result.text).not.toContain("style.buttonHeight");
    expect(result.text).toContain("left = 16");
    expect(result.text).toContain("backgroundColor = { 170, 65, 50, 255 }");
    expect(result.text).toContain("onClick = options.onStart");
  });

  it("writes overrides back into project lua including frozen expressions", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-writeback-"));
    const relative = "scripts/ui/HomePage.lua";
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, `
function Screen.Create(UI)
  return UI.Label { text = "旧文案", fontSize = style.titleSize, visible = true }
end
`, "utf8");

    const overrides: UiSidecarOverride[] = [{
      selector: { sourceFile: relative, line: 3, type: "Label" },
      scope: "template",
      props: {
        text: "新文案",
        fontSize: 22,
        backgroundColor: { $expression: "theme.bg" }
      }
    }];

    const summary = writeBackUiOverridesToLua(root, overrides);
    expect(summary.appliedCount).toBe(2);
    expect(summary.filesTouched).toEqual([relative]);
    expect(summary.overrides).toHaveLength(1);
    expect(summary.overrides[0]?.props).toEqual({ backgroundColor: { $expression: "theme.bg" } });
    const next = fs.readFileSync(absolute, "utf8");
    expect(next).toContain('text = "新文案"');
    expect(next).toContain("fontSize = 22");
    expect(next).not.toContain("style.titleSize");
  });

  it("finds nested Label when runtime points at parent Panel line", () => {
    const source = `
function Screen.Create()
  return UI.Panel {
    width = 280,
    children = {
      UI.Label {
        text = "旧文案",
        fontSize = 22,
      },
    },
  }
end
`;
    // Panel starts at line 3; Label is nested at line 6.
    const result = patchLuaWidgetLiterals(source, { line: 3, type: "Label" }, {
      text: "123123"
    }, { replaceExpressions: true });
    expect(result.applied).toEqual(["text"]);
    expect(result.text).toContain('text = "123123"');
    expect(result.text).not.toContain('text = "旧文案"');
  });

  it("refuses to freeze opts.text factory passthrough", () => {
    const source = `
function UiStyle.PrimaryButton(opts)
  return UI.Panel {
    children = {
      UI.Label { text = opts.text or "", fontSize = 22 },
    },
  }
end
`;
    const result = patchLuaWidgetLiterals(source, { line: 3, type: "Label" }, {
      text: "123123"
    }, { replaceExpressions: true });
    expect(result.applied).toEqual([]);
    expect(result.skipped.some((item) => item.reason === "opts_passthrough")).toBe(true);
  });

  it("refuses to insert fontColor into shared factory Label bodies", () => {
    const source = `
function UiStyle.PrimaryButton(opts)
  return UI.Panel {
    children = {
      UI.Label {
        text = opts.text or "",
        fontSize = opts.fontSize or 22,
        color = opts.color or { 255, 252, 245, 255 },
      },
    },
  }
end
`;
    const result = patchLuaWidgetLiterals(source, { line: 4, type: "Label" }, {
      fontColor: [244, 174, 11, 255]
    }, { replaceExpressions: true, insertMissingFields: true });
    expect(result.applied).toEqual([]);
    expect(result.text).not.toContain("fontColor");
    expect(result.skipped.some((item) => item.reason === "opts_passthrough")).toBe(true);
  });

  it("does not nearby-insert backgroundColor into a neighboring Panel", () => {
    const source = `
local pvpBtn = UiStyle.PrimaryButton {
  text = "多人争霸（耗1体力）",
  bg = { 170, 65, 50, 255 },
}
local staminaRow = UI.Panel {
  id = "staminaRow",
  width = 720,
  children = {},
}
`;
    // Panel at the PrimaryButton line remaps to the Button call site (bg), and must
    // never stuff backgroundColor into the neighboring staminaRow panel.
    const result = patchLuaWidgetLiterals(source, { line: 2, type: "Panel" }, {
      backgroundColor: [162, 44, 186, 255]
    }, { replaceExpressions: true, insertMissingFields: true });
    expect(result.text).toContain("bg = { 162, 44, 186, 255 }");
    expect(result.text).not.toMatch(/staminaRow[\s\S]*backgroundColor/);
  });

  it("routes CaptionBar fontSize to the call site", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-caption-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/ui/UiStyle.lua"), `
function UiStyle.CaptionBar(opts)
  return UI.Panel {
    children = {
      UI.Label { text = opts.text or "", fontSize = opts.fontSize or 13 },
    },
  }
end
`, "utf8");
    fs.writeFileSync(path.join(root, "scripts/ui/Lobby.lua"), `
UiStyle.CaptionBar { text = "匹配真人或邀请好友", fontSize = 14 }
`, "utf8");
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/UiStyle.lua", line: 4, type: "Label" },
      scope: "template",
      props: { fontSize: 20 },
      previousProps: { text: "匹配真人或邀请好友" }
    }]);
    expect(summary.appliedCount).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(root, "scripts/ui/Lobby.lua"), "utf8")).toContain("fontSize = 20");
    expect(fs.readFileSync(path.join(root, "scripts/ui/UiStyle.lua"), "utf8")).toContain("opts.fontSize");
  });

  it("writes PrimaryButton bg/color when call site uses text = Assets.Subtitle", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-assets-color-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.mkdirSync(path.join(root, "scripts/data"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/data/Assets.lua"), `
Assets.Subtitle = "123123"
`, "utf8");
    fs.writeFileSync(path.join(root, "scripts/ui/UiStyle.lua"), `
function UiStyle.PrimaryButton(opts)
  local core = opts.bg or { 1, 2, 3, 255 }
  local rim = opts.rim or { 4, 5, 6, 255 }
  return UI.Panel {
    backgroundColor = rim,
    children = {
      UI.Panel {
        backgroundColor = core,
        children = {
          UI.Label { text = opts.text or "", color = opts.color or { 255, 255, 255, 255 } },
        },
      },
    },
  }
end
`, "utf8");
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), `
UiStyle.PrimaryButton {
  width = 560,
  height = 64,
  left = 80,
  bg = { 55, 145, 120, 255 },
  rim = { 30, 90, 75, 255 },
  text = Assets.Subtitle,
  fontSize = 24,
}
`, "utf8");
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/UiStyle.lua", line: 10, type: "Label" },
      scope: "template",
      props: {
        fontColor: [224, 0, 120, 255],
        backgroundColor: [185, 28, 196, 255]
      },
      previousProps: { text: "123123", width: 560, height: 64 },
      identityText: "123123"
    }]);
    expect(summary.appliedCount).toBeGreaterThan(0);
    const main = fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8");
    expect(main).toContain("bg = { 185, 28, 196, 255 }");
    expect(main).toContain("color = { 224, 0, 120, 255 }");
    expect(main).not.toContain("backgroundColor");
    expect(main).toContain("Assets.Subtitle");
  });

  it("writes color using layout hints when identityText is stale after a text edit", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-stale-id-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/ui/UiStyle.lua"), `
function UiStyle.PrimaryButton(opts)
  return UI.Panel {
    children = { UI.Label { text = opts.text or "", color = opts.color or { 1, 1, 1, 255 } } },
  }
end
`, "utf8");
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), `
UiStyle.PrimaryButton { left = 80, width = 560, height = 64, text = "3", bg = { 1, 2, 3, 255 }, rim = { 4, 5, 6, 255 } }
UiStyle.PrimaryButton { left = 80, width = 560, height = 64, text = "2", bg = { 7, 8, 9, 255 }, rim = { 4, 5, 6, 255 } }
`, "utf8");
    // Stale identity from before text was changed to "3"
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/UiStyle.lua", line: 3, type: "Label" },
      scope: "template",
      props: { fontColor: [187, 80, 237, 255] },
      previousProps: { text: "观看广告（+3体力）", width: 560, height: 64, left: 80 },
      identityText: "3"
    }]);
    expect(summary.appliedCount).toBeGreaterThan(0);
    const main = fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8");
    expect(main).toMatch(/text = "3"[\s\S]*?color = \{ 187, 80, 237, 255 \}/);
  });

  it("freezes Assets.Subtitle on the start button call site instead of rewriting Assets.lua", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-freeze-assets-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.mkdirSync(path.join(root, "scripts/data"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/data/Assets.lua"), `Assets.Subtitle = "三国全境争霸"\n`, "utf8");
    fs.writeFileSync(path.join(root, "scripts/ui/UiStyle.lua"), `
function UiStyle.PrimaryButton(opts)
  return UI.Panel { children = { UI.Label { text = opts.text or "" } } }
end
`, "utf8");
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), `
UiStyle.PrimaryButton { left = 80, width = 560, height = 64, text = Assets.Subtitle, bg = { 1, 2, 3, 255 } }
UiStyle.PrimaryButton { left = 80, width = 560, height = 64, text = "多人争霸（耗1体力）", bg = { 4, 5, 6, 255 } }
`, "utf8");
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/UiStyle.lua", line: 3, type: "Label" },
      scope: "template",
      props: { text: "123123" },
      previousProps: { text: "三国全境争霸", width: 560, height: 64, left: 80 }
    }]);
    expect(summary.appliedCount).toBe(1);
    expect(fs.readFileSync(path.join(root, "scripts/data/Assets.lua"), "utf8")).toContain("三国全境争霸");
    expect(fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8")).toContain('text = "123123"');
    expect(fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8")).toContain("多人争霸");
  });

  it("writes UpgradeCard bg instead of inserting ignored backgroundColor", () => {
    const source = `
UiStyle.UpgradeCard {
  id = "cardProduce",
  width = 190,
  bg = { 150, 110, 45, 255 },
  title = "产兵速度",
}
`;
    const result = patchLuaWidgetLiterals(source, { line: 2, type: "Panel" }, {
      backgroundColor: [7, 187, 13, 255]
    }, { replaceExpressions: true, insertMissingFields: true });
    expect(result.applied).toContain("bg");
    expect(result.text).toContain("bg = { 7, 187, 13, 255 }");
    expect(result.text).not.toContain("backgroundColor");
  });

  it("writes PrimaryButton bg on the call site when factory rim/core blocks", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-color-callsite-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/ui/UiStyle.lua"), `
function UiStyle.PrimaryButton(opts)
  local core = opts.bg or { 1, 2, 3, 255 }
  local rim = opts.rim or { 4, 5, 6, 255 }
  return UI.Panel {
    backgroundColor = rim,
    children = {
      UI.Panel { backgroundColor = core, children = {
        UI.Label { text = opts.text or "" },
      }},
    },
  }
end
`, "utf8");
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), `
UiStyle.PrimaryButton {
  text = "观看广告（+3体力）",
  bg = { 155, 110, 40, 255 },
  rim = { 90, 65, 25, 255 },
}
`, "utf8");
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/UiStyle.lua", line: 5, type: "Panel" },
      scope: "template",
      props: { backgroundColor: [162, 44, 186, 255] },
      previousProps: { text: "观看广告（+3体力）" }
    }]);
    expect(summary.appliedCount).toBeGreaterThan(0);
    const main = fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8");
    // Outer factory Panel uses backgroundColor = rim → call-site `rim`
    expect(main).toContain("rim = { 162, 44, 186, 255 }");
    expect(main).toContain("bg = { 155, 110, 40, 255 }");
    expect(main).not.toContain("backgroundColor");
    expect(fs.readFileSync(path.join(root, "scripts/ui/UiStyle.lua"), "utf8")).toContain("backgroundColor = rim");
  });

  it("writes PrimaryButton bg when inner core Panel color is edited", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-color-core-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/ui/UiStyle.lua"), `
function UiStyle.PrimaryButton(opts)
  local core = opts.bg or { 1, 2, 3, 255 }
  local rim = opts.rim or { 4, 5, 6, 255 }
  return UI.Panel {
    backgroundColor = rim,
    children = {
      UI.Panel {
        backgroundColor = core,
        children = { UI.Label { text = opts.text or "" } },
      },
    },
  }
end
`, "utf8");
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), `
UiStyle.PrimaryButton {
  text = "观看广告（+3体力）",
  bg = { 155, 110, 40, 255 },
  rim = { 90, 65, 25, 255 },
}
`, "utf8");
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/UiStyle.lua", line: 8, type: "Panel" },
      scope: "template",
      props: { backgroundColor: [10, 20, 30, 255] },
      previousProps: { text: "观看广告（+3体力）" }
    }]);
    expect(summary.appliedCount).toBeGreaterThan(0);
    const main = fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8");
    expect(main).toContain("bg = { 10, 20, 30, 255 }");
    expect(main).toContain("rim = { 90, 65, 25, 255 }");
  });

  it("rewrites unique call-site text literals when factory passthrough blocks", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-callsite-"));
    const relative = "scripts/ui/MainHUD.lua";
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, `
UiStyle.PrimaryButton {
  text = "多人争霸",
  width = 200,
}
`, "utf8");
    const summary = writeBackMatchingTextLiterals(root, "多人争霸", "123123");
    expect(summary.appliedCount).toBe(1);
    expect(summary.reason).toBe("ok");
    expect(fs.readFileSync(absolute, "utf8")).toContain('text = "123123"');
  });

  it("rewrites unique makeButton string-arg call sites", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-callsite-arg-"));
    const relative = "scripts/ui/Lobby.lua";
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, `
local function makeButton(text, onClick)
  return UiStyle.PrimaryButton { text = text, onClick = onClick }
end
makeButton("快速匹配（耗1体力）", function() end)
`, "utf8");
    const summary = writeBackMatchingTextLiterals(root, "快速匹配（耗1体力）", "123123");
    expect(summary.appliedCount).toBe(1);
    expect(summary.reason).toBe("ok");
    expect(fs.readFileSync(absolute, "utf8")).toContain('"123123"');
    expect(fs.readFileSync(absolute, "utf8")).not.toContain("快速匹配（耗1体力）");
  });

  it("never rewrites shared Assets.Subtitle from widget text writeback (protects title banner)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-assets-text-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.mkdirSync(path.join(root, "scripts/data"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/data/Assets.lua"), `
Assets.Title = "乱世夺城"
Assets.Subtitle = "三国全境争霸"
`, "utf8");
    fs.writeFileSync(path.join(root, "scripts/ui/UiStyle.lua"), `
function UiStyle.PrimaryButton(opts)
  return UI.Panel { children = { UI.Label { text = opts.text or "" } } }
end
`, "utf8");
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), `
local levelLabel = UI.Label { text = Assets.Title }
UiStyle.PrimaryButton { left = 80, width = 560, height = 64, text = Assets.Subtitle, bg = { 1, 2, 3, 255 } }
-- runtime: levelLabel:SetText(Assets.Title .. " · " .. Assets.Subtitle)
`, "utf8");
    // Direct literal matcher must refuse Assets.lua
    const literal = writeBackMatchingTextLiterals(root, "三国全境争霸", "1");
    expect(literal.appliedCount).toBe(0);
    expect(fs.readFileSync(path.join(root, "scripts/data/Assets.lua"), "utf8")).toContain('Assets.Subtitle = "三国全境争霸"');

    // Factory label edit freezes only the button call site
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/UiStyle.lua", line: 3, type: "Label" },
      scope: "template",
      props: { text: "1" },
      previousProps: { text: "三国全境争霸", width: 560, height: 64, left: 80 }
    }]);
    expect(summary.appliedCount).toBe(1);
    expect(fs.readFileSync(path.join(root, "scripts/data/Assets.lua"), "utf8")).toContain('Assets.Subtitle = "三国全境争霸"');
    expect(fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8")).toContain('text = "1"');
    expect(fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8")).toContain("Assets.Title");
  });

  it("writes fontColor as call-site color without touching sibling PrimaryButtons", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-fontcolor-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/ui/UiStyle.lua"), `
function UiStyle.PrimaryButton(opts)
  return UI.Panel {
    children = {
      UI.Label { text = opts.text or "", color = opts.color or { 255, 255, 255, 255 } },
    },
  }
end
`, "utf8");
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), `
UiStyle.PrimaryButton { left = 80, width = 560, height = 64, text = "1", bg = { 1, 2, 3, 255 } }
UiStyle.PrimaryButton { left = 80, width = 560, height = 64, text = "2", bg = { 4, 5, 6, 255 } }
UiStyle.PrimaryButton { left = 80, width = 560, height = 64, text = "3", bg = { 7, 8, 9, 255 } }
`, "utf8");
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/UiStyle.lua", line: 4, type: "Label" },
      scope: "template",
      props: { fontColor: [10, 20, 30, 255] },
      previousProps: { text: "2", width: 560, height: 64, left: 80 },
      identityText: "2"
    }]);
    expect(summary.appliedCount).toBeGreaterThan(0);
    const main = fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8");
    expect(main).toContain('text = "2", bg = { 4, 5, 6, 255 } , color = { 10, 20, 30, 255 }');
    expect(main).toContain('text = "1", bg = { 1, 2, 3, 255 } }');
    expect(main).toContain('text = "3", bg = { 7, 8, 9, 255 } }');
    expect(main.match(/color = \{ 10, 20, 30, 255 \}/g)?.length).toBe(1);
  });

  it("routes factory text edits to call sites via writeBackUiOverridesToLua", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-factory-route-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/ui/UiStyle.lua"), `
function UiStyle.PrimaryButton(opts)
  return UI.Panel {
    children = {
      UI.Label { text = opts.text or "", fontSize = 22 },
    },
  }
end
`, "utf8");
    fs.writeFileSync(path.join(root, "scripts/ui/Home.lua"), `
UiStyle.PrimaryButton { text = "旧按钮", width = 200 }
`, "utf8");
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/UiStyle.lua", line: 3, type: "Label" },
      scope: "template",
      props: { text: "123123" },
      previousProps: { text: "旧按钮" }
    }]);
    expect(summary.appliedCount).toBe(1);
    expect(summary.filesTouched).toContain("scripts/ui/Home.lua");
    expect(fs.readFileSync(path.join(root, "scripts/ui/Home.lua"), "utf8")).toContain('text = "123123"');
    expect(fs.readFileSync(path.join(root, "scripts/ui/UiStyle.lua"), "utf8")).toContain("opts.text");
  });

  it("matches nearby runtime lines when AddChild line drifts from table-call start", () => {
    const source = `
function Screen.Create(UI)
  return UI.Label {
    text = "旧",
    fontSize = 18,
  }
end
`;
    // Table call starts at line 3; pretend runtime reported line 5.
    const result = patchLuaWidgetLiterals(source, { line: 5, type: "Label" }, {
      text: "新"
    }, { replaceExpressions: true });
    expect(result.applied).toEqual(["text"]);
    expect(result.text).toContain('text = "新"');
  });

  it("tree walk stays literals-only so folded defaults do not freeze expressions", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-tree-writeback-"));
    const relative = "scripts/ui/Panel.lua";
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, `
return UI.Panel {
  width = 100,
  height = options.height,
  backgroundColor = { 1, 2, 3, 255 },
}
`, "utf8");

    const result = writeBackUiTreeLiteralsToLua(root, {
      id: "root",
      type: "Panel",
      name: "Panel",
      props: {
        width: 160,
        height: 240,
        backgroundColor: [9, 8, 7, 255]
      },
      source: { file: relative, line: 2 },
      children: []
    });

    expect(result.appliedCount).toBe(2);
    expect(result.filesTouched).toEqual([relative]);
    const next = fs.readFileSync(absolute, "utf8");
    expect(next).toContain("width = 160");
    expect(next).toContain("height = options.height");
    expect(next).toContain("backgroundColor = { 9, 8, 7, 255 }");
  });

  it("collects dirty literal overrides against a conversion baseline", () => {
    const baseline: UiNode = {
      id: "scripts/ui/HomePage.lua:206:label:0",
      type: "Label",
      name: "Label",
      props: { text: "乱世夺城", fontSize: 40 },
      source: { file: "scripts/ui/HomePage.lua", line: 206 },
      children: []
    };
    const edited: UiNode = {
      ...baseline,
      props: { text: "新标题", fontSize: 40, left: 12 }
    };
    const dirty = collectDirtyLiteralOverrides(edited, baseline);
    expect(dirty).toHaveLength(1);
    expect(dirty[0]?.props).toEqual({ text: "新标题", left: 12 });
  });
});
