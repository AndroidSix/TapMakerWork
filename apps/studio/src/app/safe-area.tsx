import { useState } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import type { Insets, UiNode } from "@tapmakerwork/protocol";
import { describeSafeAreaIssue, type MeasuredNode, type SafeAreaIssue } from "./safe-area-check";
import { labelForType, uiChildren } from "./ui-values";

export function indexUiNodes(root: UiNode): Map<string, UiNode> {
  const index = new Map<string, UiNode>();
  const visit = (node: UiNode) => {
    index.set(node.id, node);
    uiChildren(node).forEach(visit);
  };
  visit(root);
  return index;
}

export function measureCanvasNodes(surface: HTMLElement, scale: number, rootId: string, nodes: Map<string, UiNode>): MeasuredNode[] {
  const origin = surface.getBoundingClientRect();
  const measured: MeasuredNode[] = [];
  for (const element of surface.querySelectorAll<HTMLElement>("[data-node-id]")) {
    const id = element.dataset.nodeId;
    const node = id ? nodes.get(id) : undefined;
    if (!node || node.id === rootId) continue;
    const rect = element.getBoundingClientRect();
    measured.push({
      id: node.id,
      name: node.name,
      type: node.type,
      rect: { left: (rect.left - origin.left) / scale, top: (rect.top - origin.top) / scale, width: rect.width / scale, height: rect.height / scale },
      hasChildren: uiChildren(node).length > 0,
      insideScroll: Boolean(element.parentElement?.closest('[class*="runtime-scroll"]'))
    });
  }
  return measured;
}

export function SafeAreaOverlay({ insets, canvas, scale, issues }: {
  insets: Insets;
  canvas: { width: number; height: number };
  scale: number;
  issues: SafeAreaIssue[];
}) {
  const px = (value: number) => `${value * scale}px`;
  const zones = [
    { key: "top", size: insets.top, style: { left: 0, right: 0, top: 0, height: px(insets.top) } },
    { key: "bottom", size: insets.bottom, style: { left: 0, right: 0, bottom: 0, height: px(insets.bottom) } },
    { key: "left", size: insets.left, style: { left: 0, top: 0, bottom: 0, width: px(insets.left) } },
    { key: "right", size: insets.right, style: { right: 0, top: 0, bottom: 0, width: px(insets.right) } }
  ].filter((zone) => zone.size > 0);
  return (
    <div className="safe-area-overlay" aria-hidden="true" style={{ width: px(canvas.width), height: px(canvas.height) }}>
      {zones.map((zone) => <div key={zone.key} className={`safe-area-zone is-${zone.key}`} style={zone.style}><span>{Math.round(zone.size)}px</span></div>)}
      {issues.map((issue) => (
        <div
          key={issue.id}
          className={`safe-area-issue is-${issue.kind}`}
          style={{ left: px(issue.rect.left), top: px(issue.rect.top), width: px(issue.rect.width), height: px(issue.rect.height) }}
        />
      ))}
    </div>
  );
}

export function SafeAreaToggle({ enabled, issues, onToggle, onSelectIssue }: {
  enabled: boolean;
  issues: SafeAreaIssue[];
  onToggle: () => void;
  onSelectIssue: (id: string) => void;
}) {
  const [listOpen, setListOpen] = useState(false);
  const label = !enabled ? "安全区检查已关闭" : issues.length ? `${issues.length} 个节点越界` : "安全区无越界";
  return (
    <div className="safe-area-toggle">
      <button
        type="button"
        className={`${enabled ? "active" : ""} ${enabled && issues.length ? "has-issues" : ""}`}
        aria-pressed={enabled}
        title={`${label}。点击切换安全区可视化`}
        onClick={onToggle}
      >
        {enabled && issues.length ? <ShieldAlert size={13} /> : <ShieldCheck size={13} />}安全区
      </button>
      {enabled && issues.length > 0 && (
        <button type="button" className="safe-area-count" aria-expanded={listOpen} aria-label={`查看 ${issues.length} 个越界节点`} onClick={() => setListOpen((open) => !open)}>
          {issues.length}
        </button>
      )}
      {enabled && listOpen && issues.length > 0 && (
        <ul className="safe-area-issue-list" role="list">
          {issues.map((issue) => (
            <li key={issue.id}>
              <button type="button" className={`is-${issue.kind}`} onClick={() => { onSelectIssue(issue.id); setListOpen(false); }}>
                <strong>{labelForType(issue.type)} · {issue.name || issue.id}</strong>
                <small>{describeSafeAreaIssue(issue)}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
