import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readProjectText, resolveInsideProject, resolveProjectRoot, writeProjectText } from "./project.js";

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("project boundary", () => {
  it("resolves real project roots", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-project-"));
    temporary.push(root);
    fs.mkdirSync(path.join(root, ".maker-mcp"));
    fs.writeFileSync(path.join(root, ".maker-mcp", "config.json"), "{}");
    expect(resolveProjectRoot(root)).toMatchObject({ root: fs.realpathSync(root), makerBound: true });
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

  it("writes existing project files without leaving the project boundary", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-project-"));
    temporary.push(root);
    fs.writeFileSync(path.join(root, "screen.lua"), "return 1");
    writeProjectText(root, "screen.lua", "return 2");
    expect(readProjectText(root, "screen.lua")).toBe("return 2");
  });
});
