import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("tapMakerWork", {
  platform: process.platform,
  desktop: true,
  chooseProject: () => ipcRenderer.invoke("tapmakerwork:choose-project") as Promise<string | undefined>,
  chooseDirectory: (opts?: { title?: string; defaultPath?: string }) =>
    ipcRenderer.invoke("tapmakerwork:choose-directory", opts) as Promise<string | undefined>,
  bringToFront: () => ipcRenderer.invoke("tapmakerwork:bring-to-front") as Promise<{ ok: boolean }>,
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
  accounts: {
    report: (accounts: Array<{ id: string; label: string; global: boolean }>) => {
      ipcRenderer.send("tapmakerwork:accounts-report", accounts);
    },
    onSwitchGlobal: (listener: (accountId: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, accountId: string) => listener(accountId);
      ipcRenderer.on("tapmakerwork:switch-global-account", handler);
      return () => ipcRenderer.removeListener("tapmakerwork:switch-global-account", handler);
    },
    onManage: (listener: () => void) => {
      const handler = () => listener();
      ipcRenderer.on("tapmakerwork:manage-accounts", handler);
      return () => ipcRenderer.removeListener("tapmakerwork:manage-accounts", handler);
    }
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
    snooze: () => ipcRenderer.invoke("tapmakerwork:update-snooze"),
    mute: () => ipcRenderer.invoke("tapmakerwork:update-mute"),
    openSite: () => ipcRenderer.invoke("tapmakerwork:update-open-site"),
    onState: (listener: (state: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: unknown) => listener(state);
      ipcRenderer.on("tapmakerwork:update-state", handler);
      return () => ipcRenderer.removeListener("tapmakerwork:update-state", handler);
    },
    onPrompt: (listener: (state: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: unknown) => listener(state);
      ipcRenderer.on("tapmakerwork:update-prompt", handler);
      return () => ipcRenderer.removeListener("tapmakerwork:update-prompt", handler);
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
    onTrack: (listener: (name: string, props?: Record<string, unknown>) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, name: string, props?: Record<string, unknown>) => listener(name, props);
      ipcRenderer.on("tapmakerwork:telemetry-track", handler);
      return () => ipcRenderer.removeListener("tapmakerwork:telemetry-track", handler);
    },
    onSessionEnd: (listener: (payload: { session_ms: number; active_ms: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { session_ms: number; active_ms: number }) => listener(payload);
      ipcRenderer.on("tapmakerwork:telemetry-session-end", handler);
      return () => ipcRenderer.removeListener("tapmakerwork:telemetry-session-end", handler);
    }
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
  makerConsole: {
    mount: (opts: { accountId?: string; site?: "maker" | "developer"; x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke("tapmakerwork:maker-console-mount", opts) as Promise<{ ok: boolean; mode?: string; accountId?: string; site?: string; partition?: string; error?: string }>,
    unmount: () => ipcRenderer.invoke("tapmakerwork:maker-console-unmount") as Promise<{ ok: boolean; mode?: string; site?: string }>,
    reload: () => ipcRenderer.invoke("tapmakerwork:maker-console-reload") as Promise<{ ok: boolean; error?: string }>,
    setSite: (site: "maker" | "developer") =>
      ipcRenderer.invoke("tapmakerwork:maker-console-set-site", site) as Promise<{ ok: boolean; site?: string; mode?: string; error?: string }>,
    setAccount: (accountId: string, site?: "maker" | "developer") =>
      ipcRenderer.invoke("tapmakerwork:maker-console-set-account", accountId, site) as Promise<{ ok: boolean; accountId?: string; mode?: string; site?: string; partition?: string; error?: string }>,
    popOut: (opts?: { accountId?: string; site?: "maker" | "developer" }) =>
      ipcRenderer.invoke("tapmakerwork:maker-console-pop-out", opts) as Promise<{ ok: boolean; mode?: string; site?: string; error?: string }>,
    popIn: (opts: { accountId?: string; site?: "maker" | "developer"; x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke("tapmakerwork:maker-console-pop-in", opts) as Promise<{ ok: boolean; mode?: string; site?: string; error?: string }>,
    webLogin: (accountId?: string) =>
      ipcRenderer.invoke("tapmakerwork:maker-console-web-login", accountId) as Promise<{ loggedIn: boolean }>,
    openExternal: (site?: "maker" | "developer") => ipcRenderer.invoke("tapmakerwork:maker-console-open-external", site) as Promise<{ ok: boolean; site?: string }>,
    onMode: (listener: (state: { mode: string; accountId: string; site?: string; partition?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: { mode: string; accountId: string; site?: string; partition?: string }) => listener(state);
      ipcRenderer.on("tapmakerwork:maker-console-mode", handler);
      return () => ipcRenderer.removeListener("tapmakerwork:maker-console-mode", handler);
    },
    onPopoutClosed: (listener: () => void) => {
      const handler = () => listener();
      ipcRenderer.on("tapmakerwork:maker-console-popout-closed", handler);
      return () => ipcRenderer.removeListener("tapmakerwork:maker-console-popout-closed", handler);
    }
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
