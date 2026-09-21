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

  it("rejects a bare project-title window instead of presenting an editor as the game", () => {
    expect(scoreRuntimeWindow("乱世夺城", "乱世夺城")).toBeLessThan(70);
    expect(selectRuntimeWindow([{ id: "cursor", name: "乱世夺城" }], "乱世夺城")).toBeUndefined();
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
});
