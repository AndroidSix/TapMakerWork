import { Copy, Download, FileCode2, GitBranch, Plus, RefreshCw, Rocket, Save, ShieldAlert, Undo2 } from "lucide-react";
import type { CenterTab, GitChangeState, GitStatusState } from "./types";
import { fileName } from "./paths";

/** 右键菜单的锚点坐标；由 App 持有，面板只负责发起。 */
export type GitMenuAnchor = { x: number; y: number };

export function GitPanel({
  gitStatus,
  gitBusy,
  gitCommitMessage,
  onCommitMessageChange,
  gitConflictPlan,
  copyBusy,
  centerTab,
  gitDiffPath,
  gitDiffScope,
  onLoadStatus,
  onRunAction,
  onRunFileAction,
  onOpenDiff,
  onCopy,
  onOpenGroupMenu,
  onOpenFileMenu
}: {
  gitStatus: GitStatusState | undefined;
  gitBusy: string | undefined;
  gitCommitMessage: string;
  onCommitMessageChange: (value: string) => void;
  gitConflictPlan: string | null;
  copyBusy: boolean;
  centerTab: CenterTab;
  gitDiffPath: string | undefined;
  gitDiffScope: "staged" | "worktree" | undefined;
  onLoadStatus: () => void;
  onRunAction: (action: "pull" | "commit" | "push-build") => void;
  onRunFileAction: (action: "stage" | "unstage" | "stage-all" | "unstage-all", change?: GitChangeState) => void;
  onOpenDiff: (change: GitChangeState, scope: "staged" | "unstaged") => void;
  onCopy: (text: string) => void;
  onOpenGroupMenu: (scope: "staged" | "unstaged", anchor: GitMenuAnchor) => void;
  onOpenFileMenu: (change: GitChangeState, scope: "staged" | "unstaged", anchor: GitMenuAnchor) => void;
}) {
  const staged = gitStatus?.changes?.filter((change) => change.staged) ?? [];
  const unstaged = gitStatus?.changes?.filter((change) => change.unstaged) ?? [];
  const menuAnchor = (event: React.MouseEvent | React.KeyboardEvent, height: number): GitMenuAnchor => {
    if ("clientX" in event) {
      return { x: Math.min(event.clientX, window.innerWidth - 230), y: Math.min(event.clientY, window.innerHeight - height) };
    }
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(rect.left + 12, window.innerWidth - 230), y: Math.min(rect.bottom, window.innerHeight - height) };
  };
  const isContextMenuKey = (event: React.KeyboardEvent) =>
    event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");

  return (
    <div className="git-panel">
      <header className="git-panel-head">
        <div><span>源代码管理</span><strong><GitBranch size={14} />{gitStatus?.branch || "未识别分支"}</strong></div>
        <div>
          <button className="icon-command" aria-label="拉取远端修改" title="拉取" disabled={Boolean(gitBusy)} onClick={() => onRunAction("pull")}><Download size={13} /></button>
          <button className="icon-command" aria-label="刷新 Git 状态" title="刷新" onClick={onLoadStatus}><RefreshCw size={13} /></button>
        </div>
      </header>
      <div className="git-sync-status">
        <span title={gitStatus?.upstream || "尚未绑定上游"}>{gitStatus?.upstream || "未绑定上游"}</span>
        <small>↑ {gitStatus?.ahead || 0}</small><small>↓ {gitStatus?.behind || 0}</small>
      </div>
      <div className="git-commit-box">
        <input
          value={gitCommitMessage}
          onChange={(event) => onCommitMessageChange(event.target.value)}
          onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") onRunAction("commit"); }}
          placeholder={`消息（⌘/Ctrl+Enter 在“${gitStatus?.branch || "当前分支"}”提交）`}
          aria-label="Git 提交说明"
        />
        <button className="primary" disabled={Boolean(gitBusy) || !gitCommitMessage.trim() || !gitStatus?.dirty} onClick={() => onRunAction("commit")}><Save size={14} />{gitBusy === "commit" ? "提交中…" : "提交"}</button>
      </div>

      {staged.length > 0 && <section className="git-change-group">
        <header
          className="git-change-header"
          tabIndex={0}
          aria-label="暂存的更改；右键打开批量操作"
          onContextMenu={(event) => { event.preventDefault(); onOpenGroupMenu("staged", menuAnchor(event, 130)); }}
          onKeyDown={(event) => { if (!isContextMenuKey(event)) return; event.preventDefault(); onOpenGroupMenu("staged", menuAnchor(event, 130)); }}
        ><strong>暂存的更改</strong><span>{staged.length}</span><button className="icon-command" aria-label="取消暂存全部" title="取消暂存全部" onClick={() => onRunFileAction("unstage-all")}><Undo2 size={12} /></button></header>
        <div className="git-file-list">
          {staged.map((change) => <div
            key={`staged:${change.path}`}
            className={`git-file-row ${change.conflicted ? "conflicted" : ""} ${centerTab === "git-diff" && gitDiffPath === change.path && gitDiffScope === "staged" ? "active" : ""}`}
            onContextMenu={(event) => { event.preventDefault(); onOpenFileMenu(change, "staged", menuAnchor(event, 210)); }}
          >
            <button className="git-file-open" title={`${change.path} · 点击查看暂存差异`} onClick={() => onOpenDiff(change, "staged")}><FileCode2 size={13} /><span><strong>{fileName(change.path)}</strong><small>{change.path.includes("/") ? change.path.slice(0, change.path.lastIndexOf("/")) : "项目根目录"}</small></span><code>{change.indexStatus}</code></button>
            <button className="git-file-action" aria-label={`取消暂存 ${change.path}`} title="取消暂存" onClick={() => onRunFileAction("unstage", change)}><Undo2 size={12} /></button>
          </div>)}
        </div>
      </section>}

      <section className="git-change-group">
        <header
          className="git-change-header"
          tabIndex={0}
          aria-label="更改；右键打开批量操作"
          onContextMenu={(event) => { event.preventDefault(); onOpenGroupMenu("unstaged", menuAnchor(event, 150)); }}
          onKeyDown={(event) => { if (!isContextMenuKey(event)) return; event.preventDefault(); onOpenGroupMenu("unstaged", menuAnchor(event, 150)); }}
        ><strong>更改</strong><span>{unstaged.length}</span>{unstaged.length > 0 && <button className="icon-command" aria-label="暂存全部更改" title="暂存全部" onClick={() => onRunFileAction("stage-all")}><Plus size={13} /></button>}</header>
        <div className="git-file-list">
          {unstaged.length === 0 ? <p className="empty-state">工作区没有未暂存修改。</p> : unstaged.map((change) => <div
            key={`changed:${change.path}`}
            className={`git-file-row ${change.conflicted ? "conflicted" : ""} ${centerTab === "git-diff" && gitDiffPath === change.path && gitDiffScope === "worktree" ? "active" : ""}`}
            onContextMenu={(event) => { event.preventDefault(); onOpenFileMenu(change, "unstaged", menuAnchor(event, 210)); }}
          >
            <button className="git-file-open" title={`${change.path} · 点击查看工作区差异，右键查看更多操作`} onClick={() => onOpenDiff(change, "unstaged")}><FileCode2 size={13} /><span><strong>{fileName(change.path)}</strong><small>{change.path.includes("/") ? change.path.slice(0, change.path.lastIndexOf("/")) : "项目根目录"}</small></span><code>{change.untracked ? "U" : change.workTreeStatus}</code></button>
            <button className="git-file-action" aria-label={`暂存 ${change.path}`} title="暂存更改" onClick={() => onRunFileAction("stage", change)}><Plus size={13} /></button>
          </div>)}
        </div>
      </section>

      <div className="git-actions">
        <button className="primary" disabled={Boolean(gitBusy) || !gitCommitMessage.trim()} onClick={() => onRunAction("push-build")}><Rocket size={13} />{gitBusy === "push-build" ? "推送并刷新中…" : "提交、推送并刷新"}</button>
      </div>
      {gitConflictPlan && <section className="git-conflict-plan" role="alert">
        <strong><ShieldAlert size={14} />需要处理 Git 冲突</strong>
        <p>已生成保留本地修改的处理上下文，可一键复制给 AI。</p>
        <textarea readOnly value={gitConflictPlan} aria-label="可复制给 AI 的 Git 冲突处理上下文" />
        <button disabled={copyBusy} onClick={() => onCopy(gitConflictPlan)}><Copy size={13} />{copyBusy ? "正在复制…" : "复制给 AI"}</button>
      </section>}
      <section className="git-graph" aria-label="Git 提交图谱">
        <header><strong>图谱</strong><span>{gitStatus?.commits?.length || 0}</span></header>
        <div>{gitStatus?.commits?.map((commit, index) => <article key={commit.hash} title={`${commit.hash}\n${commit.author} · ${commit.relativeDate}`}>
          <span className="git-graph-line"><i />{index < (gitStatus?.commits?.length || 0) - 1 && <b />}</span>
          <div><strong>{commit.subject}</strong><small><code>{commit.shortHash}</code>{commit.relativeDate}</small></div>
          {commit.refs.slice(0, 1).map((ref) => <em key={ref}>{ref.replace(/^HEAD -> /, "")}</em>)}
        </article>)}</div>
      </section>
    </div>
  );
}
