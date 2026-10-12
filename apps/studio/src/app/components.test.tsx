import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { UiNode } from "@tapmakerwork/protocol";
import { ProjectRejectDialog } from "./dialogs";
import { ToastStack } from "./ToastStack";
import { FileTreeEntry, HierarchyNode, RuntimeNode } from "./tree-nodes";

const noop = () => undefined;

const tree: UiNode = {
  id: "root",
  type: "Panel",
  name: "Root",
  props: {},
  children: [
    { id: "start", type: "Button", name: "StartButton", props: { text: "开始" }, children: [] },
    { id: "title", type: "Label", name: "Title", props: { visible: false }, children: [] }
  ]
};

function renderHierarchy(selectedId: string | undefined, renamingId: string | null = null) {
  return renderToStaticMarkup(
    <HierarchyNode
      node={tree}
      selectedId={selectedId}
      selectedIds={selectedId ? [selectedId] : []}
      onSelect={noop}
      onContextMenuId={noop}
      renamingId={renamingId}
      renameDraft="新名字"
      onRenameDraft={noop}
      onCommitRename={noop}
      onCancelRename={noop}
      dragId={null}
      dropHint={null}
      onDragStartId={noop}
      onDragOverId={noop}
      onDropId={noop}
    />
  );
}

describe("extracted app components", () => {
  it("renders nothing for an empty toast list", () => {
    expect(renderToStaticMarkup(<ToastStack items={[]} />)).toBe("");
  });

  it("renders toasts with kind and busy classes", () => {
    const html = renderToStaticMarkup(<ToastStack items={[{ id: 1, kind: "success", message: "已保存", busy: true }]} />);
    expect(html).toContain("toast-success toast-busy");
    expect(html).toContain("已保存");
  });

  it("shows the rejected path and reason", () => {
    const html = renderToStaticMarkup(<ProjectRejectDialog path="/tmp/empty" message="不是 Maker 项目" onClose={noop} />);
    expect(html).toContain("无法打开此文件夹");
    expect(html).toContain("不是 Maker 项目");
    expect(html).toContain("/tmp/empty");
  });

  it("renders the hierarchy with selection and hidden markers", () => {
    const html = renderHierarchy("start");
    expect(html).toContain("StartButton");
    expect(html).toMatch(/data-hierarchy-node-id="start" class="tree-row active primary/);
    expect(html).toMatch(/data-hierarchy-node-id="title" class="[^"]*is-hidden/);
  });

  it("swaps the label for an input while renaming", () => {
    const html = renderHierarchy(undefined, "title");
    expect(html).toContain('class="tree-rename"');
    expect(html).toContain('value="新名字"');
  });

  it("renders runtime nodes, skipping hidden ones", () => {
    const html = renderToStaticMarkup(<RuntimeNode node={tree} rootId="root" selectedId="start" selectedIds={["start"]} onSelect={noop} mode="inspect" />);
    expect(html).toContain('data-node-id="start"');
    expect(html).toContain("开始");
    expect(html).not.toContain('data-node-id="title"');
    expect(html).toContain("node-badge");
  });

  it("highlights the selected file entry", () => {
    const html = renderToStaticMarkup(<FileTreeEntry entry={{ name: "main.lua", path: "scripts/main.lua", kind: "file" }} depth={1} selectedPath="scripts/main.lua" onOpen={noop} />);
    expect(html).toContain("file-row active");
    expect(html).toContain("main.lua");
  });
});
