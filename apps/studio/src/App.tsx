import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
  FolderOpen,
  GitBranch,
  Image,
  Layers3,
  MonitorPlay,
  PanelBottom,
  Pause,
  Play,
  RefreshCw,
  Save,
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
  snapshot?: UiSnapshot;
  activeUiEntry?: string;
}

type RecentProject = { root: string; name: string };

interface FileEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
}

interface UiScreenSummary {
  path: string;
  name: string;
  confidence?: "static" | "hybrid" | "runtime";
  nodeCount?: number;
  error?: string;
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

function labelForType(type: string): string {
  if (type === "Button") return "按钮";
  if (type === "Label") return "文字";
  if (type === "Panel") return "容器";
  return type;
}

function fileName(filePath: string): string {
  return filePath.split("/").at(-1) || filePath;
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

function concreteValue(value: UiValue | undefined): UiValue | undefined {
  if (value && typeof value === "object" && !Array.isArray(value) && "$expression" in value) return undefined;
  return value;
}

function dimension(value: UiValue | undefined): CSSProperties["width"] {
  if (typeof value === "number") return `${value}px`;
  if (typeof value === "string") return value;
  return undefined;
}

function edgeValue(value: UiValue | undefined): string | number | undefined {
  if (typeof value === "number" || typeof value === "string") return value;
  if (Array.isArray(value) && value.every((part) => typeof part === "number" || typeof part === "string")) return value.map((part) => typeof part === "number" ? `${part}px` : part).join(" ");
  if (value && typeof value === "object") {
    const record = value as Record<string, UiValue>;
    const top = record.top ?? 0;
    const right = record.right ?? 0;
    const bottom = record.bottom ?? 0;
    const left = record.left ?? 0;
    return [top, right, bottom, left].map((part) => typeof part === "number" ? `${part}px` : String(part)).join(" ");
  }
  return undefined;
}

function shadowValue(value: UiValue | undefined): string | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((shadow) => {
    if (!shadow || typeof shadow !== "object" || Array.isArray(shadow)) return "";
    const item = shadow as Record<string, UiValue>;
    return `${Number(item.x ?? 0)}px ${Number(item.y ?? 0)}px ${Number(item.blur ?? 0)}px ${rgba(item.color, "#000")}`;
  }).filter(Boolean).join(", ") || undefined;
}

function runtimeStyle(node: UiNode): CSSProperties {
  const props = node.props;
  const backgroundImage = concreteValue(props.backgroundImage);
  return {
    width: dimension(props.width),
    height: dimension(props.height),
    maxWidth: dimension(props.maxWidth),
    maxHeight: dimension(props.maxHeight),
    minWidth: dimension(props.minWidth),
    minHeight: dimension(props.minHeight),
    display: "flex",
    flexDirection: props.flexDirection === "row" ? "row" : "column",
    justifyContent: typeof props.justifyContent === "string" ? props.justifyContent as CSSProperties["justifyContent"] : undefined,
    alignItems: typeof props.alignItems === "string" ? props.alignItems as CSSProperties["alignItems"] : undefined,
    alignSelf: typeof props.alignSelf === "string" ? props.alignSelf as CSSProperties["alignSelf"] : undefined,
    gap: typeof props.gap === "number" ? props.gap : undefined,
    padding: edgeValue(props.padding),
    paddingLeft: typeof props.paddingLeft === "number" ? props.paddingLeft : typeof props.paddingHorizontal === "number" ? props.paddingHorizontal : undefined,
    paddingRight: typeof props.paddingRight === "number" ? props.paddingRight : typeof props.paddingHorizontal === "number" ? props.paddingHorizontal : undefined,
    paddingTop: typeof props.paddingTop === "number" ? props.paddingTop : undefined,
    paddingBottom: typeof props.paddingBottom === "number" ? props.paddingBottom : undefined,
    margin: edgeValue(props.margin),
    marginLeft: typeof props.marginLeft === "number" ? props.marginLeft : undefined,
    marginRight: typeof props.marginRight === "number" ? props.marginRight : undefined,
    marginTop: typeof props.marginTop === "number" ? props.marginTop : undefined,
    marginBottom: typeof props.marginBottom === "number" ? props.marginBottom : undefined,
    background: rgba(props.backgroundColor),
    backgroundImage: typeof backgroundImage === "string" ? `url("${API}/api/project/asset?path=${encodeURIComponent(backgroundImage)}")` : undefined,
    backgroundSize: props.backgroundFit === "cover" ? "cover" : props.backgroundFit === "contain" ? "contain" : undefined,
    backgroundPosition: "center",
    borderRadius: typeof props.borderRadius === "number" ? props.borderRadius : undefined,
    borderStyle: props.borderWidth != null ? "solid" : undefined,
    borderWidth: edgeValue(props.borderWidth),
    borderColor: rgba(props.borderColor),
    boxShadow: shadowValue(props.boxShadow),
    color: rgba(props.fontColor ?? props.textColor ?? props.color, "#e8edf5"),
    fontSize: typeof props.fontSize === "number" ? props.fontSize : undefined,
    fontWeight: props.fontWeight === "bold" ? 700 : undefined,
    textAlign: typeof props.textAlign === "string" ? props.textAlign as CSSProperties["textAlign"] : undefined,
    position: props.position === "absolute" ? "absolute" : "relative",
    left: typeof props.left === "number" ? props.left : undefined,
    top: typeof props.top === "number" ? props.top : undefined,
    right: typeof props.right === "number" ? props.right : undefined,
    bottom: typeof props.bottom === "number" ? props.bottom : undefined,
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
  if (node.props.visible === false || node.type === "Slot") return null;
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
      {node.type === "Label" && <span>{concreteValue(node.props.text) == null ? "" : displayValue(node.props.text, node.name)}</span>}
      {node.type === "Button" && <span>{concreteValue(node.props.text) == null ? "按钮" : displayValue(node.props.text, node.name)}</span>}
      {node.children.map((child) => <RuntimeNode key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} />)}
      {selectedId === node.id && <span className="node-badge">{labelForType(node.type)}</span>}
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

function FileTreeEntry({ entry, depth, selectedPath, onOpen }: {
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
  const [projectLoaded, setProjectLoaded] = useState(false);
  const [projectOpening, setProjectOpening] = useState(false);
  const [projectError, setProjectError] = useState("");
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("tapmakerwork.recentProjects") || "[]") as unknown;
      return Array.isArray(stored) ? stored.filter((item): item is RecentProject => Boolean(item && typeof item.root === "string" && typeof item.name === "string")) : [];
    }
    catch { return []; }
  });
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [screens, setScreens] = useState<UiScreenSummary[]>([]);
  const [activeUiPath, setActiveUiPath] = useState("scripts/ui/HomePage.lua");
  const [selectedFile, setSelectedFile] = useState("scripts/ui/HomePage.lua");
  const [snapshot, setSnapshot] = useState<UiSnapshot>();
  const [mode, setMode] = useState<WorkspaceMode>("inspect");
  const [device, setDevice] = useState<DeviceProfile>(DEFAULT_DEVICE_PROFILES[0]!);
  const [fps, setFps] = useState(60);
  const [activeTerminal, setActiveTerminal] = useState<LogChannel>("runtime");
  const [logs, setLogs] = useState(initialLogs);
  const [leftTab, setLeftTab] = useState<"files" | "screens" | "hierarchy" | "assets">("screens");
  const [centerTab, setCenterTab] = useState<"visual" | "code">("visual");
  const [inspectorTab, setInspectorTab] = useState<"properties" | "events" | "animation">("properties");
  const [code, setCode] = useState("-- 正在读取 scripts/ui/HomePage.lua…");
  const [codeDirty, setCodeDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageScale, setStageScale] = useState(1);
  const previewWidth = typeof snapshot?.root.props.$previewDesignWidth === "number" ? snapshot.root.props.$previewDesignWidth : device.width;
  const previewHeight = device.height / device.width * previewWidth;

  const readFile = useCallback(async (filePath: string, reveal = true) => {
    const response = await fetch(`${API}/api/project/file?path=${encodeURIComponent(filePath)}`);
    const result = await response.json() as { text?: string; error?: string };
    if (!response.ok || result.text == null) throw new Error(result.error || "无法读取文件");
    setSelectedFile(filePath);
    setCode(result.text);
    setCodeDirty(false);
    setSaveState("idle");
    if (reveal) setCenterTab("code");
  }, []);

  const loadProjectContents = useCallback(async () => {
    const [fileResponse, screenResponse] = await Promise.all([
      fetch(`${API}/api/project/files`),
      fetch(`${API}/api/ui/screens`)
    ]);
    const fileResult = await fileResponse.json() as { entries?: FileEntry[] };
    const screenResult = await screenResponse.json() as { screens?: UiScreenSummary[]; activePath?: string };
    const activePath = screenResult.activePath || screenResult.screens?.find((screen) => !screen.error)?.path || "scripts/ui/HomePage.lua";
    setFiles(fileResult.entries ?? []);
    setScreens(screenResult.screens ?? []);
    setActiveUiPath(activePath);
    await readFile(activePath, false).catch(() => undefined);
  }, [readFile]);

  const saveFile = useCallback(async () => {
    if (!selectedFile || !codeDirty) return;
    setSaveState("saving");
    try {
      const response = await fetch(`${API}/api/project/file`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: selectedFile, text: code })
      });
      const result = await response.json() as { error?: string; snapshot?: UiSnapshot };
      if (!response.ok) throw new Error(result.error || "保存失败");
      if (result.snapshot) setSnapshot(result.snapshot);
      setCodeDirty(false);
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1_500);
      const screenResponse = await fetch(`${API}/api/ui/screens`);
      const screenResult = await screenResponse.json() as { screens?: UiScreenSummary[] };
      setScreens(screenResult.screens ?? []);
    } catch (error) {
      setSaveState("error");
      setLogs((current) => ({ ...current, agent: [...current.agent, `保存失败：${error instanceof Error ? error.message : String(error)}`] }));
    }
  }, [code, codeDirty, selectedFile]);

  const openUiScreen = useCallback(async (screenPath: string) => {
    const response = await fetch(`${API}/api/ui/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: screenPath })
    });
    const result = await response.json() as { snapshot?: UiSnapshot; error?: string };
    if (!response.ok || !result.snapshot) {
      setLogs((current) => ({ ...current, agent: [...current.agent, `界面无法预览：${result.error ?? "转换失败"}`] }));
      await readFile(screenPath);
      return;
    }
    setSnapshot(result.snapshot);
    setActiveUiPath(screenPath);
    await readFile(screenPath, false);
    setCenterTab("visual");
  }, [readFile]);

  const openProjectPath = useCallback(async (projectPath: string) => {
    setProjectOpening(true);
    setProjectError("");
    try {
      const response = await fetch(`${API}/api/project/open`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: projectPath })
      });
      const result = await response.json() as ProjectState & { error?: string };
      if (!response.ok || !result.project) throw new Error(result.error || "无法打开项目");
      setProject(result.project);
      if (result.snapshot) setSnapshot(result.snapshot);
      await loadProjectContents();
      setRecentProjects((current) => {
        const next = [{ root: result.project!.root, name: result.project!.name }, ...current.filter((item) => item.root !== result.project!.root)].slice(0, 8);
        localStorage.setItem("tapmakerwork.recentProjects", JSON.stringify(next));
        return next;
      });
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectLoaded(true);
      setProjectOpening(false);
    }
  }, [loadProjectContents]);

  const chooseProject = useCallback(async () => {
    if (window.tapMakerWork?.chooseProject) {
      const projectPath = await window.tapMakerWork.chooseProject();
      if (projectPath) await openProjectPath(projectPath);
      return;
    }
    setProjectError("请使用桌面版的“文件 → 打开项目…”选择项目目录。");
  }, [openProjectPath]);

  useEffect(() => {
    void fetch(`${API}/api/health`).then((response) => response.json()).then(setHealth).catch(() => undefined);
    void fetch(`${API}/api/project`).then((response) => response.json()).then(async (value: ProjectState) => {
      setProject(value.project);
      if (value.project) await loadProjectContents();
      setProjectLoaded(true);
    }).catch(() => {
      setProjectLoaded(true);
      setProjectError("本地 Bridge 未启动，请先启动 TapMakerWork 服务。");
    });
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
  }, [loadProjectContents]);

  useEffect(() => window.tapMakerWork?.onOpenProject?.((projectPath) => { void openProjectPath(projectPath); }), [openProjectPath]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const updateScale = () => setStageScale(Math.min(stage.clientWidth / previewWidth, stage.clientHeight / previewHeight));
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [previewHeight, previewWidth]);

  const selected = useMemo(() => snapshot?.selectedId ? findUiNode(snapshot.root, snapshot.selectedId) : undefined, [snapshot]);
  const selectedEvents = useMemo(() => selected ? Object.entries(selected.props).filter(([key]) => /^on[A-Z]/.test(key)) : [], [selected]);
  const selectedAnimations = useMemo(() => selected ? Object.entries(selected.props).filter(([key]) => /animation|transition|duration|easing|opacity|transform/i.test(key)) : [], [selected]);

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
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveFile();
        return;
      }
      if ((event.target as HTMLElement | null)?.closest(".monaco-editor")) return;
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
  }, [saveFile]);

  const updateDevice = (changes: Partial<DeviceProfile>) => setDevice((current) => ({ ...current, ...changes, id: changes.id ?? "custom", label: changes.label ?? "自定义" }));
  const openShortcut = window.tapMakerWork?.platform === "darwin" ? "⌘ O" : "Ctrl O";

  if (!projectLoaded || !project) {
    return (
      <main className="welcome-window">
        <header className="titlebar welcome-titlebar">
          <div className="brand"><span className="brand-mark">T</span><strong>TapMakerWork</strong></div>
          <span className="welcome-window-title">{projectLoaded ? "开始" : "正在连接…"}</span>
        </header>
        <section className="welcome-main">
          <div className="welcome-hero" aria-busy={projectOpening}>
            <div className="welcome-logo"><span className="brand-mark large">T</span><div><h1>TapMakerWork</h1><p>TapTap Maker 可视化工作台</p></div></div>
            <button className="open-project-card" onClick={() => void chooseProject()} disabled={!projectLoaded || projectOpening}>
              <span className="open-project-icon"><FolderOpen size={24} aria-hidden="true" /></span>
              <span><strong>{projectOpening ? "正在打开…" : "打开项目"}</strong><small>选择一个本地 Maker 项目文件夹</small></span>
              <kbd>{openShortcut}</kbd>
            </button>
            {projectError && <p className="welcome-error" role="alert">{projectError}</p>}
            {recentProjects.length > 0 && <div className="recent-projects">
              <div className="recent-heading"><span>最近项目</span><small>{recentProjects.length} 个</small></div>
              {recentProjects.map((item) => <button key={item.root} onClick={() => void openProjectPath(item.root)} disabled={projectOpening}>
                <Folder size={17} aria-hidden="true" /><span><strong>{item.name}</strong><small>{item.root}</small></span><ChevronRight size={16} aria-hidden="true" />
              </button>)}
            </div>}
          </div>
          <div className="welcome-decoration" aria-hidden="true"><div /><div /><div /></div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="titlebar">
        <div className="brand"><span className="brand-mark">T</span><strong>TapMakerWork</strong><span className="phase-badge">M0</span></div>
        <button className="project-chip" onClick={() => void chooseProject()} title="打开其他项目"><Folder size={14} aria-hidden="true" /><span>{project.name}</span><GitBranch size={13} aria-hidden="true" /><small>main</small><ChevronDown size={12} aria-hidden="true" /></button>
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
            <button aria-pressed={leftTab === "screens"} className={leftTab === "screens" ? "active" : ""} onClick={() => setLeftTab("screens")}><MonitorPlay size={14} />界面</button>
            <button aria-pressed={leftTab === "hierarchy"} className={leftTab === "hierarchy" ? "active" : ""} onClick={() => setLeftTab("hierarchy")}><Layers3 size={14} />层级</button>
            <button aria-pressed={leftTab === "assets"} className={leftTab === "assets" ? "active" : ""} onClick={() => setLeftTab("assets")}><Image size={14} />资源</button>
          </nav>
          <div className="pane-body">
            {leftTab === "hierarchy" && snapshot && <HierarchyNode node={snapshot.root} selectedId={snapshot.selectedId} onSelect={selectNode} />}
            {leftTab === "files" && (files.length ? files.map((entry) => <FileTreeEntry key={entry.path} entry={entry} depth={0} selectedPath={selectedFile} onOpen={(path) => void readFile(path)} />) : <p className="empty-state">项目目录为空。点击顶部项目名称可重新选择目录。</p>)}
            {leftTab === "screens" && <div className="screen-list">
              <div className="screen-list-heading"><span>检测到 {screens.length} 个 UI 文件</span><button onClick={() => void loadProjectContents()} aria-label="重新扫描界面"><RefreshCw size={13} /></button></div>
              {screens.map((screen) => <button key={screen.path} className={`screen-row ${activeUiPath === screen.path ? "active" : ""}`} onClick={() => void openUiScreen(screen.path)}>
                <MonitorPlay size={15} /><span><strong>{screen.name}</strong><small>{screen.error ? "仅代码 · 无法静态预览" : `${screen.nodeCount ?? 0} 个节点 · ${screen.confidence === "static" ? "完整" : "混合"}`}</small></span>{activeUiPath === screen.path && <span className="active-dot" />}
              </button>)}
            </div>}
            {leftTab === "assets" && <div className="asset-grid"><button><Image size={22} /><span>Textures</span></button><button><Box size={22} /><span>Components</span></button></div>}
          </div>
        </aside>

        <section className="center-pane panel">
          <nav className="document-tabs">
            <button aria-pressed={centerTab === "visual"} className={centerTab === "visual" ? "active" : ""} onClick={() => setCenterTab("visual")}><MonitorPlay size={14} />{fileName(activeUiPath).replace(/\.lua$/i, ".ui")}</button>
            <button aria-pressed={centerTab === "code"} className={centerTab === "code" ? "active" : ""} onClick={() => setCenterTab("code")}><Code2 size={14} />{fileName(selectedFile)}{codeDirty && <span className="dirty-dot" aria-label="有未保存更改">●</span>}</button>
            <button className="document-save" onClick={() => void saveFile()} disabled={!codeDirty || saveState === "saving"} title="保存 (⌘/Ctrl S)"><Save size={14} />{saveState === "saving" ? "保存中" : saveState === "saved" ? "已保存" : saveState === "error" ? "失败" : "保存"}</button>
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
                  width: previewWidth,
                  height: previewHeight,
                  transform: `scale(${stageScale})`
                }}>
                  {snapshot && <RuntimeNode node={snapshot.root} selectedId={snapshot.selectedId} onSelect={selectNode} />}
                </div>
              </div>
              {!health?.capabilities.runtimeFrames && <div className="simulation-ribbon">设计预览 · Runtime 连接后自动同步</div>}
            </div>
          ) : (
            <Editor
              theme="vs-dark"
              language={selectedFile.endsWith(".lua") ? "lua" : selectedFile.endsWith(".json") ? "json" : selectedFile.endsWith(".ts") || selectedFile.endsWith(".tsx") ? "typescript" : "plaintext"}
              value={code}
              onChange={(value) => { setCode(value ?? ""); setCodeDirty(true); setSaveState("idle"); }}
              options={{ readOnly: false, minimap: { enabled: false }, fontSize: 13, padding: { top: 14 }, automaticLayout: true }}
            />
          )}
        </section>

        <aside className="right-pane panel">
          <nav className="pane-tabs">
            <button aria-pressed={inspectorTab === "properties"} className={inspectorTab === "properties" ? "active" : ""} onClick={() => setInspectorTab("properties")}><SlidersHorizontal size={14} />属性</button>
            <button aria-pressed={inspectorTab === "events"} className={inspectorTab === "events" ? "active" : ""} onClick={() => setInspectorTab("events")}><CirclePlay size={14} />事件</button>
            <button aria-pressed={inspectorTab === "animation"} className={inspectorTab === "animation" ? "active" : ""} onClick={() => setInspectorTab("animation")}><Sparkles size={14} />动画</button>
          </nav>
          {selected ? <div className="inspector-body">
            <div className="selection-heading"><span className="selection-icon">{iconForType(selected.type)}</span><div><strong>{selected.name}</strong><small>{selected.type} · {selected.id}</small></div></div>
            {inspectorTab === "properties" && <><section className="property-group"><h3>布局</h3>
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
            <section className="property-group"><h3>源码</h3><button className="source-link" onClick={() => selected.source?.file ? void readFile(selected.source.file) : setCenterTab("code")}><FileCode2 size={14} />{selected.source?.file ?? "运行时节点"}:{selected.source?.line ?? "?"}</button></section></>}
            {inspectorTab === "events" && <section className="inspector-section">
              <div className="inspector-section-title"><div><h3>交互事件</h3><p>从当前节点的 Lua 构造参数中提取</p></div><span>{selectedEvents.length}</span></div>
              {selectedEvents.length ? selectedEvents.map(([key, value]) => <div className="binding-card" key={key}><div><CirclePlay size={14} /><strong>{key}</strong></div><code>{displayValue(value)}</code></div>) : <div className="inspector-empty"><CirclePlay size={22} /><strong>该节点没有事件</strong><span>在 Lua 中添加 onClick、onChange 等处理器后会自动显示。</span></div>}
              <button className="inspector-code-button" onClick={() => selected.source?.file && void readFile(selected.source.file)}><FileCode2 size={14} />在源码中编辑事件</button>
            </section>}
            {inspectorTab === "animation" && <section className="inspector-section">
              <div className="inspector-section-title"><div><h3>动画与过渡</h3><p>展示节点声明的动画属性</p></div><span>{selectedAnimations.length}</span></div>
              {selectedAnimations.length ? selectedAnimations.map(([key, value]) => <div className="binding-card" key={key}><div><Sparkles size={14} /><strong>{key}</strong></div><code>{displayValue(value)}</code></div>) : <div className="inspector-empty"><Sparkles size={22} /><strong>尚未声明动画</strong><span>可在 Lua 节点上添加 transition、duration、easing 或 animation 属性。</span></div>}
              <button className="inspector-code-button" onClick={() => selected.source?.file && void readFile(selected.source.file)}><FileCode2 size={14} />在源码中编辑动画</button>
            </section>}
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
