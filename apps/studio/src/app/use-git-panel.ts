import { useCallback, useEffect, useState, type SetStateAction } from "react";
import type { LogChannel } from "@tapmakerwork/protocol";
import { API } from "../bridge-api";
import type { CenterTab, GitChangeState, GitFileDiffState, GitStatusState, ToastKind } from "./types";

export function useGitPanel({ toast, setCenterTab, setActiveTerminal, setLogs }: {
  toast: (message: string, kind?: ToastKind) => void;
  setCenterTab: (tab: CenterTab) => void;
  setActiveTerminal: (channel: LogChannel) => void;
  setLogs: (update: SetStateAction<Record<LogChannel, string[]>>) => void;
}) {
  const [gitStatus, setGitStatus] = useState<GitStatusState>();
  const [gitBusy, setGitBusy] = useState<"pull" | "commit" | "push-build" | "">("");
  const [gitCommitMessage, setGitCommitMessage] = useState("chore: update Maker project");
  const [gitConflictPlan, setGitConflictPlan] = useState("");
  const [gitFileMenu, setGitFileMenu] = useState<{ change: GitChangeState; scope: "staged" | "unstaged"; x: number; y: number } | null>(null);
  const [gitGroupMenu, setGitGroupMenu] = useState<{ scope: "staged" | "unstaged"; x: number; y: number } | null>(null);
  const [gitDiff, setGitDiff] = useState<GitFileDiffState | null>(null);

  useEffect(() => {
    if (!gitFileMenu && !gitGroupMenu) return;
    const close = () => {
      setGitFileMenu(null);
      setGitGroupMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [gitFileMenu, gitGroupMenu]);

  const loadGitStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/git/status`);
      if (!response.ok) return;
      setGitStatus(await response.json() as GitStatusState);
    } catch {
      setGitStatus(undefined);
    }
  }, []);

  const openGitDiff = useCallback(async (change: GitChangeState, scope: "staged" | "unstaged") => {
    const apiScope = scope === "staged" ? "staged" : "worktree";
    setGitFileMenu(null);
    setGitGroupMenu(null);
    setGitDiff({
      path: change.path,
      scope: apiScope,
      status: change.status,
      original: "",
      modified: "",
      binary: false,
      added: change.untracked,
      deleted: false,
      additions: 0,
      deletions: 0,
      loading: true
    });
    setCenterTab("git-diff");
    try {
      const response = await fetch(`${API}/api/git/diff?path=${encodeURIComponent(change.path)}&scope=${apiScope}`);
      const result = await response.json() as GitFileDiffState & { error?: string };
      if (!response.ok) throw new Error(result.error || "无法读取 Git 差异");
      setGitDiff({ ...result, loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGitDiff((current) => current?.path === change.path ? { ...current, loading: false, error: message } : current);
      toast(`差异加载失败：${message}`, "error");
    }
  }, [toast]);

  const runGitAction = useCallback(async (action: "pull" | "commit" | "push-build") => {
    setGitBusy(action);
    setGitConflictPlan("");
    setActiveTerminal("build");
    try {
      const response = await fetch(`${API}/api/git/${action === "pull" ? "pull" : "commit"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: action === "pull" ? "{}" : JSON.stringify({
          message: gitCommitMessage,
          push: action === "push-build",
          remoteBuild: action === "push-build"
        })
      });
      const result = await response.json() as {
        ok?: boolean;
        output?: string;
        error?: string;
        conflictPlan?: string;
        status?: GitStatusState;
        remoteBuild?: { ok?: boolean; error?: string };
      };
      if (result.status) setGitStatus(result.status);
      if (result.conflictPlan) setGitConflictPlan(result.conflictPlan);
      const detail = result.output || result.error || result.remoteBuild?.error;
      if (detail) setLogs((current) => ({ ...current, build: [...current.build, detail].slice(-500) }));
      if (!response.ok || result.ok === false || result.remoteBuild?.ok === false) {
        throw new Error(result.remoteBuild?.error || result.error || "Git 操作失败");
      }
      toast(action === "pull" ? "已拉取最新代码" : action === "commit" ? "已完成本地提交" : "已提交、推送并触发远端刷新", "success");
      void loadGitStatus();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setGitBusy("");
    }
  }, [gitCommitMessage, loadGitStatus, toast]);

  const runGitFileAction = useCallback(async (action: "stage" | "unstage" | "discard" | "stage-all" | "unstage-all" | "discard-all", change?: GitChangeState) => {
    if (action === "discard" && change && !window.confirm(`确定丢弃 ${change.path} 的本地修改吗？此操作无法撤销。`)) return;
    if (action === "discard-all" && !window.confirm("确定放弃所有本地更改吗？未跟踪文件也会被删除，此操作无法撤销。")) return;
    setGitFileMenu(null);
    setGitGroupMenu(null);
    try {
      const response = await fetch(`${API}/api/git/mutate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...(change ? { path: change.path } : {}) })
      });
      const result = await response.json() as { status?: GitStatusState; error?: string };
      if (!response.ok || !result.status) throw new Error(result.error || "Git 文件操作失败");
      setGitStatus(result.status);
      if ((action === "discard" && change?.path === gitDiff?.path) || action === "discard-all") {
        setGitDiff(null);
        setCenterTab("code");
      } else if (change && change.path === gitDiff?.path) {
        void openGitDiff(change, action === "stage" ? "staged" : "unstaged");
      } else if (gitDiff && (action === "stage-all" || action === "unstage-all")) {
        const nextChange = result.status.changes?.find((item) => item.path === gitDiff.path);
        if (nextChange) void openGitDiff(nextChange, action === "stage-all" ? "staged" : "unstaged");
        else {
          setGitDiff(null);
          setCenterTab("code");
        }
      }
      toast(action === "stage" || action === "stage-all" ? "已暂存修改" : action === "unstage" || action === "unstage-all" ? "已取消暂存" : action === "discard-all" ? "已放弃所有本地更改" : "已丢弃本地修改", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  }, [gitDiff?.path, openGitDiff, toast]);

  return {
    gitStatus,
    setGitStatus,
    gitBusy,
    gitCommitMessage,
    setGitCommitMessage,
    gitConflictPlan,
    setGitConflictPlan,
    gitFileMenu,
    setGitFileMenu,
    gitGroupMenu,
    setGitGroupMenu,
    gitDiff,
    setGitDiff,
    loadGitStatus,
    openGitDiff,
    runGitAction,
    runGitFileAction
  };
}
