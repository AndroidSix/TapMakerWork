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

  it("resolves NanoVG require-style chunk names to scripts/*.lua", () => {
    const root = tapProject();
    fs.mkdirSync(path.join(root, "scripts", "pool", "ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts", "pool", "ui", "DrawUtil.lua"), "-- draw\n");
    expect(candidateProjectSourcePaths("pool/ui/DrawUtil")).toContain("scripts/pool/ui/DrawUtil.lua");
    expect(resolveProjectSourcePath(root, "pool/ui/DrawUtil")).toBe("scripts/pool/ui/DrawUtil.lua");
    expect(resolveProjectSourcePath(root, "@pool/ui/DrawUtil")).toBe("scripts/pool/ui/DrawUtil.lua");
    expect(readProjectSource(root, "pool/ui/DrawUtil")).toEqual({
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
