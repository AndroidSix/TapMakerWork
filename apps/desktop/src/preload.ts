import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("tapMakerWork", {
  platform: process.platform,
  desktop: true,
  chooseProject: () => ipcRenderer.invoke("tapmakerwork:choose-project") as Promise<string | undefined>,
  onOpenProject: (listener: (projectPath: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, projectPath: string) => listener(projectPath);
    ipcRenderer.on("tapmakerwork:open-project", handler);
    return () => ipcRenderer.removeListener("tapmakerwork:open-project", handler);
  }
});
