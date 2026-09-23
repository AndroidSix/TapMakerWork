import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { selectRuntimeWindow } from "./runtime-window.js";

export interface ListedWindow {
  hwnd: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pid: number;
  exe: string;
}

export interface WindowShot {
  png: Buffer;
  width: number;
  height: number;
  blank: boolean;
}

interface HelperMessage {
  ready?: boolean;
  ok?: boolean;
  error?: string;
  id?: number;
  windows?: unknown;
  png?: string;
  width?: number;
  height?: number;
  blank?: boolean;
  x?: number;
  y?: number;
}

// ponytail: PrintWindow, then a screen BitBlt when that frame is black.
// Fully covered DXGI windows stay black; switch to Windows.Graphics.Capture if that shows up.
const WINDOWS_RUNTIME_SCRIPT = String.raw`
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = [Console]::OutputEncoding
function Emit($payload) {
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $payload -Compress -Depth 6))
  [Console]::Out.Flush()
}
$code = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class TapMakerWin {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  public class WinInfo {
    public string hwnd { get; set; }
    public string title { get; set; }
    public int x { get; set; }
    public int y { get; set; }
    public int width { get; set; }
    public int height { get; set; }
    public int pid { get; set; }
    public string exe { get; set; }
  }
  public class Shot {
    public string png { get; set; }
    public int width { get; set; }
    public int height { get; set; }
    public bool blank { get; set; }
  }
  delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  static EnumProc enumProc;
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr hObject);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr hProcess, int dwFlags, StringBuilder lpExeName, ref int lpdwSize);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);

  static TapMakerWin() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
  }

  static bool Cloaked(IntPtr hwnd) {
    int value;
    if (DwmGetWindowAttribute(hwnd, 14, out value, 4) != 0) return false;
    return value != 0;
  }

  static string ExeBase(IntPtr hwnd) {
    uint pid;
    GetWindowThreadProcessId(hwnd, out pid);
    IntPtr proc = OpenProcess(0x1000, false, pid);
    if (proc == IntPtr.Zero) return "";
    StringBuilder sb = new StringBuilder(1024);
    int size = sb.Capacity;
    bool ok = QueryFullProcessImageName(proc, 0, sb, ref size);
    CloseHandle(proc);
    if (!ok) return "";
    return Path.GetFileName(sb.ToString());
  }

  public static WinInfo[] List() {
    List<WinInfo> found = new List<WinInfo>();
    enumProc = delegate(IntPtr hwnd, IntPtr lParam) {
      if (!IsWindowVisible(hwnd) || IsIconic(hwnd) || Cloaked(hwnd)) return true;
      StringBuilder sb = new StringBuilder(512);
      GetWindowText(hwnd, sb, sb.Capacity);
      string title = sb.ToString().Trim();
      if (title.Length == 0) return true;
      RECT rect;
      if (!GetWindowRect(hwnd, out rect)) return true;
      int w = rect.Right - rect.Left;
      int h = rect.Bottom - rect.Top;
      if (w < 80 || h < 80) return true;
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      WinInfo info = new WinInfo();
      info.hwnd = hwnd.ToInt64().ToString();
      info.title = title;
      info.x = rect.Left;
      info.y = rect.Top;
      info.width = w;
      info.height = h;
      info.pid = unchecked((int)pid);
      info.exe = ExeBase(hwnd);
      found.Add(info);
      return found.Count < 200;
    };
    EnumWindows(enumProc, IntPtr.Zero);
    return found.ToArray();
  }

  public static WinInfo Bounds(string hwndText) {
    IntPtr hwnd = new IntPtr(long.Parse(hwndText));
    RECT rect;
    if (!IsWindow(hwnd) || !GetWindowRect(hwnd, out rect)) return null;
    WinInfo info = new WinInfo();
    info.hwnd = hwndText;
    info.x = rect.Left;
    info.y = rect.Top;
    info.width = rect.Right - rect.Left;
    info.height = rect.Bottom - rect.Top;
    return info;
  }

  static bool IsBlank(Bitmap bmp) {
    int stepX = Math.Max(1, bmp.Width / 24);
    int stepY = Math.Max(1, bmp.Height / 24);
    for (int y = 0; y < bmp.Height; y += stepY) {
      for (int x = 0; x < bmp.Width; x += stepX) {
        Color color = bmp.GetPixel(x, y);
        if (color.R > 12 || color.G > 12 || color.B > 12) return false;
      }
    }
    return true;
  }

  static Bitmap Grab(IntPtr hwnd, RECT rect) {
    int w = rect.Right - rect.Left;
    int h = rect.Bottom - rect.Top;
    Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
    using (Graphics g = Graphics.FromImage(bmp)) {
      IntPtr hdc = g.GetHdc();
      PrintWindow(hwnd, hdc, 2);
      g.ReleaseHdc(hdc);
    }
    if (!IsBlank(bmp)) return bmp;
    bmp.Dispose();
    bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
    using (Graphics g = Graphics.FromImage(bmp)) {
      IntPtr hdc = g.GetHdc();
      PrintWindow(hwnd, hdc, 0);
      g.ReleaseHdc(hdc);
    }
    if (!IsBlank(bmp)) return bmp;
    bmp.Dispose();
    bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
    try {
      using (Graphics g = Graphics.FromImage(bmp)) {
        g.CopyFromScreen(rect.Left, rect.Top, 0, 0, new Size(w, h), CopyPixelOperation.SourceCopy);
      }
    } catch { }
    return bmp;
  }

  public static Shot Capture(string hwndText, int maxW, int maxH) {
    IntPtr hwnd = new IntPtr(long.Parse(hwndText));
    RECT rect;
    if (!IsWindow(hwnd) || !GetWindowRect(hwnd, out rect)) return null;
    int w = rect.Right - rect.Left;
    int h = rect.Bottom - rect.Top;
    if (w < 2 || h < 2 || w > 8000 || h > 8000) return null;
    Bitmap bmp = Grab(hwnd, rect);
    bool blank = IsBlank(bmp);
    Bitmap output = bmp;
    double scale = 1;
    if (maxW > 0 && maxH > 0) scale = Math.Min(1, Math.Min((double)maxW / w, (double)maxH / h));
    if (scale < 0.999) {
      int nw = Math.Max(1, (int)Math.Round(w * scale));
      int nh = Math.Max(1, (int)Math.Round(h * scale));
      output = new Bitmap(nw, nh);
      using (Graphics g = Graphics.FromImage(output)) {
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.DrawImage(bmp, 0, 0, nw, nh);
      }
      bmp.Dispose();
    }
    MemoryStream ms = new MemoryStream();
    output.Save(ms, ImageFormat.Png);
    Shot shot = new Shot();
    shot.png = Convert.ToBase64String(ms.ToArray());
    shot.width = output.Width;
    shot.height = output.Height;
    shot.blank = blank;
    output.Dispose();
    ms.Dispose();
    return shot;
  }

  static void ForceForeground(IntPtr hwnd) {
    IntPtr previous = GetForegroundWindow();
    uint ignored;
    uint foreThread = GetWindowThreadProcessId(previous, out ignored);
    uint targetThread = GetWindowThreadProcessId(hwnd, out ignored);
    uint current = GetCurrentThreadId();
    bool attachedFore = foreThread != 0 && AttachThreadInput(current, foreThread, true);
    bool attachedTarget = targetThread != 0 && AttachThreadInput(current, targetThread, true);
    if (IsIconic(hwnd)) ShowWindow(hwnd, 9);
    else ShowWindow(hwnd, 5);
    SetForegroundWindow(hwnd);
    BringWindowToTop(hwnd);
    if (attachedTarget) AttachThreadInput(current, targetThread, false);
    if (attachedFore) AttachThreadInput(current, foreThread, false);
  }

  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();

  public static string Click(string hwndText, int x, int y) {
    IntPtr hwnd = new IntPtr(long.Parse(hwndText));
    if (!IsWindow(hwnd)) return "missing";
    IntPtr previous = GetForegroundWindow();
    ForceForeground(hwnd);
    Thread.Sleep(60);
    POINT oldPos;
    GetCursorPos(out oldPos);
    SetCursorPos(x, y);
    Thread.Sleep(30);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
    Thread.Sleep(45);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
    Thread.Sleep(80);
    SetCursorPos(oldPos.X, oldPos.Y);
    if (previous != IntPtr.Zero) ForceForeground(previous);
    return "ok";
  }
}
'@
try {
  Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing -Language CSharp
  Emit @{ ready = $true }
} catch {
  Emit @{ ready = $false; error = $_.Exception.Message }
  exit 1
}
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim().Length -eq 0) { continue }
  $reqId = 0
  try {
    $req = $line | ConvertFrom-Json
    $reqId = $req.id
    switch ($req.op) {
      'list' { Emit @{ id = $reqId; ok = $true; windows = @([TapMakerWin]::List()) } }
      'bounds' {
        $info = [TapMakerWin]::Bounds([string]$req.hwnd)
        if ($null -eq $info) { throw 'runtime_input_window_not_found' }
        Emit @{ id = $reqId; ok = $true; hwnd = $info.hwnd; x = $info.x; y = $info.y; width = $info.width; height = $info.height }
      }
      'capture' {
        $shot = [TapMakerWin]::Capture([string]$req.hwnd, [int]$req.maxWidth, [int]$req.maxHeight)
        if ($null -eq $shot) { throw 'runtime_frame_empty' }
        Emit @{ id = $reqId; ok = $true; png = $shot.png; width = $shot.width; height = $shot.height; blank = [bool]$shot.blank }
      }
      'click' {
        $clicked = [TapMakerWin]::Click([string]$req.hwnd, [int]$req.x, [int]$req.y)
        if ($clicked -ne 'ok') { throw 'runtime_input_window_not_found' }
        Emit @{ id = $reqId; ok = $true }
      }
      default { throw 'windows_runtime_bad_op' }
    }
  } catch {
    Emit @{ id = $reqId; ok = $false; error = $_.Exception.Message }
  }
}
`;

function asArray(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeWindow(value: unknown): ListedWindow | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<ListedWindow>;
  const hwnd = String(record.hwnd ?? "");
  const width = Number(record.width);
  const height = Number(record.height);
  if (!/^\d{1,20}$/.test(hwnd) || !Number.isFinite(width) || !Number.isFinite(height)) return undefined;
  return {
    hwnd,
    title: String(record.title ?? ""),
    x: Number(record.x) || 0,
    y: Number(record.y) || 0,
    width,
    height,
    pid: Number(record.pid) || 0,
    exe: String(record.exe ?? "")
  };
}

export function parseWindowsSourceId(sourceId: string | undefined): string | undefined {
  const hwnd = /^win:(\d{1,20})$/.exec(sourceId ?? "")?.[1];
  return hwnd;
}

export function chooseWindowsRuntimeWindow(windows: ListedWindow[], projectName: string, sourceId = "", targetAspect?: number): ListedWindow | undefined {
  const eligible = windows.filter((item) => item.width >= 80 && item.height >= 80 && !/^TapMakerWork$/i.test(item.title));
  if (sourceId) {
    const hwnd = parseWindowsSourceId(sourceId) || (/^\d{1,20}$/.test(sourceId) ? sourceId : undefined);
    if (!hwnd) return undefined;
    return eligible.find((item) => item.hwnd === hwnd);
  }
  return selectRuntimeWindow(
    eligible.map((item) => ({ ...item, name: item.title, executable: item.exe })),
    projectName,
    targetAspect != null ? { targetAspect } : {}
  );
}

export class WindowsRuntime {
  private child: ChildProcess | undefined;
  private buffer = "";
  private stderr = "";
  private helperReady = false;
  private readyResolve: (() => void) | undefined;
  private readyReject: ((error: Error) => void) | undefined;
  private pending: { id: number; resolve: (message: HelperMessage) => void; reject: (error: Error) => void; timer: NodeJS.Timeout } | undefined;
  private queue: Promise<void> = Promise.resolve();
  private nextId = 1;

  close(): void {
    this.child?.kill();
    this.child = undefined;
    this.helperReady = false;
  }

  list(): Promise<ListedWindow[]> {
    return this.request({ op: "list" }).then((message) => asArray(message.windows).flatMap((item) => {
      const window = normalizeWindow(item);
      return window ? [window] : [];
    }));
  }

  bounds(hwnd: string): Promise<{ x: number; y: number; width: number; height: number; pid: number }> {
    return this.request({ op: "bounds", hwnd: assertHwnd(hwnd) }).then((message) => ({
      x: Number(message.x) || 0,
      y: Number(message.y) || 0,
      width: Number(message.width) || 0,
      height: Number(message.height) || 0,
      pid: 0
    }));
  }

  capture(hwnd: string, maxWidth: number, maxHeight: number): Promise<WindowShot> {
    return this.request({ op: "capture", hwnd: assertHwnd(hwnd), maxWidth, maxHeight }, 12_000).then((message) => {
      const png = Buffer.from(String(message.png ?? ""), "base64");
      return { png, width: Number(message.width) || 0, height: Number(message.height) || 0, blank: message.blank === true };
    });
  }

  click(hwnd: string, x: number, y: number): Promise<void> {
    return this.request({ op: "click", hwnd: assertHwnd(hwnd), x: Math.round(x), y: Math.round(y) }, 8_000).then(() => undefined);
  }

  private request(body: Record<string, unknown>, timeoutMs = 8_000): Promise<HelperMessage> {
    const id = this.nextId++;
    return this.enqueue(() => this.roundtrip({ ...body, id }, id, timeoutMs));
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async roundtrip(payload: Record<string, unknown>, id: number, timeoutMs: number): Promise<HelperMessage> {
    await this.ensureStarted();
    const stdin = this.child?.stdin;
    if (!stdin) throw new Error("windows_runtime_helper_unavailable");
    const message = await new Promise<HelperMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = undefined;
        this.close();
        reject(new Error(this.stderr.trim() || "windows_runtime_helper_timeout"));
      }, timeoutMs);
      this.pending = { id, resolve, reject, timer };
      stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending = undefined;
        reject(error);
      });
    });
    if (message.ok === false) throw new Error(message.error || "windows_runtime_helper_failed");
    return message;
  }

  private ensureStarted(): Promise<void> {
    if (this.child && this.helperReady) return Promise.resolve();
    if (process.platform !== "win32") return Promise.reject(new Error("windows_runtime_unavailable"));
    this.close();
    const executable = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const scriptFile = path.join(os.tmpdir(), "tapmakerwork-windows-runtime.ps1");
    fs.writeFileSync(scriptFile, WINDOWS_RUNTIME_SCRIPT, "utf8");
    const child = spawn(executable, [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptFile
    ], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    this.buffer = "";
    this.stderr = "";
    this.helperReady = false;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.onStdout(chunk));
    child.stderr?.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-4_000);
    });
    child.on("exit", () => {
      this.child = undefined;
      this.helperReady = false;
      this.failPending(new Error(this.stderr.trim() || "windows_runtime_helper_exited"));
      this.readyReject?.(new Error(this.stderr.trim() || "windows_runtime_helper_exited"));
      this.readyResolve = undefined;
      this.readyReject = undefined;
    });
    child.on("error", (error) => {
      this.readyReject?.(error);
      this.readyResolve = undefined;
      this.readyReject = undefined;
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.close();
        reject(new Error(this.stderr.trim() || "windows_runtime_helper_timeout"));
      }, 20_000);
      this.readyResolve = () => {
        clearTimeout(timer);
        resolve();
      };
      this.readyReject = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      if (this.helperReady) this.readyResolve();
    });
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 16_000_000) {
      this.buffer = "";
      this.close();
      return;
    }
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (line.trim()) this.onLine(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  private onLine(line: string): void {
    let message: HelperMessage;
    try {
      message = JSON.parse(line) as HelperMessage;
    } catch {
      return;
    }
    if (message.ready === true) {
      this.helperReady = true;
      this.readyResolve?.();
      this.readyResolve = undefined;
      this.readyReject = undefined;
      return;
    }
    if (message.ready === false) {
      this.readyReject?.(new Error(message.error || "windows_runtime_helper_failed"));
      this.readyResolve = undefined;
      this.readyReject = undefined;
      return;
    }
    if (!this.pending || message.id !== this.pending.id) return;
    clearTimeout(this.pending.timer);
    const pending = this.pending;
    this.pending = undefined;
    pending.resolve(message);
  }

  private failPending(error: Error): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    const pending = this.pending;
    this.pending = undefined;
    pending.reject(error);
  }
}

function assertHwnd(hwnd: string): string {
  if (!/^\d{1,20}$/.test(hwnd)) throw new Error("runtime_input_target_required");
  return hwnd;
}
