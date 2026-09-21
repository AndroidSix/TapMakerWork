import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { mutateGitProject, readGitStatus } from "./ide-tools.js";

const temporary: string[] = [];

function git(root: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

function repository(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-git-"));
  temporary.push(root);
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "TapMakerWork Test");
  git(root, "config", "user.email", "test@tapmakerwork.local");
  fs.writeFileSync(path.join(root, "tracked.txt"), "before\n", "utf8");
  git(root, "add", "tracked.txt");
  git(root, "commit", "-m", "initial commit");
  return root;
}

afterEach(() => {
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Git workspace operations", () => {
  it("reports staged, unstaged, untracked files and commit history", async () => {
    const root = repository();
    fs.writeFileSync(path.join(root, "tracked.txt"), "after\n", "utf8");
    fs.writeFileSync(path.join(root, "new file.txt"), "new\n", "utf8");

    const status = await readGitStatus(root);
    expect(status.branch).toBe("main");
    expect(status.commits[0]?.subject).toBe("initial commit");
    expect(status.changes.find((change) => change.path === "tracked.txt")).toMatchObject({ staged: false, unstaged: true, untracked: false });
    expect(status.changes.find((change) => change.path === "new file.txt")).toMatchObject({ staged: false, unstaged: true, untracked: true });

    const staged = await mutateGitProject(root, "stage", "new file.txt");
    expect(staged.status.changes.find((change) => change.path === "new file.txt")?.staged).toBe(true);

    const unstaged = await mutateGitProject(root, "unstage", "new file.txt");
    expect(unstaged.status.changes.find((change) => change.path === "new file.txt")).toMatchObject({ staged: false, untracked: true });
  });

  it("discards tracked and untracked working-tree changes", async () => {
    const root = repository();
    fs.writeFileSync(path.join(root, "tracked.txt"), "after\n", "utf8");
    fs.writeFileSync(path.join(root, "scratch.txt"), "scratch\n", "utf8");

    await mutateGitProject(root, "discard", "tracked.txt");
    await mutateGitProject(root, "discard", "scratch.txt");

    expect(fs.readFileSync(path.join(root, "tracked.txt"), "utf8")).toBe("before\n");
    expect(fs.existsSync(path.join(root, "scratch.txt"))).toBe(false);
    expect((await readGitStatus(root)).dirty).toBe(false);
  });
});
