import { describe, expect, it } from "vitest";
import type { UiNode } from "@tapmakerwork/protocol";
import { applyUiSidecarOverrides, mergeUiSidecarOverride } from "./ui-sidecar.js";

function listItem(id: string, text: string, line = 42): UiNode {
  return {
    id,
    type: "Label",
    name: `row-${id}`,
    props: { text, fontSize: 14 },
    source: { file: "scripts/ui/RankingPage.lua", line },
    children: []
  };
}

describe("UI sidecar template overrides", () => {
  it("stores one template rule and reapplies it to every generated list item", () => {
    const first = mergeUiSidecarOverride([], listItem("runtime:1", "Alice"), { fontSize: 18, textColor: [255, 220, 120, 255] });
    const second = mergeUiSidecarOverride(first.overrides, listItem("runtime:2", "Bob"), { fontSize: 20 });
    expect(first.persisted).toBe(true);
    expect(second.overrides).toHaveLength(1);
    expect(second.overrides[0]?.props).toMatchObject({ fontSize: 20, textColor: [255, 220, 120, 255] });

    const root: UiNode = {
      id: "root",
      type: "Panel",
      name: "root",
      props: {},
      source: { file: "scripts/ui/RankingPage.lua", line: 1 },
      children: [listItem("next:1", "Carol"), listItem("next:2", "Dave")]
    };
    const applied = applyUiSidecarOverrides(root, second.overrides);
    expect(applied.children.map((node) => node.props.fontSize)).toEqual([20, 20]);
    expect(applied.children.map((node) => node.props.text)).toEqual(["Carol", "Dave"]);
  });

  it("does not persist nodes without a stable source location", () => {
    const node = listItem("runtime:temporary", "Temporary", 0);
    node.source = { file: "runtime", line: 0 };
    const result = mergeUiSidecarOverride([], node, { left: 40 });
    expect(result.persisted).toBe(false);
    expect(result.overrides).toEqual([]);
  });

  it("keeps runtime list data out of a repeated template override", () => {
    const result = mergeUiSidecarOverride([], listItem("runtime:1", "Alice"), {
      text: "This must remain runtime data",
      left: 24,
      fontSize: 18
    }, { dynamicTemplate: true });
    expect(result.persisted).toBe(true);
    expect(result.ignoredProps).toBe(1);
    expect(result.overrides[0]?.props).toEqual({ left: 24, fontSize: 18 });
  });
});
