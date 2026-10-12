// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LogChannel } from "@tapmakerwork/protocol";
import { renderHook } from "./render-hook";
import type { GitChangeState, GitStatusState } from "./types";
import { useGitPanel } from "./use-git-panel";

const change: GitChangeState = {
  path: "scripts/main.lua",
  status: "M",
  indexStatus: " ",
  workTreeStatus: "M",
  staged: false,
  unstaged: true,
  untracked: false,
  conflicted: false
};
const status: GitStatusState = { branch: "main", changes: [change] };

type Route = { status?: number; body: unknown } | Error;

function mockFetch(routes: Record<string, Route>) {
  const calls: Array<{ key: string; body?: unknown }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    calls.push({ key, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    const route = routes[key];
    if (!route) throw new Error(`unexpected fetch ${key}`);
    if (route instanceof Error) throw route;
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
  }));
  return calls;
}

function setup() {
  const deps = { toast: vi.fn(), setCenterTab: vi.fn(), setActiveTerminal: vi.fn(), setLogs: vi.fn() };
  const view = renderHook(() => useGitPanel(deps));
  return { ...view, ...deps };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useGitPanel", () => {
  it("loads status and clears it when the bridge is unreachable", async () => {
    mockFetch({ "GET /api/git/status": { body: status } });
    const { result, unmount } = setup();
    await act(() => result.current.loadGitStatus());
    expect(result.current.gitStatus).toEqual(status);
    mockFetch({ "GET /api/git/status": new Error("offline") });
    await act(() => result.current.loadGitStatus());
    expect(result.current.gitStatus).toBeUndefined();
    unmount();
  });

  it("opens a worktree diff in the diff tab", async () => {
    mockFetch({ "GET /api/git/diff": { body: { path: change.path, scope: "worktree", original: "a", modified: "b", additions: 1, deletions: 1 } } });
    const { result, setCenterTab, unmount } = setup();
    await act(() => result.current.openGitDiff(change, "unstaged"));
    expect(setCenterTab).toHaveBeenCalledWith("git-diff");
    expect(result.current.gitDiff).toMatchObject({ path: change.path, modified: "b", loading: false });
    unmount();
  });

  it("keeps the diff open with an error when loading fails", async () => {
    mockFetch({ "GET /api/git/diff": { status: 500, body: { error: "not a repo" } } });
    const { result, toast, unmount } = setup();
    await act(() => result.current.openGitDiff(change, "staged"));
    expect(result.current.gitDiff).toMatchObject({ path: change.path, scope: "staged", loading: false, error: "not a repo" });
    expect(toast).toHaveBeenCalledWith("差异加载失败：not a repo", "error");
    unmount();
  });

  it("commits with the current message, logs output and reloads status", async () => {
    const calls = mockFetch({
      "POST /api/git/commit": { body: { ok: true, output: "1 file changed", status } },
      "GET /api/git/status": { body: status }
    });
    const { result, toast, setActiveTerminal, setLogs, unmount } = setup();
    act(() => result.current.setGitCommitMessage("feat: 新关卡"));
    await act(() => result.current.runGitAction("commit"));
    expect(calls[0]).toEqual({ key: "POST /api/git/commit", body: { message: "feat: 新关卡", push: false, remoteBuild: false } });
    expect(setActiveTerminal).toHaveBeenCalledWith("build");
    const update = setLogs.mock.calls[0]?.[0] as (current: Record<LogChannel, string[]>) => Record<LogChannel, string[]>;
    expect(update({ build: ["old"] } as Record<LogChannel, string[]>).build).toEqual(["old", "1 file changed"]);
    expect(toast).toHaveBeenCalledWith("已完成本地提交", "success");
    expect(calls.at(-1)?.key).toBe("GET /api/git/status");
    expect(result.current.gitBusy).toBe("");
    unmount();
  });

  it("shows the conflict plan when a pull fails", async () => {
    mockFetch({ "POST /api/git/pull": { status: 409, body: { ok: false, error: "合并冲突", conflictPlan: "先解决 main.lua" } } });
    const { result, toast, unmount } = setup();
    await act(() => result.current.runGitAction("pull"));
    expect(result.current.gitConflictPlan).toBe("先解决 main.lua");
    expect(toast).toHaveBeenCalledWith("合并冲突", "error");
    unmount();
  });

  it("asks before discarding and closes the diff after discarding everything", async () => {
    const calls = mockFetch({
      "GET /api/git/diff": { body: { path: change.path, scope: "worktree" } },
      "POST /api/git/mutate": { body: { status: { ...status, changes: [] } } }
    });
    const confirm = vi.fn(() => false);
    Object.assign(window, { confirm });
    const { result, setCenterTab, toast, unmount } = setup();
    await act(() => result.current.runGitFileAction("discard", change));
    expect(calls).toEqual([]);
    await act(() => result.current.openGitDiff(change, "unstaged"));
    confirm.mockReturnValue(true);
    await act(() => result.current.runGitFileAction("discard-all"));
    expect(calls.at(-1)).toEqual({ key: "POST /api/git/mutate", body: { action: "discard-all" } });
    expect(result.current.gitDiff).toBeNull();
    expect(setCenterTab).toHaveBeenLastCalledWith("code");
    expect(toast).toHaveBeenLastCalledWith("已放弃所有本地更改", "success");
    unmount();
  });

  it("closes context menus on Escape", () => {
    const { result, unmount } = setup();
    act(() => result.current.setGitFileMenu({ change, scope: "unstaged", x: 1, y: 2 }));
    expect(result.current.gitFileMenu).not.toBeNull();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(result.current.gitFileMenu).toBeNull();
    unmount();
  });
});
