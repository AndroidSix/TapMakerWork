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
});
