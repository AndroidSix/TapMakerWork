import { useEffect, useState, type ReactNode } from "react";
import { Box, Boxes, ChevronDown, ChevronRight, Code2, FileCode2, Folder, Image, Move, RotateCw, Scaling } from "lucide-react";
import { findUiNode, type UiNode, type WorkspaceMode } from "@tapmakerwork/protocol";
import type { TransformTool } from "../runtime-transform";
import { API } from "../bridge-api";
import type { FileEntry } from "./types";
import { labelForType, displayValue, concreteValue, runtimeStyle, uiChildren, imagePathFromProps } from "./ui-values";

export function iconForType(type: string): ReactNode {
  if (type === "Button") return <Box size={14} />;
  if (type === "Label") return <Code2 size={14} />;
  if (type === "Image") return <Image size={14} />;
  if (type === "Node") return <Box size={14} />;
  return <Boxes size={14} />;
}

export function PanelResizer({ orientation, onPointerDown, label }: {
  orientation: "col" | "row";
  onPointerDown: (event: React.PointerEvent) => void;
  label: string;
}) {
  return (
    <div
      className={`pane-resizer pane-resizer-${orientation}`}
      role="separator"
      aria-label={label}
      aria-orientation={orientation === "col" ? "vertical" : "horizontal"}
      onPointerDown={onPointerDown}
      title={orientation === "row" ? "拖动调整高度" : "拖动调整宽度"}
    />
  );
}

export const CANVAS_RESIZE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

export function RuntimeNode({ node, rootId, selectedId, selectedIds, onSelect, onDragStart, onPlayClick, onContextMenu, mode, canvasTool = "move", editable = false }: {
  node: UiNode;
  rootId: string;
  selectedId: string | undefined;
  selectedIds: string[];
  onSelect: (id: string, additive?: boolean) => void;
  onDragStart?: ((id: string, event: React.PointerEvent, operation?: string) => void) | undefined;
  onPlayClick?: ((node: UiNode) => void) | undefined;
  onContextMenu?: ((id: string, x: number, y: number) => void) | undefined;
  mode: WorkspaceMode;
  canvasTool?: TransformTool;
  editable?: boolean;
}) {
  if (!node || typeof node !== "object") return null;
  if (node.props?.visible === false) return null;
  const isSlot = node.type === "Slot";
  const isEmptyFactory = Boolean(node.props?.$factory) && uiChildren(node).length === 0;
  const className = [
    "runtime-node",
    `runtime-${(node.type || "widget").toLowerCase()}`,
    selectedIds.includes(node.id) ? "selected" : "",
    isSlot ? "runtime-slot" : "",
    isEmptyFactory ? "runtime-factory" : "",
    mode === "play" ? "local-runtime" : "",
    editable ? "canvas-editable-node" : "",
    node.id === rootId ? "canvas-root-node" : ""
  ].join(" ");
  const imageSource = node.type === "Image" ? imagePathFromProps(node.props) : undefined;
  return (
    <div
      className={className}
      style={runtimeStyle(node)}
      data-node-id={node.id}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect(node.id, event.shiftKey);
        if (editable && node.id !== rootId && onDragStart && !event.shiftKey && canvasTool === "move") onDragStart(node.id, event, "move");
        if (mode === "play" && node.type === "Button" && onPlayClick) onPlayClick(node);
      }}
      onContextMenu={(event) => {
        if (!editable || !onContextMenu) return;
        event.preventDefault();
        event.stopPropagation();
        onSelect(node.id);
        onContextMenu(node.id, event.clientX, event.clientY);
      }}
    >
      {isSlot && <span className="slot-label">{displayValue(node.props?.expression, "Slot").slice(0, 24)}</span>}
      {isEmptyFactory && <span className="factory-label">{String(node.props.$factory || node.name).slice(0, 28)}</span>}
      {node.type === "Label" && <span>{concreteValue(node.props?.text) == null ? (isSlot ? "" : node.name) : String(concreteValue(node.props?.text))}</span>}
      {node.type === "Button" && <span>{concreteValue(node.props?.text) == null ? "按钮" : String(concreteValue(node.props?.text))}</span>}
      {node.type === "Image" && (
        imageSource
          ? <img className="runtime-image" alt="" src={`${API}/api/project/asset?path=${encodeURIComponent(imageSource)}`} />
          : <span className="runtime-image-fallback">{node.name || "Image"}</span>
      )}
      {node.name && !isSlot && !isEmptyFactory && node.type === "Panel" && !concreteValue(node.props?.text) && (
        <span className="panel-name">{node.name}</span>
      )}
      {uiChildren(node).map((child) => (
        <RuntimeNode key={child.id} node={child} rootId={rootId} selectedId={selectedId} selectedIds={selectedIds} onSelect={onSelect} onDragStart={onDragStart} onPlayClick={onPlayClick} onContextMenu={onContextMenu} mode={mode} canvasTool={canvasTool} editable={editable} />
      ))}
      {selectedId === node.id && mode !== "play" && <span className="node-badge">{labelForType(node.type)}{node.source?.line ? ` :${node.source.line}` : ""}</span>}
      {editable && selectedId === node.id && node.id !== rootId && canvasTool === "move" && (
        <button type="button" className="runtime-transform-handle runtime-move-handle" aria-label={`移动 ${node.name || labelForType(node.type)}`} onPointerDown={(event) => onDragStart?.(node.id, event, "move")}><Move size={12} /></button>
      )}
      {editable && selectedId === node.id && node.id !== rootId && canvasTool === "rotate" && (
        <button type="button" className="runtime-transform-handle runtime-rotate-handle" aria-label={`旋转 ${node.name || labelForType(node.type)}`} onPointerDown={(event) => onDragStart?.(node.id, event, "rotate")}><RotateCw size={12} /></button>
      )}
      {editable && selectedId === node.id && node.id !== rootId && canvasTool === "scale" && (
        <button type="button" className="runtime-transform-handle runtime-scale-handle" aria-label={`缩放 ${node.name || labelForType(node.type)}`} onPointerDown={(event) => onDragStart?.(node.id, event, "scale")}><Scaling size={12} /></button>
      )}
      {editable && selectedId === node.id && node.id !== rootId && canvasTool === "rect" && CANVAS_RESIZE_HANDLES.map((handle) => (
        <button
          type="button"
          key={handle}
          className={`runtime-resize-handle handle-${handle}`}
          aria-label={`从 ${handle} 方向调整 ${node.name || labelForType(node.type)} 大小`}
          onPointerDown={(event) => onDragStart?.(node.id, event, handle)}
        />
      ))}
    </div>
  );
}

export function HierarchyNode({ node, selectedId, selectedIds, onSelect, onContextMenuId, depth = 0, renamingId, renameDraft, onRenameDraft, onCommitRename, onCancelRename, dragId, dropHint, onDragStartId, onDragOverId, onDropId }: {
  node: UiNode;
  selectedId: string | undefined;
  selectedIds: string[];
  onSelect: (id: string, additive?: boolean) => void;
  onContextMenuId: (id: string, x: number, y: number) => void;
  depth?: number;
  renamingId: string | null;
  renameDraft: string;
  onRenameDraft: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  dragId: string | null;
  dropHint: { id: string; pos: "before" | "after" | "inside" } | null;
  onDragStartId: (id: string) => void;
  onDragOverId: (id: string, event: React.DragEvent) => void;
  onDropId: (id: string, event: React.DragEvent) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const kids = uiChildren(node);
  const dropClass = dropHint?.id === node.id ? `drop-${dropHint.pos}` : "";
  useEffect(() => {
    if (selectedId && kids.length > 0 && findUiNode(node, selectedId)) setExpanded(true);
  }, [kids.length, node, selectedId]);
  return (
    <>
      <div
        data-hierarchy-node-id={node.id}
        className={`tree-row ${selectedIds.includes(node.id) ? "active" : ""} ${selectedId === node.id ? "primary" : ""} ${dropClass} ${dragId === node.id ? "dragging" : ""} ${node.props.visible === false ? "is-hidden" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable={renamingId !== node.id}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", node.id);
          onDragStartId(node.id);
        }}
        onDragOver={(event) => onDragOverId(node.id, event)}
        onDrop={(event) => onDropId(node.id, event)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onSelect(node.id);
          onContextMenuId(node.id, event.clientX, event.clientY);
        }}
      >
        <button className="tree-expand" aria-label={expanded ? "折叠" : "展开"} onClick={() => setExpanded(!expanded)} disabled={!kids.length}>
          {kids.length ? expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <span className="tree-spacer" />}
        </button>
        {renamingId === node.id ? (
          <input
            className="tree-rename"
            value={renameDraft}
            autoFocus
            onChange={(event) => onRenameDraft(event.target.value)}
            onBlur={() => onCommitRename()}
            onKeyDown={(event) => {
              if (event.key === "Enter") onCommitRename();
              if (event.key === "Escape") onCancelRename();
            }}
          />
        ) : (
          <button
            className="tree-label"
            onClick={(event) => onSelect(node.id, event.shiftKey)}
            onDoubleClick={() => {
              onSelect(node.id);
              // parent will wire rename via selected; trigger custom event
              window.dispatchEvent(new CustomEvent("tapmakerwork:rename-node", { detail: { id: node.id, name: node.name } }));
            }}
            title="双击可重命名"
          >
            {iconForType(node.type)}
            <span>{node.name}</span>
            <small>{node.type}</small>
          </button>
        )}
      </div>
      {expanded && kids.map((child) => (
        <HierarchyNode
          key={child.id}
          node={child}
          selectedId={selectedId}
          selectedIds={selectedIds}
          onSelect={onSelect}
          onContextMenuId={onContextMenuId}
          depth={depth + 1}
          renamingId={renamingId}
          renameDraft={renameDraft}
          onRenameDraft={onRenameDraft}
          onCommitRename={onCommitRename}
          onCancelRename={onCancelRename}
          dragId={dragId}
          dropHint={dropHint}
          onDragStartId={onDragStartId}
          onDragOverId={onDragOverId}
          onDropId={onDropId}
        />
      ))}
    </>
  );
}

export function FileTreeEntry({ entry, depth, selectedPath, onOpen }: {
  entry: FileEntry;
  depth: number;
  selectedPath: string | undefined;
  onOpen: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>();
  const [loading, setLoading] = useState(false);
  const toggle = async () => {
    if (entry.kind === "file") { onOpen(entry.path); return; }
    const next = !expanded;
    setExpanded(next);
    if (!next || children) return;
    setLoading(true);
    try {
      const response = await fetch(`${API}/api/project/files?path=${encodeURIComponent(entry.path)}`);
      const result = await response.json() as { entries?: FileEntry[] };
      setChildren(result.entries ?? []);
    } finally {
      setLoading(false);
    }
  };
  return <>
    <button
      className={`file-row ${selectedPath === entry.path ? "active" : ""}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => void toggle()}
      aria-expanded={entry.kind === "directory" ? expanded : undefined}
    >
      {entry.kind === "directory" ? expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <span className="file-indent" />}
      {entry.kind === "directory" ? <Folder size={14} /> : <FileCode2 size={14} />}
      <span>{entry.name}</span>{loading && <small>读取中…</small>}
    </button>
    {expanded && children?.map((child) => <FileTreeEntry key={child.path} entry={child} depth={depth + 1} selectedPath={selectedPath} onOpen={onOpen} />)}
  </>;
}
