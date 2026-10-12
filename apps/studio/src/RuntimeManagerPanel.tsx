import { useCallback, useEffect, useState } from "react";
import { ArrowRightLeft, Cpu, FileText, Loader2, RefreshCw, Square, X } from "lucide-react";
import type { PreviewSessionSummary } from "@tapmakerwork/protocol";
import { formatUptime } from "./app/format";
import { sameProjectPath } from "./app/paths";

const SESSIONS_POLL_MS = 3_000;
const LOGS_POLL_MS = 2_000;

interface RuntimeManagerPanelProps {
  apiBase: string;
  onClose: () => void;
  onOpenProject: (projectRoot: string) => void;
  onSessionsChanged: (runningRoots: string[]) => void;
}

function sessionStatus(session: PreviewSessionSummary): { label: string; tone: "live" | "unknown" | "stale" } {
  if (session.alive === true) return { label: "运行中", tone: "live" };
  if (session.alive === null) return { label: "无法确认进程", tone: "unknown" };
  return { label: "Runtime 已退出（残留会话）", tone: "stale" };
}

export function RuntimeManagerPanel({ apiBase, onClose, onOpenProject, onSessionsChanged }: RuntimeManagerPanelProps) {
  const [sessions, setSessions] = useState<PreviewSessionSummary[] | null>(null);
  const [currentRoot, setCurrentRoot] = useState<string | null>(null);
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ lines: string[]; source?: string } | null>(null);
  const [stopping, setStopping] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const loadSessions = useCallback(async () => {
    const response = await fetch(`${apiBase}/api/runtimes`);
    if (!response.ok) return;
    const data = await response.json() as { sessions: PreviewSessionSummary[]; currentProjectRoot: string | null };
    setSessions(data.sessions);
    setCurrentRoot(data.currentProjectRoot);
    setNow(Date.now());
    onSessionsChanged(data.sessions.filter((session) => session.alive === true).map((session) => session.projectRoot));
  }, [apiBase, onSessionsChanged]);

  useEffect(() => {
    void loadSessions().catch(() => undefined);
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadSessions().catch(() => undefined);
    }, SESSIONS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadSessions]);

  useEffect(() => {
    if (!logsFor) return;
    const loadLogs = async () => {
      const response = await fetch(`${apiBase}/api/runtimes/logs?projectRoot=${encodeURIComponent(logsFor)}`);
      setLogs(response.ok ? await response.json() as { lines: string[]; source?: string } : { lines: ["该 Runtime 会话已结束，没有可读日志。"] });
    };
    void loadLogs().catch(() => undefined);
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadLogs().catch(() => undefined);
    }, LOGS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [apiBase, logsFor]);

  const stop = useCallback(async (projectRoots: string[]) => {
    setStopping((current) => new Set([...current, ...projectRoots]));
    setMessage(null);
    const failures: string[] = [];
    await Promise.all(projectRoots.map(async (projectRoot) => {
      const response = await fetch(`${apiBase}/api/maker/preview/stop`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectRoot })
      }).catch(() => undefined);
      if (!response?.ok) failures.push(projectRoot.split(/[\\/]/).at(-1) ?? projectRoot);
    }));
    setStopping((current) => new Set([...current].filter((root) => !projectRoots.includes(root))));
    setMessage(failures.length ? `停止失败：${failures.join("、")}。详情见 Runtime 终端。` : `已停止 ${projectRoots.length} 个 Runtime。`);
    await loadSessions().catch(() => undefined);
  }, [apiBase, loadSessions]);

  const liveRoots = (sessions ?? []).filter((session) => session.alive !== false).map((session) => session.projectRoot);

  return (
    <section className="overlay-panel panel tools-panel" aria-label="Runtime 管理">
      <div className="overlay-heading">
        <strong><Cpu size={15} aria-hidden="true" />Runtime 管理</strong>
        <div className="asset-checkup-heading-actions">
          {liveRoots.length > 1 && <button type="button" onClick={() => void stop(liveRoots)}><Square size={12} />全部停止</button>}
          <button type="button" aria-label="刷新 Runtime 列表" onClick={() => void loadSessions()}><RefreshCw size={13} />刷新</button>
          <button type="button" aria-label="关闭" onClick={onClose}><X size={14} />关闭</button>
        </div>
      </div>
      <div className="image-compress-panel">
        <p className="desktop-card-note">每个项目的 Maker 本地预览各自占用一个 Runtime 进程。这里列出所有账号下未停止的会话，可查看日志、切换项目或停止。</p>
        {message && <p className="image-compress-message" role="status">{message}</p>}
        {sessions === null ? (
          <p className="desktop-card-note"><Loader2 size={12} className="spin" /> 正在读取 Runtime 会话…</p>
        ) : sessions.length === 0 ? (
          <section className="image-compress-card"><p className="desktop-card-note">当前没有正在运行的 Runtime。在项目里点「启动」即可开启本地预览。</p></section>
        ) : sessions.map((session) => {
          const status = sessionStatus(session);
          const isCurrent = Boolean(currentRoot && sameProjectPath(currentRoot, session.projectRoot));
          const isStopping = stopping.has(session.projectRoot);
          return (
            <section key={session.projectRoot} className={`image-compress-card runtime-session is-${status.tone}`}>
              <div className="desktop-card-heading">
                <div>
                  <h4>
                    <i className="runtime-session-dot" aria-hidden="true" />
                    {session.projectName}
                    {isCurrent && <small className="runtime-session-current">当前项目</small>}
                  </h4>
                  <p title={session.projectRoot}>{session.projectRoot}</p>
                </div>
                <span className={`runtime-session-state is-${status.tone}`}>{status.label}</span>
              </div>
              <dl className="runtime-session-meta">
                <div><dt>Runtime PID</dt><dd>{session.runtimePid ?? "—"}</dd></div>
                <div><dt>Supervisor PID</dt><dd>{session.supervisorPid ?? "—"}</dd></div>
                <div><dt>运行时长</dt><dd>{formatUptime(session.startedAt, now)}</dd></div>
              </dl>
              <div className="desktop-card-actions">
                <button type="button" aria-pressed={logsFor === session.projectRoot} onClick={() => { setLogs(null); setLogsFor(logsFor === session.projectRoot ? null : session.projectRoot); }}>
                  <FileText size={13} />{logsFor === session.projectRoot ? "收起日志" : "日志"}
                </button>
                {!isCurrent && <button type="button" onClick={() => onOpenProject(session.projectRoot)}><ArrowRightLeft size={13} />切换到此项目</button>}
                <button type="button" className="danger" disabled={isStopping} onClick={() => void stop([session.projectRoot])}>
                  {isStopping ? <Loader2 size={12} className="spin" /> : <Square size={12} />}{status.tone === "stale" ? "清理会话" : "停止"}
                </button>
              </div>
              {logsFor === session.projectRoot && (
                <div className="runtime-session-logs">
                  <pre className="tips-copy-text" aria-live="polite">{logs ? logs.lines.join("\n") : "读取日志中…"}</pre>
                  {logs?.source && <small className="desktop-card-note" title={logs.source}>来源：{logs.source}</small>}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
