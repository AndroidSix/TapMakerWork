import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectDirtyLiteralOverrides,
  INSPECTOR_EDITABLE_KEYS,
  patchLuaWidgetLiterals,
  writeBackMatchingTextLiterals,
  writeBackUiOverridesToLua,
  writeBackUiTreeLiteralsToLua
} from "./lua-prop-writeback.js";
import type { UiSidecarOverride } from "./ui-sidecar.js";
import type { UiNode } from "@tapmakerwork/protocol";

describe("lua prop writeback", () => {
  it("keeps every Studio inspector/canvas editable prop in the Lua writeback allowlist", () => {
    // Guard against backgroundImage-class regressions: UI can edit, restart loses.
    const source = `
UI.Panel {
  width = 100,
  height = 80,
  left = 10,
  top = 20,
  position = "absolute",
  rotate = 0,
  transform = { scale = 1 },
  gap = 8,
  flexDirection = "column",
  text = "hi",
  fontSize = 16,
  backgroundImage = "",
  color = { 255, 255, 255, 255 },
  fontColor = { 255, 255, 255, 255 },
  textColor = { 255, 255, 255, 255 },
  opacity = 1,
  backgroundColor = { 0, 0, 0, 255 },
  borderRadius = 8,
}
`;
    for (const key of INSPECTOR_EDITABLE_KEYS) {
      const value = key === "text" ? "ok"
        : key === "position" ? "relative"
          : key === "flexDirection" ? "row"
            : key === "backgroundImage" ? "image/a.png"
              : key === "transform" ? { scale: 1.25 }
                : key === "color" || key === "fontColor" || key === "textColor" || key === "backgroundColor"
                  ? [1, 2, 3, 255]
                  : 42;
      const result = patchLuaWidgetLiterals(source, { line: 2, type: "Panel" }, { [key]: value }, {
        replaceExpressions: true,
        insertMissingFields: true
      });
      expect(result.skipped.some((item) => item.key === key && item.reason === "key_not_writable"), key).toBe(false);
      expect(result.applied.includes(key) || result.skipped.some((item) => item.key === key && item.reason === "unchanged"), key).toBe(true);
    }
  });

  it("persists rotate and transform.scale from inspector / canvas tools", () => {
    const source = `
UI.Panel {
  id = "card",
  width = 190,
  height = 290,
  backgroundColor = { 55, 130, 115, 255 },
}
`;
    const result = patchLuaWidgetLiterals(source, { line: 2, type: "Panel" }, {
      rotate: 15,
      transform: { scale: 1.1 }
    }, { replaceExpressions: true, insertMissingFields: true });
    expect(result.applied.sort()).toEqual(["rotate", "transform"]);
    expect(result.text).toContain("rotate = 15");
    expect(result.text).toContain("transform = { scale = 1.1 }");
  });

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
    }, {
      replaceExpressions: true,
      insertMissingFields: true,
      previousProps: { height: 64, left: 12 }
    });

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

  it("writes PrimaryButton bg across line drift when selector is Panel", () => {
    // Sidecar often keeps a stale line after an earlier insert; PrimaryButton is typed Button.
    const source = `
local pvpBtn = UiStyle.PrimaryButton {
  left = 80, width = 560, height = 64,
  text = "多人争霸（耗1体力）",
  bg = { 170, 65, 50, 255 },
  rim = { 90, 35, 28, 255 },
}
-- blank
local adStaminaBtn = UiStyle.PrimaryButton {
  left = 80, width = 560, height = 64,
  text = "观看广告（+3体力）",
  bg = { 155, 110, 40, 255 },
  rim = { 90, 65, 25, 255 },
}
`;
    // Stale line 8 (between buttons) typed Panel — must still hit the ad button (line 10).
    const result = patchLuaWidgetLiterals(source, { line: 8, type: "Panel" }, {
      backgroundColor: [0, 255, 136, 255]
    }, { replaceExpressions: true, insertMissingFields: true });
    expect(result.applied).toContain("bg");
    expect(result.text).toMatch(/观看广告（\+3体力）[\s\S]*?bg = \{ 0, 255, 136, 255 \}/);
    expect(result.text).toContain("bg = { 170, 65, 50, 255 }");
  });

  it("flushes remapped backgroundColor out of remaining overrides after writing bg", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-flush-bg-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), `
UiStyle.PrimaryButton {
  left = 80, width = 560, height = 64,
  text = "观看广告（+3体力）",
  bg = { 155, 110, 40, 255 },
  rim = { 90, 65, 25, 255 },
}
`, "utf8");
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/MainHUD.lua", line: 2, type: "Panel" },
      scope: "template",
      props: { backgroundColor: [0, 255, 136, 255] },
      previousProps: { text: "观看广告（+3体力）", width: 560, height: 64, left: 80 },
      identityText: "观看广告（+3体力）"
    }]);
    expect(summary.overrides).toEqual([]);
    expect(fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8")).toContain(
      "bg = { 0, 255, 136, 255 }"
    );
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

  it("rejects dragging a UiStyle-internal Label and returns pre-edit values for live revert", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-kit-geom-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    const kitSource = `
function UiStyle.UpgradeCard(opts)
  return UI.Panel {
    position = "absolute",
    left = opts.left,
    top = opts.top,
    children = {
      UI.Panel {
        width = "100%",
        children = {
          UI.Label { text = opts.title, fontSize = 18 },
          UI.Label { text = "消耗 ", fontSize = 14 },
        },
      },
    },
  }
end
`;
    fs.writeFileSync(path.join(root, "scripts/ui/UiStyle.lua"), kitSource, "utf8");
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), `
UiStyle.UpgradeCard { title = "初始兵马", left = 40, top = 900 }
UiStyle.UpgradeCard { title = "产兵速度", left = 260, top = 900 }
`, "utf8");
    // Runtime AddChild stamps the title Label with its parent Panel line (8), not its own (11).
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/UiStyle.lua", line: 8, type: "Label" },
      scope: "template",
      nodeId: "UiStyle.lua:8:Label:7",
      props: { position: "absolute", left: -120, top: 30, width: 90, height: 24, text: "初始兵马2" },
      previousProps: { text: "初始兵马", left: 12, top: 18, width: 90, height: 24 },
      revertProps: { position: null, left: null, top: null, width: null, height: null, text: "初始兵马" },
      instancePath: "root/scripts/ui/UiStyle.lua|Label#2"
    }]);
    const detail = summary.details[0]!;
    const geometryReasons = detail.skipped.filter((item) => ["position", "left", "top", "width", "height"].includes(item.key));
    expect(geometryReasons).toHaveLength(5);
    expect(geometryReasons.every((item) => item.reason === "kit_internal_geometry")).toBe(true);
    // Factory Lua must stay untouched; only the unique call-site title changes.
    expect(fs.readFileSync(path.join(root, "scripts/ui/UiStyle.lua"), "utf8")).toBe(kitSource);
    expect(fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8")).toContain('title = "初始兵马2"');
    expect(detail.nodeId).toBe("UiStyle.lua:8:Label:7");
    expect(detail.instancePath).toBe("root/scripts/ui/UiStyle.lua|Label#2");
    expect(detail.revert).toEqual({ position: null, left: null, top: null, width: null, height: null });
    // Nothing geometric may survive into the sidecar for replay.
    expect(summary.overrides.flatMap((item) => Object.keys(item.props))).not.toContain("left");
  });

  it("still persists geometry for an id Label that lives inside a kit factory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-kit-id-geom-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/ui/UiStyle.lua"), `
function UiStyle.UpgradeCard(opts)
  return UI.Panel {
    children = {
      UI.Panel {
        children = { opts.levLabel },
      },
    },
  }
end
`, "utf8");
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), `
local produceLev = UI.Label { id = "produceLev", text = "当前 1 级", fontSize = 13, position = "absolute", left = 4, top = 60 }
UiStyle.UpgradeCard { levLabel = produceLev }
`, "utf8");
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/UiStyle.lua", line: 5, type: "Label" },
      scope: "template",
      props: { left: 10, top: 72 },
      previousProps: { id: "produceLev", text: "当前 1 级", left: 4, top: 60 }
    }]);
    expect(summary.details[0]!.skipped.filter((item) => item.reason === "kit_internal_geometry")).toHaveLength(0);
    const main = fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8");
    expect(main).toContain("left = 10");
    expect(main).toContain("top = 72");
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

  it("writes backgroundImage to UpgradeCard call site and wires opts passthrough in the factory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-bgimage-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/ui/UiStyle.lua"), `
function UiStyle.UpgradeCard(opts)
  local bg = opts.bg or { 1, 2, 3, 255 }
  return UI.Panel {
    backgroundColor = rim,
    children = {
      UI.Panel {
        backgroundColor = bg,
        children = { UI.Label { text = opts.title or "" } },
      },
    },
  }
end
`, "utf8");
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), `
UiStyle.UpgradeCard {
  id = "cardUnits",
  title = "初始兵马",
  bg = { 55, 130, 115, 255 },
}
`, "utf8");
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/MainHUD.lua", line: 2, type: "Panel" },
      scope: "template",
      props: { backgroundImage: "image/card_units.png" },
      previousProps: { text: "初始兵马", title: "初始兵马" },
      identityText: "初始兵马"
    }]);
    expect(summary.appliedCount).toBeGreaterThan(0);
    expect(summary.details.some((item) => item.skipped.some((skip) => skip.reason === "key_not_writable"))).toBe(false);
    const main = fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8");
    expect(main).toContain('backgroundImage = "image/card_units.png"');
    const style = fs.readFileSync(path.join(root, "scripts/ui/UiStyle.lua"), "utf8");
    expect(style).toContain("backgroundImage = opts.backgroundImage");
  });

  it("persists title Label edits via SetText(Title · Subtitle) when source line is the parent Panel", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-title-settext-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.mkdirSync(path.join(root, "scripts/data"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/data/Assets.lua"), `
Assets.Title = "乱世夺城"
Assets.Subtitle = "三国全境争霸"
`, "utf8");
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), `
local levelLabel = UI.Label {
  id = "hudLevel",
  text = Assets.Title,
  fontSize = 26,
}
local topUI = UI.Panel {
  children = {
    UI.Panel {
      children = { levelLabel },
    },
  },
}
function Refresh()
  self.refs.levelLabel:SetText(Assets.Title .. " · " .. Assets.Subtitle)
end
`, "utf8");
    // Runtime attributes the Label to the parent Panel line (Label@8 style miss → widget_not_found)
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/MainHUD.lua", line: 8, type: "Label" },
      scope: "template",
      props: { text: "乱世夺城 · 三国全境争霸332" },
      previousProps: {
        text: "乱世夺城 · 三国全境争霸",
        id: "hudLevel",
        width: 640,
        height: 36
      },
      identityText: "乱世夺城 · 三国全境争霸"
    }]);
    expect(summary.appliedCount).toBeGreaterThan(0);
    const main = fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8");
    expect(main).toContain('SetText("乱世夺城 · 三国全境争霸332")');
    expect(main).not.toContain('SetText(Assets.Title .. " · " .. Assets.Subtitle)');
    expect(fs.readFileSync(path.join(root, "scripts/data/Assets.lua"), "utf8")).toContain('Assets.Subtitle = "三国全境争霸"');
    expect(summary.overrides.every((item) => !item.props.text)).toBe(true);
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

  it("routes Panel nearby_no_insert text onto UpgradeCard title (not other screens)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-card-title-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/ui/UiStyle.lua"), `
function UiStyle.UpgradeCard(opts)
  return UI.Panel {
    backgroundColor = opts.bg,
    children = { UI.Label { text = opts.title or "" } },
  }
end
`, "utf8");
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), `
UiStyle.UpgradeCard {
  id = "cardProduce",
  title = "产兵速度",
  bg = { 150, 110, 45, 255 },
}
`, "utf8");
    fs.writeFileSync(path.join(root, "scripts/ui/HomePage.lua"), `
UiStyle.UpgradeCard { title = "产兵速度", bg = { 1, 2, 3, 255 } }
`, "utf8");
    // Runtime often attributes the card title to a nearby Panel line → nearby_no_insert
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/MainHUD.lua", line: 8, type: "Panel" },
      scope: "template",
      props: { text: "产粮加速" },
      previousProps: { text: "产兵速度", title: "产兵速度", width: 190 },
      identityText: "产兵速度"
    }]);
    expect(summary.appliedCount).toBeGreaterThan(0);
    expect(summary.details.some((d) => d.skipped.some((s) => s.key === "text"))).toBe(false);
    const main = fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8");
    expect(main).toContain('title = "产粮加速"');
    expect(fs.readFileSync(path.join(root, "scripts/ui/HomePage.lua"), "utf8")).toContain('title = "产兵速度"');
  });

  it("disambiguates sibling PrimaryButton fontColor via previous text + bg (not live identity)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-font-ambig-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.mkdirSync(path.join(root, "scripts/data"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/data/Assets.lua"), `
Assets.Subtitle = "三国全境争霸"
`, "utf8");
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
UiStyle.PrimaryButton { left = 80, top = 470, width = 560, height = 64, text = Assets.Subtitle, bg = { 55, 145, 120, 255 } }
UiStyle.PrimaryButton { left = 80, top = 546, width = 560, height = 64, text = "多人争霸", bg = { 166, 166, 166, 255 } }
UiStyle.PrimaryButton { left = 80, top = 622, width = 560, height = 64, text = "观看广告", bg = { 155, 110, 40, 255 } }
`, "utf8");
    fs.writeFileSync(path.join(root, "scripts/ui/LobbyView.lua"), `
UiStyle.PrimaryButton { left = 80, width = 560, height = 64, text = Assets.Subtitle, bg = { 1, 2, 3, 255 } }
`, "utf8");
    // Live label already shows "123123" but Lua still has Assets.Subtitle — must use previousProps.text
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/UiStyle.lua", line: 4, type: "Label" },
      scope: "template",
      props: { fontColor: [224, 180, 40, 255] },
      previousProps: {
        text: "三国全境争霸",
        width: 560,
        height: 64,
        left: 80,
        top: 470,
        backgroundColor: [55, 145, 120, 255]
      },
      identityText: "123123"
    }]);
    expect(summary.details.every((d) => !d.skipped.some((s) => s.reason === "call_site_ambiguous"))).toBe(true);
    expect(summary.appliedCount).toBeGreaterThan(0);
    const main = fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8");
    expect(main).toContain("color = { 224, 180, 40, 255 }");
    expect(main.match(/color = \{ 224, 180, 40, 255 \}/g)?.length).toBe(1);
    expect(fs.readFileSync(path.join(root, "scripts/ui/LobbyView.lua"), "utf8")).not.toContain("224, 180, 40");
  });

  it("writes Label position by id when runtime line misses the table", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-label-pos-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), `
local produceLev = UI.Label {
  id = "produceLev",
  text = "当前 1 级 · 产兵1.00/秒",
  fontSize = 13,
  position = "relative",
}
local wrap = UI.Panel {
  children = { produceLev },
}
`, "utf8");
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/MainHUD.lua", line: 9, type: "Label" },
      scope: "template",
      props: { position: "absolute", left: 12, top: 40 },
      previousProps: {
        id: "produceLev",
        text: "当前 1 级 · 产兵1.00/秒",
        position: "relative"
      },
      identityText: "当前 1 级 · 产兵1.00/秒"
    }]);
    expect(summary.appliedCount).toBeGreaterThan(0);
    const main = fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8");
    expect(main).toContain('position = "absolute"');
    expect(main).toContain("left = 12");
    expect(main).toContain("top = 40");
    expect(summary.details.every((d) => !d.skipped.some((s) => s.key === "position"))).toBe(true);
  });

  it("never freezes contentTop layout math into live parent-relative coords", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-layout-math-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/ui/UiStyle.lua"), `
function UiStyle.PrimaryButton(opts)
  return UI.Panel {
    children = { UI.Label { text = opts.text or "", color = opts.color or { 1, 1, 1, 255 } } },
  }
end
`, "utf8");
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), `
local contentTop = 100
UiStyle.PrimaryButton {
  position = "absolute",
  left = 80,
  top = contentTop + 470,
  width = 560,
  height = 64,
  text = "三国全境争霸",
  bg = { 55, 145, 120, 255 },
}
`, "utf8");
    // Live drag on inner Label reports parent-relative geometry — must not hit the call site.
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/UiStyle.lua", line: 3, type: "Label" },
      scope: "template",
      props: { left: 0, top: -4, width: 554, height: 58, fontColor: [224, 180, 40, 255] },
      previousProps: {
        text: "三国全境争霸",
        width: 560,
        height: 64,
        left: 80,
        backgroundColor: [55, 145, 120, 255]
      },
      identityText: "三国全境争霸"
    }]);
    const main = fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8");
    expect(main).toContain("top = contentTop + 470");
    expect(main).toContain("left = 80");
    expect(main).toContain("width = 560");
    expect(main).toContain("height = 64");
    expect(main).not.toContain("top = -4");
    expect(main).not.toContain("left = 0");
    // Color may still route to the call site.
    expect(summary.appliedCount).toBeGreaterThan(0);
    expect(main).toContain("color = { 224, 180, 40, 255 }");
  });

  it("rewrites contentTop+N by drag delta and syncs Layout() aliases", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-layout-delta-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), `
local contentTop = 100
UiStyle.PrimaryButton {
  left = 80,
  top = contentTop + 546,
  width = 560,
  height = 64,
  text = "多人争霸（耗1体力）",
  bg = { 170, 65, 50, 255 },
}
function MainHUD:Layout()
  local pvpTop = contentTop + 546
  self.refs.pvpBtn:SetStyle({ top = pvpTop })
end
`, "utf8");
    // Evaluated top was 646 (=100+546); user dragged to 600 → offset becomes 500.
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/MainHUD.lua", line: 3, type: "Panel" },
      scope: "template",
      props: { top: 600 },
      previousProps: { text: "多人争霸（耗1体力）", top: 646, left: 80, width: 560, height: 64 }
    }]);
    expect(summary.appliedCount).toBeGreaterThan(0);
    expect(summary.details.every((d) => !d.skipped.some((s) => s.key === "top"))).toBe(true);
    const main = fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8");
    expect(main).toContain("top = contentTop + 500");
    expect(main).toContain("local pvpTop = contentTop + 500");
    expect(main).not.toContain("contentTop + 546");
  });

  it("rejects measured parent-relative left/width chrome on kit call sites", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-measured-geo-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), `
UiStyle.PrimaryButton {
  left = 80,
  top = 622,
  width = 560,
  height = 64,
  text = "观看广告（+3体力）",
  bg = { 155, 110, 40, 255 },
}
`, "utf8");
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/MainHUD.lua", line: 2, type: "Panel" },
      scope: "template",
      props: { left: 3, width: 554, height: 58, fontSize: 22 },
      previousProps: {
        text: "观看广告（+3体力）",
        left: 80,
        top: 622,
        width: 560,
        height: 64
      }
    }]);
    const main = fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8");
    expect(main).toContain("left = 80");
    expect(main).toContain("width = 560");
    expect(main).toContain("height = 64");
    expect(summary.details.some((d) => d.skipped.some((s) => s.reason === "measured_geometry"))).toBe(true);
  });

  it("rewrites CARD_LEFT identifier geometry by delta", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-card-left-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), `
local CARD_LEFT = 80
UiStyle.UpgradeCard {
  id = "cardUnits",
  left = CARD_LEFT,
  top = 64,
  width = 190,
  title = "初始兵马",
  bg = { 55, 130, 115, 255 },
}
`, "utf8");
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/MainHUD.lua", line: 3, type: "Panel" },
      scope: "template",
      props: { left: 100 },
      previousProps: { text: "初始兵马", title: "初始兵马", left: 80, id: "cardUnits" }
    }]);
    expect(summary.appliedCount).toBeGreaterThan(0);
    const main = fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8");
    expect(main).toContain("left = CARD_LEFT + 20");
    expect(main).toContain("local CARD_LEFT = 80");
    expect(main).not.toContain("local CARD_LEFT +");
  });

  it("does not rewrite a local declaration when shifting an identifier offset", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-toppad-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), `
local topPad = safe.safeTop
local meta = UI.Panel {
  id = "metaBar",
  position = "absolute",
  left = 0,
  top = topPad,
  width = 720,
  height = 40,
}
function MainHUD:Layout()
  self.refs.meta:SetStyle({ top = topPad })
end
`, "utf8");
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/MainHUD.lua", line: 3, type: "Panel" },
      scope: "template",
      props: { top: 118 },
      previousProps: { id: "metaBar", top: 100, left: 0, width: 720, height: 40 }
    }]);
    const main = fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8");
    expect(main).toContain("local topPad = safe.safeTop");
    expect(main).not.toContain("local topPad +");
    expect(main).toContain("top = topPad + 18");
    expect(summary.details.some((detail) => detail.skipped.some((item) => item.reason === "syntax_rejected"))).toBe(false);
  });

  it("shifts an existing minus offset instead of nesting another delta", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-nested-delta-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), `
local attrTop = 800
local attrUI = UI.Panel {
  id = "attrUI",
  left = 0,
  top = attrTop - 7,
  width = 720,
  height = 390,
}
`, "utf8");
    writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/MainHUD.lua", line: 3, type: "Panel" },
      scope: "template",
      props: { top: 767 },
      previousProps: { id: "attrUI", top: 793, left: 0, width: 720, height: 390 }
    }]);
    const once = fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8");
    expect(once).toContain("top = attrTop - 33");
    expect(once).not.toContain("(attrTop - 7)");
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), once.replace("top = attrTop - 33", "top = (attrTop - 7) - 26"));
    writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/MainHUD.lua", line: 3, type: "Panel" },
      scope: "template",
      props: { top: 741 },
      previousProps: { id: "attrUI", top: 767, left: 0, width: 720, height: 390 }
    }]);
    const twice = fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8");
    expect(twice).toContain("top = (attrTop - 7) - 52");
    expect(twice).not.toContain("((attrTop - 7) - 26)");
  });

  it("refuses to shrink a multi-child layout row down to one card", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-container-box-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), `
local attrUI = UI.Panel {
  id = "attrUI",
  left = 0,
  top = 700,
  width = 720,
  height = 390,
  children = {
    { id = "cardUnits" },
    { id = "cardProduce" },
    { id = "cardOffline" },
  },
}
`, "utf8");
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/MainHUD.lua", line: 2, type: "Panel" },
      scope: "template",
      props: { left: 277, width: 190 },
      previousProps: { id: "attrUI", left: 0, top: 700, width: 720, height: 390 }
    }]);
    const main = fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8");
    expect(main).toContain("left = 0");
    expect(main).toContain("width = 720");
    expect(main).not.toContain("width = 190");
    expect(summary.details.some((detail) => detail.skipped.some((item) => item.reason === "container_forbidden"))).toBe(true);
  });

  it("wires rotate opts passthrough when writing kit call-site rotate", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-rotate-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/ui/UiStyle.lua"), `
function UiStyle.PrimaryButton(opts)
  return UI.Panel {
    left = opts.left,
    top = opts.top,
    width = opts.width or 280,
    children = { UI.Label { text = opts.text or "" } },
  }
end
`, "utf8");
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), `
UiStyle.PrimaryButton { left = 80, top = 100, width = 560, text = "开战", bg = { 1, 2, 3, 255 } }
`, "utf8");
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/MainHUD.lua", line: 2, type: "Panel" },
      scope: "template",
      props: { rotate: 15 },
      previousProps: { text: "开战", left: 80, top: 100, width: 560 }
    }]);
    expect(summary.appliedCount).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8")).toContain("rotate = 15");
    expect(fs.readFileSync(path.join(root, "scripts/ui/UiStyle.lua"), "utf8")).toContain("rotate = opts.rotate");
  });

  it("refuses backgroundImage on layout containers like lobbyBlock", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-container-bg-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), `
local lobbyBlock = UI.Panel {
  id = "lobbyBlock",
  left = 0,
  top = 0,
  width = 720,
  height = "100%",
  backgroundColor = { 0, 0, 0, 0 },
  children = {
    UI.Panel { id = "a" },
    UI.Panel { id = "b" },
    UI.Panel { id = "c" },
  },
}
`, "utf8");
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/MainHUD.lua", line: 2, type: "Panel" },
      scope: "template",
      props: { backgroundImage: "image/battle_bg.png" },
      previousProps: { id: "lobbyBlock" }
    }]);
    expect(summary.details.some((d) => d.skipped.some((s) => s.reason === "container_forbidden"))).toBe(true);
    expect(fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8")).not.toContain("battle_bg");
  });

  it("refuses fontSize that overflows the label box (UpgradeCard value overlap)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-font-overflow-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), `
local produce = UI.Label {
  id = "hudProduce",
  text = "1.00",
  fontSize = 34,
  height = 52,
  width = 149,
}
`, "utf8");
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/MainHUD.lua", line: 2, type: "Label" },
      scope: "template",
      props: { fontSize: 50 },
      previousProps: { id: "hudProduce", text: "1.00", fontSize: 34, height: 52 }
    }]);
    expect(summary.details.some((d) => d.skipped.some((s) => s.reason === "font_overflow"))).toBe(true);
    expect(fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8")).toContain("fontSize = 34");
  });

  it("never inserts absolute geometry onto Labels that had none", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-no-geom-insert-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/ui/MainHUD.lua"), `
local produceLev = UI.Label {
  id = "produceLev",
  text = "当前 1 级 · 产兵1.00/秒",
  fontSize = 13,
}
`, "utf8");
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/MainHUD.lua", line: 2, type: "Label" },
      scope: "template",
      props: { position: "absolute", left: 33, top: 90, width: 165, height: 30 },
      previousProps: { id: "produceLev", text: "当前 1 级 · 产兵1.00/秒" }
    }]);
    const lua = fs.readFileSync(path.join(root, "scripts/ui/MainHUD.lua"), "utf8");
    expect(lua).not.toMatch(/position\s*=/);
    expect(lua).not.toMatch(/left\s*=/);
    expect(summary.details.some((d) => d.skipped.some((s) => s.reason === "geometry_no_insert"))).toBe(true);
    expect(summary.overrides).toEqual([]);
  });

  it("drops factory geometry from remaining so sidecar cannot re-apply it", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmaker-no-sidecar-geom-"));
    fs.mkdirSync(path.join(root, "scripts/ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/ui/UiStyle.lua"), `
function UiStyle.UpgradeCard(opts)
  return UI.Panel {
    children = {
      UI.Panel {
        children = {
          UI.Label { text = opts.title, fontSize = 18 },
        },
      },
    },
  }
end
`, "utf8");
    const summary = writeBackUiOverridesToLua(root, [{
      selector: { sourceFile: "scripts/ui/UiStyle.lua", line: 5, type: "Panel" },
      scope: "template",
      props: { position: "absolute", left: 34, top: 56 },
      identityText: "离线粮草"
    }]);
    expect(summary.overrides).toEqual([]);
    expect(summary.details.some((d) => d.skipped.some((s) => s.reason === "kit_internal_geometry"))).toBe(true);
  });
});
