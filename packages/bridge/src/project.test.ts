import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  candidateProjectSourcePaths,
  isTapMakerProject,
  readProjectSource,
  readProjectText,
  resolveInsideProject,
  resolveProjectRoot,
  resolveProjectSourcePath,
  writeProjectText
} from "./project.js";

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function tapProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-project-"));
  temporary.push(root);
  fs.mkdirSync(path.join(root, ".project"));
  fs.writeFileSync(path.join(root, ".project", "project.json"), JSON.stringify({ project_id: "m_test", entry: "main.lua" }));
  return root;
}

describe("project boundary", () => {
  it("resolves real project roots", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-project-"));
    temporary.push(root);
    fs.mkdirSync(path.join(root, ".maker-mcp"));
    fs.writeFileSync(path.join(root, ".maker-mcp", "config.json"), "{}");
    fs.mkdirSync(path.join(root, ".project"));
    fs.writeFileSync(path.join(root, ".project", "project.json"), JSON.stringify({ project_id: "m_test", entry: "main.lua" }));
    expect(resolveProjectRoot(root)).toMatchObject({ root: fs.realpathSync(root), makerBound: true });
  });

  it("rejects ordinary folders that are not TapMaker projects", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-project-"));
    temporary.push(root);
    fs.writeFileSync(path.join(root, "package.json"), "{}");
    expect(isTapMakerProject(root)).toBe(false);
    expect(() => resolveProjectRoot(root)).toThrow("not_tapmaker_project");
  });

  it("rejects paths outside the project", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-project-"));
    temporary.push(root);
    expect(() => resolveInsideProject(root, "../secret.txt")).toThrow("path_outside_project");
  });

  it("rejects symlinks that escape the project", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-project-"));
    temporary.push(root);
    fs.symlinkSync(os.tmpdir(), path.join(root, "outside"));
    expect(() => readProjectText(root, "outside/nonexistent.txt")).toThrow("path_outside_project");
  });

  it("writes existing project files and creates missing sidecars inside the project", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-project-"));
    temporary.push(root);
    fs.writeFileSync(path.join(root, "screen.lua"), "return 1");
    writeProjectText(root, "screen.lua", "return 2");
    expect(readProjectText(root, "screen.lua")).toBe("return 2");
    writeProjectText(root, "scripts/ui/screen.ui.json", "{\"formatVersion\":1}");
    expect(readProjectText(root, "scripts/ui/screen.ui.json")).toBe("{\"formatVersion\":1}");
  });

  it("keeps an existing UTF-8 BOM when the editor saves text without it", () => {
    const root = tapProject();
    fs.writeFileSync(path.join(root, "main.lua"), Buffer.from("\uFEFFreturn 1", "utf8"));
    writeProjectText(root, "main.lua", "return 2");
    expect(fs.readFileSync(path.join(root, "main.lua")).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(readProjectText(root, "main.lua")).toBe("\uFEFFreturn 2");
  });

  it("refuses to overwrite a file that is not valid UTF-8", () => {
    const root = tapProject();
    const gbk = Buffer.from([0x2d, 0x2d, 0x20, 0xd6, 0xd0, 0xce, 0xc4]);
    fs.writeFileSync(path.join(root, "gbk.lua"), gbk);
    expect(readProjectSource(root, "gbk.lua").utf8).toBe(false);
    expect(() => writeProjectText(root, "gbk.lua", "-- 中文")).toThrow("project_file_not_utf8");
    expect(fs.readFileSync(path.join(root, "gbk.lua"))).toEqual(gbk);
  });

  it("rejects a save whose base version no longer matches the file on disk", () => {
    const root = tapProject();
    fs.writeFileSync(path.join(root, "main.lua"), "return 1");
    const opened = readProjectSource(root, "main.lua");
    fs.writeFileSync(path.join(root, "main.lua"), "return 'changed by agent'");
    expect(() => writeProjectText(root, "main.lua", "return 2", undefined, { baseVersion: opened.version })).toThrow("project_file_changed_externally");
    const reopened = readProjectSource(root, "main.lua");
    writeProjectText(root, "main.lua", "return 3", undefined, { baseVersion: reopened.version });
    expect(readProjectText(root, "main.lua")).toBe("return 3");
  });

  it("resolves NanoVG require-style chunk names to scripts/*.lua", () => {
    const root = tapProject();
    fs.mkdirSync(path.join(root, "scripts", "pool", "ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts", "pool", "ui", "DrawUtil.lua"), "-- draw\n");
    expect(candidateProjectSourcePaths("pool/ui/DrawUtil")).toContain("scripts/pool/ui/DrawUtil.lua");
    expect(resolveProjectSourcePath(root, "pool/ui/DrawUtil")).toBe("scripts/pool/ui/DrawUtil.lua");
    expect(resolveProjectSourcePath(root, "@pool/ui/DrawUtil")).toBe("scripts/pool/ui/DrawUtil.lua");
    expect(readProjectSource(root, "pool/ui/DrawUtil")).toMatchObject({
      path: "scripts/pool/ui/DrawUtil.lua",
      text: "-- draw\n"
    });
  });

  it("resolves absolute script paths back into the project", () => {
    const root = tapProject();
    fs.mkdirSync(path.join(root, "scripts", "ui"), { recursive: true });
    const absolute = path.join(root, "scripts", "ui", "HomePage.lua");
    fs.writeFileSync(absolute, "return {}\n");
    expect(resolveProjectSourcePath(root, absolute)).toBe("scripts/ui/HomePage.lua");
    expect(readProjectSource(root, absolute).path).toBe("scripts/ui/HomePage.lua");
  });
});
