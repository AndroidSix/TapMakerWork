import { app, BrowserWindow, dialog, ipcMain, Menu, shell, WebContentsView } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
app.setName("TapMakerWork");

let mainWindow: BrowserWindow | null = null;
let previewView: WebContentsView | null = null;

function ensurePreviewView(): { view: WebContentsView; window: BrowserWindow } | { error: string } {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getAllWindows()[0];
  if (!window) return { error: "window_unavailable" };
  if (!previewView) {
    previewView = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: "persist:tapmakerwork-preview"
      }
    });
    window.contentView.addChildView(previewView);
  }
  previewView.setVisible(false);
  return { view: previewView, window };
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#0d1017",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...(process.platform === "darwin" ? { trafficLightPosition: { x: 16, y: 18 } } : {}),
    webPreferences: {
      preload: path.join(directory, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = window;
  const studioUrl = new URL(process.env.TAPMAKERWORK_STUDIO_URL || "http://127.0.0.1:4173");
  studioUrl.searchParams.set("desktop", process.platform);
  void window.loadURL(studioUrl.toString());
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("http://127.0.0.1:4173")) event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.on("closed", () => {
    mainWindow = null;
    previewView = null;
  });
}

async function chooseProject(window: BrowserWindow): Promise<string | undefined> {
  const result = await dialog.showOpenDialog(window, {
    title: "打开 TapTap Maker 项目",
    buttonLabel: "打开项目",
    properties: ["openDirectory", "createDirectory"]
  });
  return result.canceled ? undefined : result.filePaths[0];
}

ipcMain.handle("tapmakerwork:choose-project", async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  return window ? chooseProject(window) : undefined;
});

ipcMain.handle("tapmakerwork:preview-mount", async (_event, opts: {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  orientation?: string;
}) => {
  const ensured = ensurePreviewView();
  if ("error" in ensured) return { ok: false, error: ensured.error };
  const { view } = ensured;
  if (!opts?.url) return { ok: false, error: "preview_url_required" };
  const width = Math.max(120, Math.round(opts.width));
  const height = Math.max(160, Math.round(opts.height));
  view.setBounds({ x: Math.round(opts.x), y: Math.round(opts.y), width, height });
  try {
    const current = view.webContents.getURL();
    if (current !== opts.url) await view.webContents.loadURL(opts.url);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  view.setVisible(true);
  return { ok: true };
});

ipcMain.handle("tapmakerwork:preview-reload", async () => {
  if (!previewView) return { ok: false };
  previewView.webContents.reload();
  return { ok: true };
});

ipcMain.handle("tapmakerwork:preview-unmount", async () => {
  if (previewView) previewView.setVisible(false);
  return { ok: true };
});

ipcMain.handle("tapmakerwork:preview-capture", async () => {
  if (!previewView || previewView.webContents.isDestroyed()) return { ok: false, error: "preview_not_mounted" };
  try {
    const image = await previewView.webContents.capturePage();
    return { ok: true, dataUrl: image.toDataURL() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

app.whenReady().then(() => {
  createWindow();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "文件",
      submenu: [{
        label: "打开项目…",
        accelerator: "CmdOrCtrl+O",
        click: async () => {
          const window = BrowserWindow.getFocusedWindow();
          if (!window) return;
          const projectPath = await chooseProject(window);
          if (projectPath) window.webContents.send("tapmakerwork:open-project", projectPath);
        }
      }]
    },
    { label: "编辑", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "窗口", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }] }
  ]));
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  previewView = null;
  mainWindow = null;
  if (process.platform !== "darwin") app.quit();
});
