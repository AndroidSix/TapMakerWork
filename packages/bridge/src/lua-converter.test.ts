import { describe, expect, it } from "vitest";
import { convertLuaUiSource, snapshotFromConversion } from "./lua-converter.js";

describe("Lua UI conversion", () => {
  it("converts nested Maker widgets and preserves dynamic expressions", () => {
    const document = convertLuaUiSource(`
      local Screen = {}
      function Screen.Create(options)
        local root = UI.Panel {
          width = "100%",
          backgroundColor = options.theme.page,
          children = {
            UI.Label { text = "标题", height = 40 },
            options.primaryButton { text = "开始", onClick = options.onStart },
          },
        }
        return { root = root }
      end
      return Screen
    `, "scripts/ui/Screen.lua");

    expect(document.root.type).toBe("Panel");
    expect(document.root.children.map((node) => node.type)).toEqual(["Label", "Button"]);
    expect(document.root.props.backgroundColor).toEqual({ $expression: "options.theme.page" });
    expect(document.root.children[1]?.props.$factory).toBe("options.primaryButton");
    expect(snapshotFromConversion(document).selectedId).toBe(document.root.children[1]?.id);
  });

  it("retains unresolved child factories as dynamic slots", () => {
    const document = convertLuaUiSource(`
      function Screen.Create(UI)
        local root = UI.Panel { children = { CreateComplexWidget(UI) } }
        return root
      end
    `, "scripts/ui/Dynamic.lua");

    expect(document.root.children[0]?.type).toBe("Slot");
    expect(document.confidence).toBe("hybrid");
    expect(document.diagnostics[0]?.severity).toBe("warning");
  });

  it("expands local widget helpers and uses literal Lua defaults", () => {
    const document = convertLuaUiSource(`
      local function Rule(UI, label)
        return UI.Label { text = label, fontSize = style.ruleSize or 12 }
      end
      function Screen.Create(options)
        local root = options.UI.Panel {
          children = {
            Rule(options.UI, "第一条"),
            Rule(options.UI, "第二条"),
          }
        }
        return root
      end
    `, "scripts/ui/Rules.lua");

    expect(document.root.children.map((node) => node.props.text)).toEqual(["第一条", "第二条"]);
    expect(document.root.children[0]?.props.fontSize).toBe(12);
    expect(new Set(document.root.children.map((node) => node.id)).size).toBe(2);
  });

  it("applies project style constants to component factories", () => {
    const document = convertLuaUiSource(`
      function Screen.Create(options)
        local root = options.primaryButton { text = "开始", height = style.buttonHeight }
        return root
      end
    `, "scripts/ui/Styled.lua", new Map([
      ["style.buttonHeight", 58],
      ["style.buttonFontSize", 14],
      ["style.primary", [170, 65, 50, 255]],
    ]));

    expect(document.root.props.height).toBe(58);
    expect(document.root.props.fontSize).toBe(14);
    expect(document.root.props.backgroundColor).toEqual([170, 65, 50, 255]);
  });

  it("evaluates design-space arithmetic and expands upgrade cards for preview", () => {
    const document = convertLuaUiSource(`
      local CARD_W = 190
      local CARD_GAP = 18
      local CARD_LEFT = math.floor((720 - (CARD_W * 3 + CARD_GAP * 2)) / 2)
      local value = UI.Label { text = "10", fontSize = 40 }
      local level = UI.Label { text = "当前 1 级" }
      local nextHint = UI.Label { text = "升级后 → 11人" }
      local cost = UI.Label { text = "50" }
      function Screen.Create()
        local root = UI.Panel {
          children = {
            UiStyle.UpgradeCard {
              left = CARD_LEFT,
              top = 64,
              width = CARD_W,
              bg = { 55, 130, 115, 255 },
              title = "初始兵马",
              valueLabel = value,
              levLabel = level,
              nextHint = nextHint,
              costLabel = cost,
            },
          },
        }
        return root
      end
    `, "scripts/ui/Hud.lua", new Map([["DesignSpace.DESIGN_W", 720]]));

    const card = document.root.children[0]!;
    expect(document.root.props.$previewDesignWidth).toBe(720);
    expect(card.type).toBe("Panel");
    expect(card.props.left).toBe(57);
    expect(card.props.position).toBe("absolute");
    expect(card.props.backgroundColor).toEqual([55, 130, 115, 255]);
    expect(card.children.map((node) => node.props.text)).toEqual(["初始兵马", "10", "当前 1 级", "升级后 → 11人", "消耗", "50"]);
  });

  it("keeps self-referential loop counters dynamic instead of recursing", () => {
    const document = convertLuaUiSource(`
      function Screen.Create()
        local index = 1
        index = index + 1
        local root = UI.Panel { children = { UI.Label { text = "州" .. index } } }
        return root
      end
    `, "scripts/ui/Grid.lua");

    expect(document.root.children[0]?.props.text).toEqual({ $expression: '"州" .. index' });
  });
});
