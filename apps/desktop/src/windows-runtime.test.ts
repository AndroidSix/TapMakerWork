import { describe, expect, it } from "vitest";
import { chooseWindowsRuntimeWindow, parseWindowsSourceId, WindowsRuntime, type ListedWindow } from "./windows-runtime.js";

const game: ListedWindow = {
  hwnd: "100",
  title: "乱世夺城",
  x: 10,
  y: 20,
  width: 400,
  height: 800,
  pid: 7,
  exe: "UrhoXRuntime.exe"
};

describe("Windows Runtime window choice", () => {
  it("parses only helper window ids", () => {
    expect(parseWindowsSourceId("win:42")).toBe("42");
    expect(parseWindowsSourceId("window:42:0")).toBeUndefined();
  });

  it("prefers the runtime executable over an editor with the same title", () => {
    const editor: ListedWindow = { ...game, hwnd: "200", exe: "Cursor.exe" };
    expect(chooseWindowsRuntimeWindow([editor, game], "乱世夺城")?.hwnd).toBe("100");
    expect(chooseWindowsRuntimeWindow([editor, game], "乱世夺城", "win:200")?.hwnd).toBe("200");
  });
});

describe("Windows Runtime helper", () => {
  it("lists a visible window and returns a PNG frame", async () => {
    if (process.platform !== "win32") return;
    const runtime = new WindowsRuntime();
    try {
      const windows = await runtime.list();
      expect(windows.length).toBeGreaterThan(0);
      const targets = windows.filter((item) => item.width >= 200 && item.height >= 200).slice(0, 6);
      expect(targets.length).toBeGreaterThan(0);
      let shot: Awaited<ReturnType<WindowsRuntime["capture"]>> | undefined;
      for (const target of targets) {
        const next = await runtime.capture(target.hwnd, 360, 640);
        if (!next.blank && next.png.length > 8) {
          shot = next;
          break;
        }
      }
      expect(shot).toBeTruthy();
      expect(shot!.png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      expect(shot!.width).toBeGreaterThan(0);
      expect(shot!.height).toBeGreaterThan(0);
    } finally {
      runtime.close();
    }
  }, 30_000);
});
