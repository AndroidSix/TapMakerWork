import { describe, expect, it } from "vitest";
import { scoreRuntimeWindow, selectRuntimeWindow } from "./runtime-window.js";

describe("Maker Runtime window selection", () => {
  it("prefers the titled game Runtime over an editor window with the bare project name", () => {
    const selected = selectRuntimeWindow([
      { id: "cursor", name: "乱世夺城" },
      { id: "runtime", name: "乱世夺城：三国全境争霸" },
      { id: "ide", name: "TapMakerWork" }
    ], "乱世夺城");
    expect(selected?.id).toBe("runtime");
  });

  it("accepts a bare Maker preview title for the open project", () => {
    expect(scoreRuntimeWindow("台球大师", "台球大师")).toBeGreaterThanOrEqual(70);
    expect(selectRuntimeWindow([{ id: "game", name: "台球大师" }], "台球大师")?.id).toBe("game");
  });

  it("rejects Cursor / editor titles that merely contain the project name", () => {
    expect(scoreRuntimeWindow("App.tsx — 台球大师", "台球大师")).toBeLessThan(70);
    expect(scoreRuntimeWindow("main.lua - 台球大师", "台球大师")).toBeLessThan(70);
    const selected = selectRuntimeWindow([
      { id: "cursor", name: "DrawUtil.lua — 台球大师", width: 1440, height: 900 },
      { id: "game", name: "台球大师", width: 516, height: 918 }
    ], "台球大师", { targetAspect: 720 / 1280 });
    expect(selected?.id).toBe("game");
  });

  it("accepts known Maker and UrhoX Runtime titles", () => {
    expect(scoreRuntimeWindow("UrhoXRuntime", "demo")).toBeGreaterThanOrEqual(70);
    expect(scoreRuntimeWindow("Urho3D", "demo")).toBeGreaterThanOrEqual(70);
    expect(scoreRuntimeWindow("TapTap Maker Preview", "demo")).toBeGreaterThanOrEqual(70);
  });

  it("accepts a bare project title when the process is the Maker runtime", () => {
    expect(scoreRuntimeWindow("乱世夺城", "乱世夺城", "UrhoXRuntime.exe")).toBeGreaterThanOrEqual(70);
    expect(selectRuntimeWindow([
      { id: "editor", name: "乱世夺城", executable: "Cursor.exe" },
      { id: "game", name: "乱世夺城", executable: "UrhoXRuntime.exe" }
    ], "乱世夺城")?.id).toBe("game");
    expect(selectRuntimeWindow([{ id: "node", name: "乱世夺城", executable: "node.exe" }], "乱世夺城")?.id).toBe("node");
  });

  it("prefers the portrait game window when an IDE also includes the project name", () => {
    const selected = selectRuntimeWindow([
      { id: "ide", name: "台球大师 — Cursor", width: 1600, height: 1000 },
      { id: "game", name: "台球大师", width: 516, height: 918 }
    ], "台球大师", { targetAspect: 720 / 1280 });
    expect(selected?.id).toBe("game");
  });
});
