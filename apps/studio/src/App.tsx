import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Editor from "@monaco-editor/react";
import {
  Box,
  Boxes,
  ChevronDown,
  ChevronRight,
  CirclePlay,
  Code2,
  FileCode2,
  Files,
  Folder,
  GitBranch,
  Image,
  Layers3,
  MonitorPlay,
  PanelBottom,
  Pause,
  Play,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  Redo2,
  Undo2,
  Wifi,
  WifiOff
} from "lucide-react";
import {
  DEFAULT_DEVICE_PROFILES,
  findUiNode,
  type BridgeCapabilities,
  type BridgeEvent,
  type DeviceProfile,
  type LogChannel,
  type UiNode,
  type UiPatch,
  type UiSnapshot,
  type UiValue,
  type WorkspaceMode
} from "@tapmakerwork/protocol";

const API = "http://127.0.0.1:43121";

interface Health {
  ok: boolean;
  capabilities: BridgeCapabilities;
  makerVersion?: string;
  sandbox: { available: boolean; reason: string };
}

interface ProjectState {
  project?: { root: string; name: string; makerBound: boolean };
}

interface FileEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
}

const channels: Array<{ id: LogChannel; label: string }> = [
  { id: "runtime", label: "Runtime" },
  { id: "build", label: "构建" },
  { id: "lua", label: "Lua 检查" },
  { id: "shell", label: "Shell" },
  { id: "repl", label: "Lua REPL" },
  { id: "qrcode", label: "二维码" },
  { id: "agent", label: "Agent" }
];

const initialLogs: Record<LogChannel, string[]> = {
  runtime: ["等待 Runtime 帧提供器连接…", "UI Bridge 已使用模拟快照启动。"],
  build: ["暂无构建任务。"],
  lua: ["暂无 Lua 诊断。"],
  shell: ["Shell 已锁定：OS 级项目沙箱尚未通过双平台逃逸测试。"],
  repl: ["Lua REPL 将在 Runtime Dev Bridge 接入后启用。"],
  qrcode: ["暂无二维码任务。"],
  agent: ["等待 Codex / Claude / Cursor 通过项目 MCP Bridge 连接。"]
};

function iconForType(type: string): ReactNode {
  if (type === "Button") return <Box size={14} />;
  if (type === "Label") return <Code2 size={14} />;
  return <Boxes size={14} />;
}

function rgba(value: UiValue | undefined, fallback = "transparent"): string {
  if (!Array.isArray(value) || value.length < 3) return typeof value === "string" ? value : fallback;
  const [r, g, b, a = 255] = value as number[];
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

function displayValue(value: UiValue | undefined, fallback = ""): string {
  if (value == null) return fallback;
  if (typeof value === "object" && !Array.isArray(value) && "$expression" in value) {
    return `{${String(value.$expression)}}`;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function dimension(value: UiValue | undefined): CSSProperties["width"] {
  if (typeof value === "number") return `${value}px`;
  if (typeof value === "string") return value;
  return undefined;
}

function runtimeStyle(node: UiNode): CSSProperties {
  const props = node.props;
  return {
    width: dimension(props.width),
    height: dimension(props.height),
    minWidth: dimension(props.minWidth),
    minHeight: dimension(props.minHeight),
    display: "flex",
    flexDirection: props.flexDirection === "row" ? "row" : "column",
    justifyContent: typeof props.justifyContent === "string" ? props.justifyContent as CSSProperties["justifyContent"] : undefined,
    alignItems: typeof props.alignItems === "string" ? props.alignItems as CSSProperties["alignItems"] : undefined,
    alignSelf: typeof props.alignSelf === "string" ? props.alignSelf as CSSProperties["alignSelf"] : undefined,
    gap: typeof props.gap === "number" ? props.gap : undefined,
    paddingTop: typeof props.paddingTop === "number" ? props.paddingTop : undefined,
    paddingBottom: typeof props.paddingBottom === "number" ? props.paddingBottom : undefined,
    background: rgba(props.backgroundColor),
    borderRadius: typeof props.borderRadius === "number" ? props.borderRadius : undefined,
    color: rgba(props.fontColor, "#e8edf5"),
    fontSize: typeof props.fontSize === "number" ? props.fontSize : undefined,
    position: props.position === "absolute" ? "absolute" : "relative",
    left: typeof props.left === "number" ? props.left : undefined,
    top: typeof props.top === "number" ? props.top : undefined,
    flexGrow: typeof props.flexGrow === "number" ? props.flexGrow : undefined,
    flexShrink: typeof props.flexShrink === "number" ? props.flexShrink : undefined,
    boxSizing: "border-box"
  };
}

function RuntimeNode({ node, selectedId, onSelect }: {
  node: UiNode;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const className = ["runtime-node", `runtime-${node.type.toLowerCase()}`, selectedId === node.id ? "selected" : ""].join(" ");
  return (
    <div
      className={className}
      style={runtimeStyle(node)}
      data-node-id={node.id}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect(node.id);
      }}
    >
      {node.type === "Label" && <span>{displayValue(node.props.text, node.name)}</span>}
      {node.type === "Button" && <span>{displayValue(node.props.text, node.name)}</span>}
      {node.type === "Slot" && <span>{displayValue(node.props.expression, "动态插槽")}</span>}
      {node.children.map((child) => <RuntimeNode key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} />)}
      {selectedId === node.id && <span className="node-badge">{node.name}</span>}
    </div>
  );
}

function HierarchyNode({ node, selectedId, onSelect, depth = 0 }: {
  node: UiNode;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <>
      <div className={`tree-row ${selectedId === node.id ? "active" : ""}`} style={{ paddingLeft: 8 + depth * 14 }}>
        <button className="tree-expand" aria-label={expanded ? "折叠" : "展开"} onClick={() => setExpanded(!expanded)} disabled={!node.children.length}>
          {node.children.length ? expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <span className="tree-spacer" />}
        </button>
        <button className="tree-label" onClick={() => onSelect(node.id)}>
          {iconForType(node.type)}<span>{node.name}</span><small>{node.type}</small>
        </button>
      </div>
      {expanded && node.children.map((child) => (
        <HierarchyNode key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
      ))}
    </>
  );
}

function InspectorField({ label, property, value, onCommit }: {
  label: string;
  property: string;
  value: UiValue | undefined;
  onCommit: (property: string, value: UiValue) => void;
}) {
  const display = Array.isArray(value) ? value.join(", ") : value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  const [draft, setDraft] = useState(display);
  useEffect(() => setDraft(display), [display]);
  const commit = () => {
    if (draft === display) return;
    let next: UiValue = draft;
    if (/^-?\d+(\.\d+)?$/.test(draft)) next = Number(draft);
    else if (draft.includes(",") && draft.split(",").every((part) => /^\s*\d+\s*$/.test(part))) next = draft.split(",").map(Number);
    onCommit(property, next);
  };
  return (
    <label className="property-row">
      <span>{label}</span>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => event.key === "Enter" && commit()} />
    </label>
  );
}

export function App() {
  const [connected, setConnected] = useState(false);
  const [health, setHealth] = useState<Health>();
  const [project, setProject] = useState<ProjectState["project"]>();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [snapshot, setSnapshot] = useState<UiSnapshot>();
  const [mode, setMode] = useState<WorkspaceMode>("inspect");
  const [device, setDevice] = useState<DeviceProfile>(DEFAULT_DEVICE_PROFILES[0]!);
  const [fps, setFps] = useState(60);
  const [activeTerminal, setActiveTerminal] = useState<LogChannel>("runtime");
  const [logs, setLogs] = useState(initialLogs);
  const [leftTab, setLeftTab] = useState<"files" | "hierarchy" | "assets">("hierarchy");
  const [centerTab, setCenterTab] = useState<"visual" | "code">("visual");
  const [code, setCode] = useState("-- 正在读取 scripts/ui/HomePage.lua…");
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageScale, setStageScale] = useState(1);

  useEffect(() => {
    void fetch(`${API}/api/health`).then((response) => response.json()).then(setHealth).catch(() => undefined);
    void fetch(`${API}/api/project`).then((response) => response.json()).then((value: ProjectState) => {
      setProject(value.project);
      if (value.project) {
        void fetch(`${API}/api/project/files`).then((response) => response.json()).then((result: { entries: FileEntry[] }) => setFiles(result.entries));
        void fetch(`${API}/api/project/file?path=${encodeURIComponent("scripts/ui/HomePage.lua")}`)
          .then((response) => response.json())
          .then((result: { text?: string; error?: string }) => setCode(result.text ?? `-- ${result.error ?? "无法读取文件"}`));
      }
    }).catch(() => undefined);
    void fetch(`${API}/api/ui/snapshot`).then((response) => response.json()).then(setSnapshot).catch(() => undefined);
    let disposed = false;
    let reconnectTimer: number | undefined;
    const connect = () => {
      const socket = new WebSocket("ws://127.0.0.1:43121/ws");
      socketRef.current = socket;
      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        if (!disposed) reconnectTimer = window.setTimeout(connect, 1_000);
      };
      socket.onmessage = (message) => {
        const event = JSON.parse(String(message.data)) as BridgeEvent;
        if (event.type === "ui.snapshot" || event.type === "ui.patch.applied" || event.type === "ui.patch.rejected") setSnapshot(event.snapshot);
        if (event.type === "log.append") setLogs((current) => ({ ...current, [event.channel]: [...current[event.channel], ...event.lines] }));
      };
    };
    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const updateScale = () => setStageScale(Math.min(stage.clientWidth / device.width, stage.clientHeight / device.height));
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [device.width, device.height]);

  const selected = useMemo(() => snapshot?.selectedId ? findUiNode(snapshot.root, snapshot.selectedId) : undefined, [snapshot]);

  const selectNode = (nodeId: string) => {
    setSnapshot((current) => current ? { ...current, selectedId: nodeId } : current);
  };

  const patchNode = async (property: string, value: UiValue) => {
    if (!snapshot || !selected) return;
    const patch: UiPatch = {
      requestId: crypto.randomUUID(),
      baseRevision: snapshot.revision,
      nodeId: selected.id,
      props: { [property]: value }
    };
    const response = await fetch(`${API}/api/ui/patch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch)
    });
    const result = await response.json() as UiSnapshot | { error: string };
    if (response.ok) setSnapshot(result as UiSnapshot);
    else setLogs((current) => ({ ...current, agent: [...current.agent, `补丁失败：${(result as { error: string }).error}`] }));
  };

  const historyAction = async (action: "undo" | "redo") => {
    const response = await fetch(`${API}/api/ui/${action}`, { method: "POST" });
    if (response.ok) setSnapshot(await response.json() as UiSnapshot);
  };

  const runtimeAction = async (action: "start" | "refresh") => {
    setRuntimeBusy(true);
    setActiveTerminal("runtime");
    try {
      const response = await fetch(`${API}/api/maker/preview/${action}`, { method: "POST" });
      const result = await response.json() as { error?: string };
      if (!response.ok) setLogs((current) => ({ ...current, runtime: [...current.runtime, `Runtime 操作失败：${result.error ?? response.statusText}`] }));
    } finally {
      setRuntimeBusy(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        void historyAction(event.shiftKey ? "redo" : "undo");
      } else if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        void historyAction("redo");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const updateDevice = (changes: Partial<DeviceProfile>) => setDevice((current) => ({ ...current, ...changes, id: changes.id ?? "custom", label: changes.label ?? "自定义" }));

  return (
    <main className="app-shell">
      <header className="titlebar">
        <div className="brand"><span className="brand-mark">T</span><strong>TapMakerWork</strong><span className="phase-badge">M0</span></div>
        <div className="project-chip"><Folder size={14} /><span>{project?.name ?? "未绑定项目"}</span><GitBranch size={13} /><small>main</small></div>
        <div className="runtime-status" role="status">{connected ? <Wifi size={14} aria-hidden="true" /> : <WifiOff size={14} aria-hidden="true" />}<span>{connected ? "Bridge 已连接" : "Bridge 断开"}</span></div>
        <div className="title-actions"><button aria-label="搜索"><Search size={15} /></button><button aria-label="设置"><Settings2 size={15} /></button></div>
      </header>

      <section className="commandbar">
        <div className="mode-switch" aria-label="工作模式">
          {(["play", "inspect", "live-edit"] as WorkspaceMode[]).map((item) => (
            <button key={item} aria-pressed={mode === item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>
              {item === "play" ? <Play size={14} /> : item === "inspect" ? <Pause size={14} /> : <SlidersHorizontal size={14} />}
              {item === "play" ? "游玩" : item === "inspect" ? "检查" : "实时编辑"}
            </button>
          ))}
        </div>
        <button className="icon-command" aria-label="撤销" onClick={() => void historyAction("undo")}><Undo2 size={14} /></button>
        <button className="icon-command" aria-label="重做" onClick={() => void historyAction("redo")}><Redo2 size={14} /></button>
        <span className="separator" />
        <label>设备<select value={device.id} onChange={(event) => {
          const profile = DEFAULT_DEVICE_PROFILES.find((item) => item.id === event.target.value);
          if (profile) setDevice(profile);
        }}><option value="custom">自定义</option>{DEFAULT_DEVICE_PROFILES.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label>
        <label>宽<input type="number" min="100" max="4096" value={device.width} onChange={(event) => updateDevice({ width: Number(event.target.value) })} /></label>
        <label>高<input type="number" min="100" max="4096" value={device.height} onChange={(event) => updateDevice({ height: Number(event.target.value) })} /></label>
        <label>DPR<select value={device.dpr} onChange={(event) => updateDevice({ dpr: Number(event.target.value) })}>{[1, 1.5, 2, 3, 4].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="fps-control">FPS <input type="range" min="1" max="60" value={fps} onChange={(event) => setFps(Number(event.target.value))} /><output>{fps}</output></label>
        <button className="runtime-launch-button" disabled={!health?.capabilities.makerCli || runtimeBusy} onClick={() => void runtimeAction("start")}><CirclePlay size={14} />{runtimeBusy ? "处理中…" : "启动 Runtime"}</button>
        <button className="icon-command" aria-label="刷新 Runtime" disabled={runtimeBusy} onClick={() => void runtimeAction("refresh")}><RefreshCw size={14} /></button>
      </section>

      <section className="workspace">
        <aside className="left-pane panel">
          <nav className="pane-tabs" aria-label="资源导航">
            <button aria-pressed={leftTab === "files"} className={leftTab === "files" ? "active" : ""} onClick={() => setLeftTab("files")}><Files size={14} />文件</button>
            <button aria-pressed={leftTab === "hierarchy"} className={leftTab === "hierarchy" ? "active" : ""} onClick={() => setLeftTab("hierarchy")}><Layers3 size={14} />层级</button>
            <button aria-pressed={leftTab === "assets"} className={leftTab === "assets" ? "active" : ""} onClick={() => setLeftTab("assets")}><Image size={14} />资源</button>
          </nav>
          <div className="pane-body">
            {leftTab === "hierarchy" && snapshot && <HierarchyNode node={snapshot.root} selectedId={snapshot.selectedId} onSelect={selectNode} />}
            {leftTab === "files" && (files.length ? files.map((entry) => <button key={entry.path} className="file-row">{entry.kind === "directory" ? <Folder size={14} /> : <FileCode2 size={14} />}<span>{entry.name}</span></button>) : <p className="empty-state">启动时设置 TAPMAKERWORK_PROJECT 以加载项目文件。</p>)}
            {leftTab === "assets" && <div className="asset-grid"><button><Image size={22} /><span>Textures</span></button><button><Box size={22} /><span>Components</span></button></div>}
          </div>
        </aside>

        <section className="center-pane panel">
          <nav className="document-tabs">
            <button aria-pressed={centerTab === "visual"} className={centerTab === "visual" ? "active" : ""} onClick={() => setCenterTab("visual")}><MonitorPlay size={14} />HomePage.ui</button>
            <button aria-pressed={centerTab === "code"} className={centerTab === "code" ? "active" : ""} onClick={() => setCenterTab("code")}><Code2 size={14} />HomePage.lua</button>
          </nav>
          {centerTab === "visual" ? (
            <div className="canvas-area">
              <div className="canvas-meta"><span>{device.width} × {device.height}</span><span>DPR {device.dpr}</span><span>{fps} FPS</span><span>{mode}</span></div>
              <div ref={stageRef} className="device-stage" style={{ aspectRatio: `${device.width}/${device.height}` }}>
                <div className="safe-area" style={{
                  top: `${device.safeArea.top / device.height * 100}%`,
                  right: `${device.safeArea.right / device.width * 100}%`,
                  bottom: `${device.safeArea.bottom / device.height * 100}%`,
                  left: `${device.safeArea.left / device.width * 100}%`
                }} />
                <div className="runtime-surface" style={{
                  width: device.width,
                  height: device.height,
                  transform: `scale(${stageScale})`
                }}>
                  {snapshot && <RuntimeNode node={snapshot.root} selectedId={snapshot.selectedId} onSelect={selectNode} />}
                </div>
                {!health?.capabilities.runtimeFrames && <div className="simulation-ribbon">模拟帧 · 等待 Runtime Frame Provider</div>}
              </div>
            </div>
          ) : (
            <Editor
              theme="vs-dark"
              defaultLanguage="lua"
              value={code}
              options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13, padding: { top: 14 }, automaticLayout: true }}
            />
          )}
        </section>

        <aside className="right-pane panel">
          <nav className="pane-tabs"><button className="active"><SlidersHorizontal size={14} />属性</button><button><CirclePlay size={14} />事件</button><button><Sparkles size={14} />动画</button></nav>
          {selected ? <div className="inspector-body">
            <div className="selection-heading"><span className="selection-icon">{iconForType(selected.type)}</span><div><strong>{selected.name}</strong><small>{selected.type} · {selected.id}</small></div></div>
            <section className="property-group"><h3>布局</h3>
              <InspectorField label="宽度" property="width" value={selected.props.width} onCommit={patchNode} />
              <InspectorField label="高度" property="height" value={selected.props.height} onCommit={patchNode} />
              <InspectorField label="间距" property="gap" value={selected.props.gap} onCommit={patchNode} />
              <InspectorField label="Flex 方向" property="flexDirection" value={selected.props.flexDirection} onCommit={patchNode} />
            </section>
            <section className="property-group"><h3>外观</h3>
              <InspectorField label="文字" property="text" value={selected.props.text} onCommit={patchNode} />
              <InspectorField label="字号" property="fontSize" value={selected.props.fontSize} onCommit={patchNode} />
              <InspectorField label="背景 RGBA" property="backgroundColor" value={selected.props.backgroundColor} onCommit={patchNode} />
              <InspectorField label="圆角" property="borderRadius" value={selected.props.borderRadius} onCommit={patchNode} />
            </section>
            <section className="property-group"><h3>源码</h3><button className="source-link" onClick={() => setCenterTab("code")}><FileCode2 size={14} />{selected.source?.file ?? "运行时节点"}:{selected.source?.line ?? "?"}</button></section>
          </div> : <p className="empty-state">选择一个运行时节点。</p>}
        </aside>
      </section>

      <section className="terminal-panel panel">
        <nav className="terminal-tabs">
          <span className="terminal-title"><PanelBottom size={14} />终端</span>
          {channels.map((channel) => <button key={channel.id} aria-pressed={activeTerminal === channel.id} className={activeTerminal === channel.id ? "active" : ""} onClick={() => setActiveTerminal(channel.id)}>{channel.label}</button>)}
        </nav>
        <pre className={`terminal-output ${activeTerminal === "shell" ? "locked" : ""}`}>{logs[activeTerminal].join("\n")}</pre>
        {activeTerminal === "shell" && <div className="sandbox-warning"><ShieldAlert size={14} />项目外访问将由 OS 沙箱拒绝；当前实现未通过验证，因此命令入口保持关闭。</div>}
      </section>

      <footer className="statusbar">
        <span>{health?.capabilities.makerCli ? `Maker ${health.makerVersion}` : "Maker CLI 未发现"}</span>
        <span>{project?.makerBound ? "Maker 项目已绑定" : "模拟项目"}</span>
        <span>{snapshot ? `UI rev ${snapshot.revision}` : "UI 未连接"}</span>
        <span className="status-spacer" />
        <span>{health?.capabilities.shellSandbox ? "沙箱就绪" : "沙箱锁定"}</span>
        <span>{connected ? "本机连接" : "离线"}</span>
      </footer>
    </main>
  );
}
