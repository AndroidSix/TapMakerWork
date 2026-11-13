import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { findUiNode, type UiNodeType, type UiSnapshot, type UiTreeOp } from "@tapmakerwork/protocol";
import { HierarchyNode } from "./tree-nodes";
import type { ToastKind } from "./types";
import { Tip } from "../Tip";

type DropHint = { id: string; pos: "before" | "after" | "inside" } | null;

/** 控件树面板：节点操作工具条 + 可拖拽的层级树。状态仍由 App 持有，这里只负责呈现。 */
export function HierarchyPane({
  snapshot,
  selectedNodeIds,
  newNodeType,
  onNewNodeTypeChange,
  renamingId,
  renameDraft,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  dragId,
  dropHint,
  treeRef,
  onSelect,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onRunTreeOp,
  onDuplicate,
  onBeginRename,
  notify
}: {
  snapshot: UiSnapshot;
  selectedNodeIds: string[];
  newNodeType: UiNodeType;
  onNewNodeTypeChange: (type: UiNodeType) => void;
  renamingId: string | null;
  renameDraft: string;
  onRenameDraftChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  dragId: string | null;
  dropHint: DropHint;
  treeRef: React.RefObject<HTMLDivElement | null>;
  onSelect: (id: string, additive?: boolean) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  onDragStart: (id: string) => void;
  onDragOver: (id: string, event: React.DragEvent) => void;
  onDrop: (id: string, event: React.DragEvent) => void;
  onRunTreeOp: (op: UiTreeOp, label: string) => void;
  onDuplicate: () => void;
  onBeginRename: () => void;
  notify: (message: string, kind?: ToastKind) => void;
}) {
  const selected = snapshot.selectedId ? findUiNode(snapshot.root, snapshot.selectedId) : undefined;
  const noSelection = !snapshot.selectedId;

  /** 工具条统一入口：没选中节点时给提示，避免每个按钮重复写同一段守卫。 */
  const withSelection = (run: (node: NonNullable<typeof selected>) => void) => () => {
    if (!selected) {
      notify("请先选择节点", "warn");
      return;
    }
    run(selected);
  };

  return (
    <div className="hier-wrap">
      <div className="hier-actions">
        <Tip label="显示/隐藏当前节点（对齐 Cocos Creator 的眼睛开关）。隐藏时画布不渲染该节点。">
          <button
            className="icon-command"
            aria-label="显示隐藏"
            disabled={noSelection}
            onClick={withSelection((node) => onRunTreeOp({ type: "toggle-visible", nodeId: node.id }, node.props.visible === false ? "显示节点" : "隐藏节点"))}
          >
            {selected?.props.visible === false ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </Tip>
        <Tip label="在同级节点中上移。">
          <button className="icon-command" aria-label="上移" disabled={noSelection} onClick={withSelection((node) => onRunTreeOp({ type: "move", nodeId: node.id, direction: "up" }, "上移"))}><ArrowUp size={13} /></button>
        </Tip>
        <Tip label="在同级节点中下移。">
          <button className="icon-command" aria-label="下移" disabled={noSelection} onClick={withSelection((node) => onRunTreeOp({ type: "move", nodeId: node.id, direction: "down" }, "下移"))}><ArrowDown size={13} /></button>
        </Tip>
        <select value={newNodeType} onChange={(event) => onNewNodeTypeChange(event.target.value as UiNodeType)} title="新建节点类型">
          <option value="Node">空节点</option>
          <option value="Panel">Panel</option>
          <option value="Label">Label</option>
          <option value="Button">Button</option>
          <option value="Image">Image</option>
        </select>
        <Tip label="在当前节点下创建子节点（Cocos：创建子节点）。">
          <button
            className="icon-command"
            aria-label="添加子节点"
            disabled={noSelection}
            onClick={withSelection((node) => onRunTreeOp({ type: "insert-child", nodeId: node.id, nodeType: newNodeType }, `添加子节点 ${newNodeType}`))}
          ><Plus size={13} /></button>
        </Tip>
        <Tip label="在当前节点旁创建同级节点（Cocos：创建兄弟节点）。根节点不可用。">
          <button
            className="icon-command"
            aria-label="添加兄弟节点"
            disabled={noSelection}
            onClick={withSelection((node) => onRunTreeOp({ type: "insert-sibling", nodeId: node.id, nodeType: newNodeType }, `添加兄弟节点 ${newNodeType}`))}
          ><Plus size={13} /><span className="tiny">兄弟</span></button>
        </Tip>
        <Tip label="删除当前节点（根节点不可删）。已接入 Runtime 时会立即销毁真实控件。">
          <button
            className="icon-command danger"
            aria-label="删除节点"
            disabled={noSelection}
            onClick={withSelection((node) => onRunTreeOp({ type: "delete", nodeId: node.id }, `删除 ${node.name}`))}
          ><Trash2 size={13} /></button>
        </Tip>
        <Tip label="复制当前节点（含子节点），插在同级后面。根节点不可复制。">
          <button className="icon-command" aria-label="复制节点" disabled={noSelection} onClick={onDuplicate}><Copy size={13} /></button>
        </Tip>
        <Tip label="重命名当前节点（也可在层级树中双击名称）。">
          <button className="icon-command" aria-label="重命名节点" disabled={noSelection} onClick={onBeginRename}><span className="tiny">重命名</span></button>
        </Tip>
      </div>
      <div className="hierarchy-tree-scroll" ref={treeRef}>
        <HierarchyNode
          node={snapshot.root}
          selectedId={snapshot.selectedId}
          selectedIds={selectedNodeIds}
          onSelect={onSelect}
          onContextMenuId={onContextMenu}
          renamingId={renamingId}
          renameDraft={renameDraft}
          onRenameDraft={onRenameDraftChange}
          onCommitRename={onCommitRename}
          onCancelRename={onCancelRename}
          dragId={dragId}
          dropHint={dropHint}
          onDragStartId={onDragStart}
          onDragOverId={onDragOver}
          onDropId={onDrop}
        />
      </div>
    </div>
  );
}
