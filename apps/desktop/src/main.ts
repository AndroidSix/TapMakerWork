import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, shell, systemPreferences, WebContentsView } from "electron";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { runtimeViewportPoint, type RuntimeWindowBounds } from "./runtime-interaction.js";
import { selectRuntimeWindow } from "./runtime-window.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
// Electron 39+ enables macOS CoreAudio Tap for desktop capture by default.
// TapMakerWork only samples video thumbnails; opting out avoids making the
// window source list depend on an unrelated audio-capture Info.plist grant.
if (process.platform === "darwin") {
  app.commandLine.appendSwitch("disable-features", "MacCatapLoopbackAudioForScreenShare");
}
app.setName("TapMakerWork");

let mainWindow: BrowserWindow | null = null;
let previewView: WebContentsView | null = null;
const execFileAsync = promisify(execFile);

const runtimeWindowBoundsScript = `
ObjC.import("Foundation");
ObjC.import("CoreGraphics");
ObjC.import("AppKit");
ObjC.bindFunction("CGWindowListCopyWindowInfo", ["id", ["uint32", "uint32"]]);
function run(argv) {
  const windowId = Number(argv[0]);
  const windows = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo($.kCGWindowListOptionIncludingWindow, windowId));
  const target = windows.find((item) => Number(item.kCGWindowNumber) === windowId);
  if (!target || !target.kCGWindowBounds) return "";
  const running = $.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(target.kCGWindowOwnerPID));
  return JSON.stringify({
    pid: Number(target.kCGWindowOwnerPID),
    x: Number(target.kCGWindowBounds.X),
    y: Number(target.kCGWindowBounds.Y),
    width: Number(target.kCGWindowBounds.Width),
    height: Number(target.kCGWindowBounds.Height),
    executablePath: ObjC.unwrap(running.executableURL.path)
  });
}`;

const runtimeMouseEventScript = `
ObjC.import("CoreGraphics");
ObjC.bindFunction("CGPreflightPostEventAccess", ["bool", []]);
function run(argv) {
  if (!$.CGPreflightPostEventAccess()) throw new Error("runtime_input_accessibility_permission_required");
  const x = Number(argv[0]);
  const y = Number(argv[1]);
  const current = $.CGEventGetLocation($.CGEventCreate(null));
  delay(0.08);
  const point = $.CGPointMake(x, y);
  for (const kind of [$.kCGEventMouseMoved, $.kCGEventLeftMouseDown, $.kCGEventLeftMouseUp]) {
    const event = $.CGEventCreateMouseEvent(null, kind, point, $.kCGMouseButtonLeft);
    $.CGEventPost($.kCGHIDEventTap, event);
    delay(0.045);
  }
  const restore = $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, current, $.kCGMouseButtonLeft);
  $.CGEventPost($.kCGHIDEventTap, restore);
  return "ok";
}`;

async function resolveRuntimeWindowBounds(sourceId: string): Promise<RuntimeWindowBounds | undefined> {
  if (process.platform !== "darwin") return undefined;
  const windowId = Number(/^window:(\d+)/.exec(sourceId)?.[1]);
  if (!Number.isFinite(windowId) || windowId <= 0) return undefined;
  const { stdout } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", runtimeWindowBoundsScript, String(windowId)], { timeout: 2_000 });
  const parsed = JSON.parse(stdout.trim() || "null") as RuntimeWindowBounds | null;
  if (!parsed || ![parsed.pid, parsed.x, parsed.y, parsed.width, parsed.height].every(Number.isFinite) || parsed.width <= 0 || parsed.height <= 0) return undefined;
  return parsed;
}

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
      preload: path.join(directory, "preload.cjs"),
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

ipcMain.handle("tapmakerwork:runtime-capture", async (_event, opts?: {
  projectName?: string;
  sourceId?: string;
  orientation?: "portrait" | "landscape";
  viewportWidth?: number;
  viewportHeight?: number;
}) => {
  const permission = process.platform === "darwin" ? systemPreferences.getMediaAccessStatus("screen") : "granted";
  try {
    const portrait = opts?.orientation !== "landscape";
    const sources = await desktopCapturer.getSources({
      types: ["window"],
      thumbnailSize: portrait ? { width: 720, height: 1280 } : { width: 1280, height: 720 },
      fetchWindowIcons: false
    });
    const eligibleSources = sources.filter((source) => !/^TapMakerWork$/i.test(source.name));
    const candidates = eligibleSources
      .map((source) => ({ id: source.id, name: source.name }));
    const normalizedProjectName = opts?.projectName?.trim().toLocaleLowerCase() || "";
    const selected = opts?.sourceId
      ? eligibleSources.find((source) => source.id === opts.sourceId)
      : selectRuntimeWindow(eligibleSources, normalizedProjectName);
    // A bare project-name window is commonly the editor (Cursor/VS Code). Do
    // not present it as the game's final frame unless the user picks it.
    if (!selected) {
      return {
        ok: false,
        error: "runtime_window_not_found",
        permission,
        candidates
      };
    }
    if (selected.thumbnail.isEmpty()) {
      return {
        ok: false,
        error: permission === "granted" ? "runtime_frame_empty" : "screen_recording_permission_required",
        permission,
        candidates
      };
    }
    let frame = selected.thumbnail;
    const size = frame.getSize();
    const requestedWidth = Number(opts?.viewportWidth || 0);
    const requestedHeight = Number(opts?.viewportHeight || 0);
    const targetAspect = requestedWidth > 0 && requestedHeight > 0
      ? requestedWidth / requestedHeight
      : portrait ? 9 / 16 : 16 / 9;
    const rawAspect = size.width / Math.max(1, size.height);
    // Runtime window captures include native title chrome on macOS. Crop the largest
    // viewport-shaped rect, anchored to the bottom so the title bar is removed first.
    if (Number.isFinite(targetAspect) && targetAspect > 0 && Math.abs(rawAspect - targetAspect) > 0.003) {
      if (rawAspect > targetAspect) {
        const width = Math.max(1, Math.round(size.height * targetAspect));
        frame = frame.crop({ x: Math.max(0, Math.round((size.width - width) / 2)), y: 0, width, height: size.height });
      } else {
        const height = Math.max(1, Math.round(size.width / targetAspect));
        frame = frame.crop({ x: 0, y: Math.max(0, size.height - height), width: size.width, height });
      }
    }
    const frameSize = frame.getSize();
    return {
      ok: true,
      sourceId: selected.id,
      sourceName: selected.name,
      dataUrl: frame.toDataURL(),
      width: frameSize.width,
      height: frameSize.height,
      permission,
      candidates
    };
  } catch (error) {
    return {
      ok: false,
      error: permission === "granted"
        ? error instanceof Error ? error.message : String(error)
        : "screen_recording_permission_required",
      permission,
      candidates: []
    };
  }
});

ipcMain.handle("tapmakerwork:runtime-interact", async (_event, opts?: {
  sourceName?: string;
  sourceId?: string;
  normalizedX?: number;
  normalizedY?: number;
  viewportWidth?: number;
  viewportHeight?: number;
}) => {
  if (process.platform !== "darwin") return { ok: false, error: "runtime_input_platform_unsupported" };
  const sourceName = opts?.sourceName?.trim() || "";
  const sourceId = opts?.sourceId?.trim() || "";
  const viewportWidth = Number(opts?.viewportWidth || 0);
  const viewportHeight = Number(opts?.viewportHeight || 0);
  if (!sourceName || !sourceId || viewportWidth <= 0 || viewportHeight <= 0) return { ok: false, error: "runtime_input_target_required" };
  try {
    const bounds = await resolveRuntimeWindowBounds(sourceId);
    if (!bounds) return { ok: false, error: "runtime_input_window_not_found" };
    const point = runtimeViewportPoint(
      bounds,
      viewportWidth / viewportHeight,
      Number(opts?.normalizedX || 0),
      Number(opts?.normalizedY || 0)
    );
    if (!bounds.executablePath) return { ok: false, error: "runtime_input_executable_not_found" };
    // Runtime engines ignore background mouse events. Briefly make the native
    // game key, send a real click, then restore the editor immediately.
    await execFileAsync("/usr/bin/open", ["-a", bounds.executablePath], { timeout: 2_000 });
    await execFileAsync("/usr/bin/osascript", [
      "-l", "JavaScript", "-e", runtimeMouseEventScript,
      String(point.x), String(point.y)
    ], { timeout: 2_000 });
    app.focus({ steal: true });
    mainWindow?.show();
    mainWindow?.focus();
    return { ok: true };
  } catch (error) {
    app.focus({ steal: true });
    mainWindow?.show();
    mainWindow?.focus();
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
    {
      label: "编辑",
      submenu: [
        {
          label: "撤销",
          accelerator: "CmdOrCtrl+Z",
          registerAccelerator: false,
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send("tapmakerwork:history-action", "undo")
        },
        {
          label: "重做",
          accelerator: process.platform === "darwin" ? "CmdOrCtrl+Shift+Z" : "CmdOrCtrl+Y",
          registerAccelerator: false,
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send("tapmakerwork:history-action", "redo")
        },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
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
