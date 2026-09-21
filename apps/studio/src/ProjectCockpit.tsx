import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Box,
  CheckCircle2,
  CircleDashed,
  CircleX,
  FileJson2,
  Image,
  Music2,
  Play,
  RefreshCw,
  Rocket,
  Save,
  ScanSearch,
  Video
} from "lucide-react";
import type {
  ProjectWorkflowAction,
  ProjectWorkflowOverview,
  ProjectWorkflowStage,
  ProjectWorkflowStatus
} from "@tapmakerwork/protocol";

const API = "http://127.0.0.1:43121";

interface ProjectCockpitProps {
  overview?: ProjectWorkflowOverview | undefined;
  loading: boolean;
  busyAction?: ProjectWorkflowAction | undefined;
  onRefresh: () => void;
  onAction: (action: ProjectWorkflowAction) => void;
  onObjectiveSaved: (objective: string) => void;
  onToast: (message: string, kind?: "info" | "success" | "error" | "warn") => void;
}

function StatusIcon({ status }: { status: ProjectWorkflowStatus }) {
  if (status === "pass") return <CheckCircle2 size={15} aria-hidden="true" />;
  if (status === "blocked") return <CircleX size={15} aria-hidden="true" />;
  if (status === "warning") return <AlertTriangle size={15} aria-hidden="true" />;
  return <CircleDashed size={15} aria-hidden="true" />;
}

function stageProgress(stage: ProjectWorkflowStage): number {
  const points: Record<ProjectWorkflowStatus, number> = { pass: 1, warning: 0.55, pending: 0.25, blocked: 0 };
  return Math.round(stage.checks.reduce((sum, check) => sum + points[check.status], 0) / Math.max(1, stage.checks.length) * 100);
}

function EvidenceIcon({ kind }: { kind: ProjectWorkflowOverview["evidence"][number]["kind"] }) {
  if (kind === "ui-sidecar") return <FileJson2 size={15} aria-hidden="true" />;
  if (kind === "runtime-snapshot") return <Activity size={15} aria-hidden="true" />;
  return <ScanSearch size={15} aria-hidden="true" />;
}

export function ProjectCockpit({ overview, loading, busyAction, onRefresh, onAction, onObjectiveSaved, onToast }: ProjectCockpitProps) {
  const [objective, setObjective] = useState(overview?.objective || "");
  const [saving, setSaving] = useState(false);
  useEffect(() => setObjective(overview?.objective || ""), [overview?.objective]);

  const completedStages = useMemo(() => overview?.stages.filter((stage) => stage.status === "pass").length ?? 0, [overview]);

  const saveObjective = async () => {
    setSaving(true);
    try {
      const response = await fetch(`${API}/api/workflow/state`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objective })
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "目标保存失败");
      onObjectiveSaved(objective.trim());
      onToast("交付目标已保存", "success");
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setSaving(false);
    }
  };

  if (!overview) {
    return (
      <div className="cockpit-loading" aria-busy="true">
        <RefreshCw size={22} className={loading ? "spin" : ""} aria-hidden="true" />
        <strong>{loading ? "正在检查项目交付链路…" : "项目检查尚未运行"}</strong>
        {!loading && <button onClick={onRefresh}>开始检查</button>}
      </div>
    );
  }

  return (
    <div className="project-cockpit">
      <header className="cockpit-hero">
        <div>
          <span className="eyebrow"><Rocket size={14} aria-hidden="true" /> Maker delivery loop</span>
          <h1>项目交付工作台</h1>
          <p>把设计、运行、验证和发布放在同一条项目链路里。</p>
        </div>
        <div className={`readiness-score status-${overview.status}`} aria-label={`交付就绪度 ${overview.score} 分`}>
          <strong>{overview.score}</strong>
          <span>就绪度</span>
        </div>
      </header>

      <section className="objective-card" aria-label="当前交付目标">
        <div>
          <span className="section-kicker">当前目标</span>
          <input
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void saveObjective(); }}
            aria-label="当前交付目标"
          />
        </div>
        <button onClick={() => void saveObjective()} disabled={saving || objective.trim() === overview.objective}>
          <Save size={14} aria-hidden="true" />{saving ? "保存中" : "保存目标"}
        </button>
      </section>

      <section className="workflow-summary" aria-label="开发阶段">
        <div className="section-heading">
          <div><span className="section-kicker">开发闭环</span><h2>{completedStages}/{overview.stages.length} 阶段通过</h2></div>
          <button className="icon-command" onClick={onRefresh} disabled={loading} aria-label="重新检查项目"><RefreshCw size={14} className={loading ? "spin" : ""} /></button>
        </div>
        <div className="stage-rail">
          {overview.stages.map((stage, index) => (
            <article key={stage.id} className={`stage-card status-${stage.status}`}>
              <div className="stage-index">{String(index + 1).padStart(2, "0")}</div>
              <div className="stage-title"><StatusIcon status={stage.status} /><strong>{stage.label}</strong><span>{stageProgress(stage)}%</span></div>
              <p>{stage.description}</p>
              <div className="stage-checks">
                {stage.checks.map((check) => (
                  <div key={check.id} className={`workflow-check status-${check.status}`}>
                    <StatusIcon status={check.status} />
                    <div><strong>{check.label}</strong><small>{check.detail}</small></div>
                    {check.action && <button onClick={() => onAction(check.action!)} disabled={busyAction === check.action}>{busyAction === check.action ? "执行中" : check.actionLabel || "处理"}</button>}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="cockpit-grid">
        <section className="cockpit-card next-action-card">
          <div className="section-heading"><div><span className="section-kicker">下一步</span><h2>{overview.nextAction?.label || "核心检查已完成"}</h2></div><Play size={18} aria-hidden="true" /></div>
          <p>{overview.nextAction?.reason || "可以进入人工验收与远端构建。"}</p>
          {overview.nextAction && <button className="primary-action" onClick={() => onAction(overview.nextAction!.action)} disabled={busyAction === overview.nextAction.action}><Play size={14} aria-hidden="true" />{busyAction === overview.nextAction.action ? "执行中…" : overview.nextAction.label}</button>}
        </section>

        <section className="cockpit-card asset-audit-card">
          <div className="section-heading"><div><span className="section-kicker">素材语义层</span><h2>{overview.assets.referenced}/{overview.assets.total} 已绑定</h2></div><Box size={18} aria-hidden="true" /></div>
          <div className="asset-metrics">
            <span><Image size={14} aria-hidden="true" />图片 <b>{overview.assets.byKind.image}</b></span>
            <span><Music2 size={14} aria-hidden="true" />音频 <b>{overview.assets.byKind.audio}</b></span>
            <span><Video size={14} aria-hidden="true" />视频 <b>{overview.assets.byKind.video}</b></span>
            <span><Box size={14} aria-hidden="true" />模型 <b>{overview.assets.byKind.model}</b></span>
          </div>
          <div className="binding-meter"><span style={{ width: `${overview.assets.total ? overview.assets.referenced / overview.assets.total * 100 : 0}%` }} /></div>
          <p>{overview.assets.unreferenced ? `${overview.assets.unreferenced} 项尚未在脚本或配置中找到引用，需要人工确认。` : "已扫描素材都能在项目内容中找到引用。"}</p>
        </section>

        <section className="cockpit-card evidence-card">
          <div className="section-heading"><div><span className="section-kicker">项目验证</span><h2>{overview.evidence.length} 项结构与运行状态</h2></div><ScanSearch size={18} aria-hidden="true" /></div>
          <div className="evidence-list">
            {overview.evidence.length ? overview.evidence.slice(0, 6).map((item) => (
              <div key={item.id} className="evidence-row" title={item.path || item.detail}>
                <EvidenceIcon kind={item.kind} />
                <div><strong>{item.label}</strong><small>{item.detail}</small></div>
                {item.capturedAt && <time dateTime={item.capturedAt}>{new Date(item.capturedAt).toLocaleDateString()}</time>}
              </div>
            )) : <p className="empty-state">还没有验证信息。可先保存 UI 旁路或启动 Runtime。</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
