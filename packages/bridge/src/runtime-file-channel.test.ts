import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findRuntimeFileStatus, writeIdeCommandsFile } from "./runtime-file-channel.js";

const temporary: string[] = [];

afterEach(() => {
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("runtime file channel", () => {
  it("reads a flat Windows savedata status and writes the matching command file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-channel-"));
    temporary.push(root);
    const savedata = path.join(root, "maker-cache-test", "127.0.0.1_1", "hash", "savedata", "0");
    fs.mkdirSync(savedata, { recursive: true });
    fs.writeFileSync(path.join(savedata, "tapmakerwork-runtime-status.json"), JSON.stringify({
      kind: "tapmakerwork.runtime.status",
      sessionId: "session-flat",
      cursor: 2,
      revision: 4
    }), "utf8");
    fs.writeFileSync(path.join(savedata, "tapmakerwork-runtime-snapshot.json"), JSON.stringify({
      revision: 4,
      root: { id: "screen", type: "Panel", children: [] }
    }), "utf8");

    const status = findRuntimeFileStatus([root]);
    expect(status?.sessionId).toBe("session-flat");
    expect(status?.snapshot).toMatchObject({ root: { id: "screen" } });

    const commandsPath = writeIdeCommandsFile(status!, [{ id: 3, type: "ui.patch" }]);
    expect(commandsPath && path.basename(commandsPath)).toBe("tapmakerwork-ide-commands.json");
    expect(fs.existsSync(commandsPath!)).toBe(true);
  });

  it("prefers the status that matches the open project name", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-channel-"));
    temporary.push(root);
    const other = path.join(root, "preview", "other", "savedata", "tapmakerwork");
    const mine = path.join(root, "preview", "mine", "savedata", "tapmakerwork");
    fs.mkdirSync(other, { recursive: true });
    fs.mkdirSync(mine, { recursive: true });
    fs.writeFileSync(path.join(other, "runtime-status.json"), JSON.stringify({
      sessionId: "other-session",
      revision: 9,
      projectName: "台球大师",
      updatedAt: Date.now()
    }), "utf8");
    // newer mtime on "other"
    const now = Date.now() / 1000 + 10;
    fs.utimesSync(path.join(other, "runtime-status.json"), now, now);
    fs.writeFileSync(path.join(mine, "runtime-status.json"), JSON.stringify({
      sessionId: "zombie-session",
      revision: 2,
      projectName: "丧尸来袭：最后的防线"
    }), "utf8");
    fs.writeFileSync(path.join(mine, "runtime-snapshot.json"), JSON.stringify({
      revision: 2,
      root: { id: "z", type: "NanoVG", children: [] }
    }), "utf8");

    const status = findRuntimeFileStatus([root], { projectName: "丧尸来袭：最后的防线" });
    expect(status?.sessionId).toBe("zombie-session");
  });

  it("matches NanoVG status without projectName via preview session realpath", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-channel-"));
    temporary.push(root);
    const projectReal = path.join(root, "games", "台球大师");
    const previewDir = path.join(root, "preview-hash");
    const savedata = path.join(previewDir, "savedata", "tapmakerwork");
    fs.mkdirSync(projectReal, { recursive: true });
    fs.mkdirSync(savedata, { recursive: true });
    fs.writeFileSync(path.join(savedata, "runtime-status.json"), JSON.stringify({
      sessionId: "billiard-session",
      revision: 3,
      backend: "nanovg",
      updatedAt: Date.now()
    }), "utf8");
    fs.writeFileSync(path.join(savedata, "runtime-snapshot.json"), JSON.stringify({
      revision: 3,
      root: { id: "nanovg-root", type: "NanoVG", children: [] }
    }), "utf8");
    // Newer unrelated status without matching hints.
    const other = path.join(root, "other", "tapmakerwork");
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, "runtime-status.json"), JSON.stringify({
      sessionId: "other-session",
      revision: 9,
      projectName: "别的游戏",
      updatedAt: Date.now() + 10_000
    }), "utf8");
    const now = Date.now() / 1000 + 20;
    fs.utimesSync(path.join(other, "runtime-status.json"), now, now);

    const status = findRuntimeFileStatus([root], {
      projectRoot: projectReal,
      projectName: "台球大师",
      previewProjects: new Map([[previewDir, projectReal]])
    });
    expect(status?.sessionId).toBe("billiard-session");
  });
});
