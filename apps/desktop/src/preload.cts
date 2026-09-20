import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("tapMakerWork", {
  platform: process.platform,
  desktop: true,
  chooseProject: () => ipcRenderer.invoke("tapmakerwork:choose-project") as Promise<string | undefined>,
  onOpenProject: (listener: (projectPath: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, projectPath: string) => listener(projectPath);
    ipcRenderer.on("tapmakerwork:open-project", handler);
    return () => ipcRenderer.removeListener("tapmakerwork:open-project", handler);
  },
  onHistoryAction: (listener: (action: "undo" | "redo") => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: "undo" | "redo") => listener(action);
    ipcRenderer.on("tapmakerwork:history-action", handler);
    return () => ipcRenderer.removeListener("tapmakerwork:history-action", handler);
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
