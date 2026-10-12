import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyRuntimeProject,
  findRuntimeFileStatus,
  listRunningPreviewProjects,
  MAX_SNAPSHOT_PARTS,
  readLocalPreviewStatus,
  writeIdeCommandsFile
} from "./runtime-file-channel.js";

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

  function writeStatus(dir: string, status: Record<string, unknown>): void {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "runtime-status.json"), JSON.stringify(status), "utf8");
  }

  it("never falls back to a status that belongs to another project", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-channel-"));
    temporary.push(root);
    writeStatus(path.join(root, "a", "tapmakerwork"), { sessionId: "other", projectName: "别的游戏" });

    expect(findRuntimeFileStatus([root], { projectName: "台球大师", previewProjects: new Map() })).toBeUndefined();
  });

  it("does not treat a substring of the project name as a match", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-channel-"));
    temporary.push(root);
    writeStatus(path.join(root, "a", "tapmakerwork"), { sessionId: "pro", projectName: "台球大师Pro" });

    expect(findRuntimeFileStatus([root], { projectName: "台球大师", previewProjects: new Map() })).toBeUndefined();
  });

  it("falls back to an anonymous status when nothing identifies a project", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-channel-"));
    temporary.push(root);
    writeStatus(path.join(root, "a", "tapmakerwork"), { sessionId: "anonymous" });
    writeStatus(path.join(root, "b", "tapmakerwork"), { sessionId: "other", projectName: "别的游戏" });

    const status = findRuntimeFileStatus([root], { projectName: "台球大师", previewProjects: new Map() });
    expect(status?.sessionId).toBe("anonymous");
  });

  it("ignores a split snapshot that declares too many parts", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-channel-"));
    temporary.push(root);
    const dir = path.join(root, "a", "tapmakerwork");
    writeStatus(dir, { sessionId: "huge" });
    fs.writeFileSync(path.join(dir, "runtime-snapshot.json.meta.json"), JSON.stringify({ parts: MAX_SNAPSHOT_PARTS + 1 }), "utf8");

    const status = findRuntimeFileStatus([root], { previewProjects: new Map() });
    expect(status?.sessionId).toBe("huge");
    expect(status?.snapshot).toBeUndefined();
  });

  it("classifies HTTP runtime traffic by the reported project name", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-project-"));
    temporary.push(projectRoot);
    fs.mkdirSync(path.join(projectRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "scripts", "Config.lua"), 'Config.TITLE = "修仙之路"\n', "utf8");
    const options = { projectRoot, projectName: path.basename(projectRoot) };

    expect(classifyRuntimeProject("修仙之路", options)).toBe("match");
    expect(classifyRuntimeProject(path.basename(projectRoot), options)).toBe("match");
    expect(classifyRuntimeProject("另一个项目", options)).toBe("mismatch");
    expect(classifyRuntimeProject(undefined, options)).toBe("unknown");
    expect(classifyRuntimeProject("另一个项目", undefined)).toBe("unknown");
  });

  it("lists projects whose preview runtime is still alive", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-home-"));
    temporary.push(home);
    const previewDir = path.join(home, "preview");
    const writeSession = (hash: string, session: Record<string, unknown>) => {
      fs.mkdirSync(path.join(previewDir, hash), { recursive: true });
      fs.writeFileSync(path.join(previewDir, hash, "session.json"), JSON.stringify(session), "utf8");
    };
    writeSession("a".repeat(64), { project_realpath: "/p/a", state: "running", runtime_pid: 11 });
    writeSession("b".repeat(64), { project_realpath: "/p/b", state: "running", runtime_pid: 22 });
    writeSession("c".repeat(64), { project_realpath: "/p/c", state: "stopped", runtime_pid: 11 });
    writeSession("d".repeat(64), { project_realpath: "/p/d", state: "running", runtime_pid: 33 });

    const running = listRunningPreviewProjects((pid) => pid === 11 || pid === 22, [previewDir, previewDir]);
    expect(running.sort()).toEqual(["/p/a", "/p/b"]);
  });

  describe("readLocalPreviewStatus", () => {
    const setup = () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-proj-"));
      const homeA = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-home-a-"));
      const homeB = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-home-b-"));
      temporary.push(projectRoot, homeA, homeB);
      const hash = createHash("sha256").update(fs.realpathSync(projectRoot)).digest("hex");
      const roots = [path.join(homeA, "preview"), path.join(homeB, "preview")];
      const writeSession = (root: string, session: Record<string, unknown>) => {
        fs.mkdirSync(path.join(root, hash), { recursive: true });
        fs.writeFileSync(path.join(root, hash, "session.json"), JSON.stringify(session), "utf8");
      };
      return { projectRoot, roots, hash, writeSession };
    };
    const alive = (...pids: number[]) => (pid: number) => pids.includes(pid) ? "alive" as const : "missing" as const;

    it("reports stopped without a session", () => {
      const { projectRoot, roots } = setup();
      expect(readLocalPreviewStatus(projectRoot, alive(), roots)).toEqual({ state: "stopped", process_alive: false });
    });

    it("reports running when the runtime pid is alive and prefers the live account home", () => {
      const { projectRoot, roots, hash, writeSession } = setup();
      writeSession(roots[0], { state: "running", runtime_pid: 5, supervisor_pid: 6 });
      writeSession(roots[1], { state: "running", runtime_pid: 7, supervisor_pid: 8, session_id: "s1" });
      const status = readLocalPreviewStatus(projectRoot, alive(7), roots);
      expect(status).toMatchObject({ state: "running", process_alive: true, runtime_pid: 7, session_id: "s1" });
      expect(status.supervisor_log_path).toBe(path.join(roots[1], hash, "supervisor.log"));
    });

    it("keeps a starting state while only the supervisor is alive", () => {
      const { projectRoot, roots, writeSession } = setup();
      writeSession(roots[0], { state: "starting", runtime_pid: 0, supervisor_pid: 6 });
      expect(readLocalPreviewStatus(projectRoot, alive(6), roots)).toMatchObject({ state: "starting", process_alive: false });
    });

    it("treats a session whose processes are gone as stopped but keeps its log path", () => {
      const { projectRoot, roots, hash, writeSession } = setup();
      writeSession(roots[0], { state: "running", runtime_pid: 5, supervisor_pid: 6 });
      const status = readLocalPreviewStatus(projectRoot, alive(), roots);
      expect(status).toMatchObject({ state: "stopped", process_alive: false });
      expect(status.supervisor_log_path).toBe(path.join(roots[0], hash, "supervisor.log"));
    });

    it("reports unknown liveness as null", () => {
      const { projectRoot, roots, writeSession } = setup();
      writeSession(roots[0], { state: "running", runtime_pid: 5 });
      expect(readLocalPreviewStatus(projectRoot, () => "unknown", roots)).toMatchObject({ state: "running", process_alive: null });
    });
  });
});
