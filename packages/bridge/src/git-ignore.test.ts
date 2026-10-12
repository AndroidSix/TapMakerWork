import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureTapMakerWorkGitIgnored } from "./git-ignore.js";

const temporary: string[] = [];

function projectWithGitIgnore(contents?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-gitignore-"));
  temporary.push(root);
  if (contents !== undefined) fs.writeFileSync(path.join(root, ".gitignore"), contents, "utf8");
  return root;
}

function readGitIgnore(root: string): string {
  return fs.readFileSync(path.join(root, ".gitignore"), "utf8");
}

afterEach(() => {
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("ensureTapMakerWorkGitIgnored", () => {
  it("creates .gitignore when the project has none", () => {
    const root = projectWithGitIgnore();
    expect(ensureTapMakerWorkGitIgnored(root).changed).toBe(true);
    expect(readGitIgnore(root)).toBe("# TapMakerWork IDE local state\n.tapmakerwork/\n");
  });

  it("appends after existing rules and is idempotent", () => {
    const root = projectWithGitIgnore("node_modules/\n.DS_Store");
    ensureTapMakerWorkGitIgnored(root);
    expect(ensureTapMakerWorkGitIgnored(root).changed).toBe(false);
    expect(readGitIgnore(root)).toBe("node_modules/\n.DS_Store\n\n# TapMakerWork IDE local state\n.tapmakerwork/\n");
  });

  it("keeps CRLF line endings used by Windows projects", () => {
    const root = projectWithGitIgnore("build/\r\n");
    ensureTapMakerWorkGitIgnored(root);
    expect(readGitIgnore(root)).toBe("build/\r\n\r\n# TapMakerWork IDE local state\r\n.tapmakerwork/\r\n");
  });

  it.each([".tapmakerwork", "/.tapmakerwork/", ".tapmakerwork/**", "  .tapmakerwork/  "])(
    "leaves an existing %j rule alone",
    (rule) => {
      const root = projectWithGitIgnore(`${rule}\n`);
      expect(ensureTapMakerWorkGitIgnored(root).changed).toBe(false);
      expect(readGitIgnore(root)).toBe(`${rule}\n`);
    }
  );

  it("does not treat a nested scripts/tapmakerwork rule as covering the IDE folder", () => {
    const root = projectWithGitIgnore("scripts/tapmakerwork/\n");
    expect(ensureTapMakerWorkGitIgnored(root).changed).toBe(true);
  });
});
