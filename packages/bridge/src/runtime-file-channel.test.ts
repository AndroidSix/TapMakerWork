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

  it("keeps the nested macOS savedata path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-channel-"));
    temporary.push(root);
    const dir = path.join(root, "preview", "session", "savedata", "tapmakerwork");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "runtime-status.json"), JSON.stringify({
      sessionId: "session-nested",
      revision: 1
    }), "utf8");

    const status = findRuntimeFileStatus([root]);
    expect(status?.sessionId).toBe("session-nested");
    const commandsPath = writeIdeCommandsFile(status!, []);
    expect(commandsPath && path.basename(commandsPath)).toBe("ide-commands.json");
  });
});
