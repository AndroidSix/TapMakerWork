import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("tapMakerWork", {
  platform: process.platform,
  desktop: true,
  chooseProject: () => ipcRenderer.invoke("tapmakerwork:choose-project") as Promise<string | undefined>,
  chooseDirectory: (opts?: { title?: string; defaultPath?: string }) =>
    ipcRenderer.invoke("tapmakerwork:choose-directory", opts) as Promise<string | undefined>,
  clipboard: {
    writeText: (text: string) => ipcRenderer.invoke("tapmakerwork:clipboard-write", text) as Promise<{ ok: boolean; error?: string }>
  },
  onOpenProject: (listener: (projectPath: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, projectPath: string) => listener(projectPath);
    ipcRenderer.on("tapmakerwork:open-project", handler);
    return () => ipcRenderer.removeListener("tapmakerwork:open-project", handler);
  },
  onCloseProject: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on("tapmakerwork:close-project", handler);
    return () => ipcRenderer.removeListener("tapmakerwork:close-project", handler);
  },
  onHistoryAction: (listener: (action: "undo" | "redo") => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: "undo" | "redo") => listener(action);
    ipcRenderer.on("tapmakerwork:history-action", handler);
    return () => ipcRenderer.removeListener("tapmakerwork:history-action", handler);
  },
  permissions: {
    get: () => ipcRenderer.invoke("tapmakerwork:permissions-get"),
    request: (permission: "screen" | "accessibility") => ipcRenderer.invoke("tapmakerwork:permissions-request", permission),
    open: (permission: "screen" | "accessibility") => ipcRenderer.invoke("tapmakerwork:permissions-open", permission),
    restart: () => ipcRenderer.invoke("tapmakerwork:app-restart"),
    onChanged: (listener: (state: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: unknown) => listener(state);
      ipcRenderer.on("tapmakerwork:permissions-changed", handler);
      return () => ipcRenderer.removeListener("tapmakerwork:permissions-changed", handler);
    }
  },
  updates: {
    get: () => ipcRenderer.invoke("tapmakerwork:update-get"),
    check: () => ipcRenderer.invoke("tapmakerwork:update-check"),
    download: () => ipcRenderer.invoke("tapmakerwork:update-download"),
    restart: () => ipcRenderer.invoke("tapmakerwork:update-restart"),
    onState: (listener: (state: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: unknown) => listener(state);
      ipcRenderer.on("tapmakerwork:update-state", handler);
      return () => ipcRenderer.removeListener("tapmakerwork:update-state", handler);
    }
  },
  hardwareAcceleration: {
    get: () => ipcRenderer.invoke("tapmakerwork:hardware-get"),
    set: (enabled: boolean) => ipcRenderer.invoke("tapmakerwork:hardware-set", enabled),
    restart: () => ipcRenderer.invoke("tapmakerwork:app-restart")
  },
  legal: {
    get: () => ipcRenderer.invoke("tapmakerwork:legal-get"),
    accept: () => ipcRenderer.invoke("tapmakerwork:legal-accept"),
    decline: () => ipcRenderer.invoke("tapmakerwork:legal-decline")
  },
  telemetry: {
    get: () => ipcRenderer.invoke("tapmakerwork:telemetry-get"),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke("tapmakerwork:telemetry-set-enabled", enabled),
    setEndpoint: (endpoint: string) => ipcRenderer.invoke("tapmakerwork:telemetry-set-endpoint", endpoint),
    track: (name: string, props?: Record<string, unknown>) => ipcRenderer.invoke("tapmakerwork:telemetry-track", name, props),
    flush: () => ipcRenderer.invoke("tapmakerwork:telemetry-flush")
  },
  captureRuntime: (opts?: { projectName?: string; sourceId?: string; orientation?: "portrait" | "landscape"; viewportWidth?: number; viewportHeight?: number }) =>
    ipcRenderer.invoke("tapmakerwork:runtime-capture", opts) as Promise<{
      ok: boolean;
      dataUrl?: string;
      sourceId?: string;
      sourceName?: string;
      width?: number;
      height?: number;
      permission?: string;
      error?: string;
      candidates?: Array<{ id: string; name: string }>;
    }>,
  preview: {
    mount: (opts: { url: string; x: number; y: number; width: number; height: number; orientation: string }) =>
      ipcRenderer.invoke("tapmakerwork:preview-mount", opts) as Promise<{ ok: boolean; error?: string }>,
    reload: () => ipcRenderer.invoke("tapmakerwork:preview-reload") as Promise<{ ok: boolean }>,
    unmount: () => ipcRenderer.invoke("tapmakerwork:preview-unmount") as Promise<{ ok: boolean }>,
    capture: () => ipcRenderer.invoke("tapmakerwork:preview-capture") as Promise<{ ok: boolean; dataUrl?: string; error?: string }>
  },
  runtime: {
    capture: (opts?: { projectName?: string; sourceId?: string; orientation?: "portrait" | "landscape"; viewportWidth?: number; viewportHeight?: number }) =>
      ipcRenderer.invoke("tapmakerwork:runtime-capture", opts) as Promise<{
        ok: boolean;
        dataUrl?: string;
        sourceId?: string;
        sourceName?: string;
        width?: number;
        height?: number;
        permission?: string;
        error?: string;
        candidates?: Array<{ id: string; name: string }>;
      }>,
    interact: (opts: { sourceName: string; sourceId: string; normalizedX: number; normalizedY: number; viewportWidth: number; viewportHeight: number }) =>
      ipcRenderer.invoke("tapmakerwork:runtime-interact", opts) as Promise<{ ok: boolean; error?: string }>
  }
});
