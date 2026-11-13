import { PanelBottom, ShieldAlert } from "lucide-react";
import type { LogChannel } from "@tapmakerwork/protocol";
import { DEFAULT_LAYOUT, terminalMaxHeight } from "./workspace-storage";
import type { WorkspaceLayout } from "./types";
import { LOG_CHANNELS } from "./constants";
import { PanelResizer } from "./tree-nodes";

export function TerminalPanel({
  activeTerminal,
  onSelectTerminal,
  logs,
  layout,
  onPersistLayout,
  onResetLayout,
  onResizeStart,
  onCopyOutput,
  onClearOutput
}: {
  activeTerminal: LogChannel;
  onSelectTerminal: (channel: LogChannel) => void;
  logs: Record<LogChannel, string[]>;
  layout: WorkspaceLayout;
  onPersistLayout: (next: WorkspaceLayout) => void;
  onResetLayout: () => void;
  onResizeStart: (event: React.PointerEvent) => void;
  onCopyOutput: (text: string) => void;
  onClearOutput: () => void;
}) {
  const activeLabel = LOG_CHANNELS.find((channel) => channel.id === activeTerminal)?.label ?? "当前";
  const output = logs[activeTerminal].join("\n");
  const collapsed = layout.terminal <= 42;

  return (
    <section className="terminal-panel panel">
      <PanelResizer orientation="row" label="调节终端高度" onPointerDown={onResizeStart} />
      <nav className="terminal-tabs">
        <span className="terminal-title"><PanelBottom size={14} />终端</span>
        {LOG_CHANNELS.map((channel) => (
          <button
            key={channel.id}
            aria-pressed={activeTerminal === channel.id}
            className={activeTerminal === channel.id ? "active" : ""}
            onClick={() => onSelectTerminal(channel.id)}
          >{channel.label}</button>
        ))}
        <div className="terminal-panel-actions">
          <button className="terminal-size" onClick={() => onPersistLayout({ ...layout, terminal: collapsed ? DEFAULT_LAYOUT.terminal : 40 })}>{collapsed ? "展开" : "收起"}</button>
          <button className="terminal-size" onClick={() => onPersistLayout({ ...layout, terminal: terminalMaxHeight() })}>最大化</button>
          <button className="terminal-reset" onClick={onResetLayout} title="一键还原 IDE 布局">还原布局</button>
        </div>
      </nav>
      <div className="terminal-channel">
        <div className="terminal-channel-actions">
          <button
            type="button"
            className="terminal-channel-action"
            title={`复制「${activeLabel}」全部输出`}
            onClick={() => onCopyOutput(output)}
          >复制</button>
          <button
            type="button"
            className="terminal-channel-action"
            title={`清空「${activeLabel}」输出`}
            onClick={onClearOutput}
          >清空</button>
        </div>
        <pre className={`terminal-output ${activeTerminal === "shell" ? "locked" : ""}`}>{output}</pre>
      </div>
      {activeTerminal === "shell" && <div className="sandbox-warning"><ShieldAlert size={14} />项目外访问将由 OS 沙箱拒绝；当前实现未通过验证，因此命令入口保持关闭。</div>}
    </section>
  );
}
