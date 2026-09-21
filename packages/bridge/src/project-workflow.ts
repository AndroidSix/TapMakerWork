import fs from "node:fs";
import path from "node:path";
import type {
  PreviewPanelState,
  ProjectAssetSummary,
  ProjectWorkflowCheck,
  ProjectWorkflowEvidence,
  ProjectWorkflowOverview,
  ProjectWorkflowStage,
  ProjectWorkflowStatus
} from "@tapmakerwork/protocol";
import type { AssetEntry, GitStatus } from "./ide-tools.js";
import { resolveInsideProject } from "./project.js";

const WORKFLOW_PATH = ".tapmakerwork/workflow.json";
const DEFAULT_OBJECTIVE = "完成可运行、可验证、可发布的 Maker 游戏版本";
const SKIP_DIRS = new Set([".git", "node_modules", "dist", ".tmp", ".maker"]);

interface WorkflowFile {
  objective?: string;
  updatedAt?: string;
}

export interface ProjectWorkflowInput {
  projectRoot: string;
  projectName: string;
  makerBound: boolean;
  makerCli: boolean;
  makerVersion?: string | undefined;
  uiScreenCount: number;
  runtimeSessionId?: string | undefined;
  runtimeScene?: "idle" | "loading" | "live" | undefined;
  runtimeSnapshotPath?: string | undefined;
  previewPanel: PreviewPanelState;
  qrcodeUrl?: string | undefined;
  git?: GitStatus | undefined;
  gitError?: string | undefined;
  assets: AssetEntry[];
}

function walkFiles(root: string, predicate: (filename: string) => boolean, limit = 500): string[] {
  const found: string[] = [];
  const pending = [root];
  while (pending.length && found.length < limit) {
    const directory = pending.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (found.length >= limit) break;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) pending.push(filename);
      } else if (entry.isFile() && predicate(filename)) {
        found.push(filename);
      }
    }
  }
  return found;
}

export function loadProjectWorkflow(projectRoot: string): WorkflowFile {
  try {
    const filename = resolveInsideProject(projectRoot, WORKFLOW_PATH);
    if (!fs.existsSync(filename)) return {};
    const parsed = JSON.parse(fs.readFileSync(filename, "utf8")) as WorkflowFile;
    return {
      ...(typeof parsed.objective === "string" ? { objective: parsed.objective.slice(0, 500) } : {}),
      ...(typeof parsed.updatedAt === "string" ? { updatedAt: parsed.updatedAt } : {})
    };
  } catch {
    return {};
  }
}

export function saveProjectWorkflow(projectRoot: string, patch: { objective?: string }): WorkflowFile {
  const current = loadProjectWorkflow(projectRoot);
  const next: WorkflowFile = {
    ...current,
    ...(patch.objective !== undefined ? { objective: patch.objective.trim().slice(0, 500) } : {}),
    updatedAt: new Date().toISOString()
  };
  const filename = resolveInsideProject(projectRoot, WORKFLOW_PATH);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function aggregateStatus(checks: ProjectWorkflowCheck[]): ProjectWorkflowStatus {
  if (checks.some((check) => check.status === "blocked")) return "blocked";
  if (checks.some((check) => check.status === "warning")) return "warning";
  if (checks.some((check) => check.status === "pending")) return "pending";
  return "pass";
}

function stage(
  id: ProjectWorkflowStage["id"],
  label: string,
  description: string,
  checks: ProjectWorkflowCheck[]
): ProjectWorkflowStage {
  return { id, label, description, status: aggregateStatus(checks), checks };
}

function summarizeAssets(assets: AssetEntry[]): ProjectAssetSummary {
  const byKind: ProjectAssetSummary["byKind"] = { image: 0, audio: 0, video: 0, model: 0, font: 0, other: 0 };
  let referenced = 0;
  let bytes = 0;
  for (const asset of assets) {
    byKind[asset.kind] += 1;
    bytes += asset.bytes;
    if (asset.status === "referenced") referenced += 1;
  }
  return {
    total: assets.length,
    referenced,
    unreferenced: Math.max(0, assets.length - referenced),
    bytes,
    byKind
  };
}

function evidenceFromInput(input: ProjectWorkflowInput, sidecars: string[]): ProjectWorkflowEvidence[] {
  const evidence: ProjectWorkflowEvidence[] = [];
  for (const filename of sidecars.slice(0, 4)) {
    let capturedAt: string | undefined;
    try { capturedAt = fs.statSync(filename).mtime.toISOString(); } catch { /* ignore */ }
    evidence.push({
      id: `sidecar:${filename}`,
      kind: "ui-sidecar",
      label: "UI 视觉旁路",
      detail: path.relative(input.projectRoot, filename).split(path.sep).join("/"),
      path: filename,
      capturedAt
    });
  }
  if (input.runtimeSnapshotPath) {
    evidence.push({
      id: `runtime:${input.runtimeSnapshotPath}`,
      kind: "runtime-snapshot",
      label: "Runtime 活树快照",
      detail: input.runtimeScene === "live" ? "已捕获游戏内活树" : "已捕获 Runtime 状态",
      path: input.runtimeSnapshotPath
    });
  }
  if (input.qrcodeUrl) {
    evidence.push({
      id: "qrcode",
      kind: "qrcode",
      label: "测试二维码",
      detail: "Maker 已生成测试入口"
    });
  }
  return evidence;
}

export function buildProjectWorkflowOverview(input: ProjectWorkflowInput): ProjectWorkflowOverview {
  const workflow = loadProjectWorkflow(input.projectRoot);
  const sidecars = walkFiles(input.projectRoot, (filename) => filename.endsWith(".ui.json"));
  const luaFiles = walkFiles(input.projectRoot, (filename) => filename.endsWith(".lua"));
  const assets = summarizeAssets(input.assets);
  const evidence = evidenceFromInput(input, sidecars);
  const projectJson = fs.existsSync(path.join(input.projectRoot, ".project", "project.json"));
  const devKit = fs.existsSync(path.join(input.projectRoot, "AGENTS.md")) || fs.existsSync(path.join(input.projectRoot, ".installer"));
  const previewConfigured = Boolean(input.previewPanel.url);

  const stages: ProjectWorkflowStage[] = [
    stage("environment", "环境", "确认官方 Maker 与本地 Git 工具链。", [
      {
        id: "maker-cli",
        label: "官方 Maker CLI",
        status: input.makerCli ? "pass" : "blocked",
        detail: input.makerCli ? `已发现 ${input.makerVersion || "Maker runtime"}` : "未发现 @taptap/maker runtime"
      },
      {
        id: "git",
        label: "Git 工作区",
        status: input.git ? "pass" : "blocked",
        detail: input.git ? `分支 ${input.git.branch}` : input.gitError || "无法读取 Git 状态"
      }
    ]),
    stage("project", "项目", "确认 Maker 绑定、项目元数据与 AI dev-kit。", [
      {
        id: "maker-binding",
        label: "Maker 项目绑定",
        status: input.makerBound ? "pass" : "blocked",
        detail: input.makerBound ? ".maker-mcp/config.json 已就绪" : "缺少 .maker-mcp/config.json",
        ...(input.makerCli ? { action: "doctor" as const, actionLabel: "运行 Doctor" } : {})
      },
      {
        id: "project-meta",
        label: "项目元数据",
        status: projectJson ? "pass" : "warning",
        detail: projectJson ? ".project/project.json 已就绪" : "尚未生成 Maker 项目元数据",
        action: "doctor",
        actionLabel: "检查项目"
      },
      {
        id: "dev-kit",
        label: "AI 开发约束",
        status: devKit ? "pass" : "pending",
        detail: devKit ? "已发现 AGENTS.md / dev-kit" : "未发现项目级 AI dev-kit"
      }
    ]),
    stage("content", "内容", "检查脚本、UI 结构与素材是否真正进入项目。", [
      {
        id: "lua",
        label: "Lua 内容",
        status: luaFiles.length ? "pass" : "blocked",
        detail: `${luaFiles.length} 个 Lua 文件`,
        action: "open-code",
        actionLabel: "查看代码"
      },
      {
        id: "ui-screens",
        label: "可视化界面",
        status: input.uiScreenCount ? "pass" : "warning",
        detail: `${input.uiScreenCount} 个可转换 UI 界面`,
        action: "open-design",
        actionLabel: "打开设计"
      },
      {
        id: "assets",
        label: "素材绑定",
        status: assets.total === 0 ? "pending" : assets.unreferenced > Math.max(3, assets.total / 2) ? "warning" : "pass",
        detail: assets.total === 0 ? "未发现游戏素材" : `${assets.referenced}/${assets.total} 项在源码或配置中被引用`
      }
    ]),
    stage("runtime", "运行", "用 LocalRuntime 与官方预览验证可玩状态。", [
      {
        id: "runtime-session",
        label: "Runtime 会话",
        status: input.runtimeSessionId ? "pass" : "pending",
        detail: input.runtimeSessionId ? `已连接 · ${input.runtimeScene || "idle"}` : "尚未连接 Runtime",
        action: "start-preview",
        actionLabel: input.runtimeSessionId ? "重新启动" : "启动预览"
      },
      {
        id: "preview-panel",
        label: "交互预览",
        status: previewConfigured ? "pass" : "pending",
        detail: previewConfigured ? `已配置 ${input.previewPanel.urlSource}` : "尚未配置可交互预览 URL",
        action: "open-preview",
        actionLabel: "打开预览"
      }
    ]),
    stage("evidence", "验证", "检查可编辑结构、运行状态和测试入口。", [
      {
        id: "ui-sidecar",
        label: "UI 结构旁路",
        status: sidecars.length ? "pass" : "pending",
        detail: sidecars.length ? `${sidecars.length} 个 .ui.json` : "尚未保存视觉旁路",
        action: "open-design",
        actionLabel: "编辑 UI"
      },
      {
        id: "runtime-snapshot",
        label: "Runtime 快照",
        status: input.runtimeSnapshotPath ? "pass" : "pending",
        detail: input.runtimeSnapshotPath ? "活树快照已落盘" : "尚未取得 Runtime 活树"
      },
      {
        id: "test-entry",
        label: "测试入口",
        status: input.qrcodeUrl ? "pass" : "pending",
        detail: input.qrcodeUrl ? "Maker 测试入口已生成" : "尚未生成测试二维码",
        action: "generate-qrcode",
        actionLabel: "生成二维码"
      }
    ]),
    stage("delivery", "交付", "在构建前检查本地变更和测试入口。", [
      {
        id: "git-clean",
        label: "变更可审查",
        status: !input.git ? "blocked" : input.git.dirty ? "warning" : "pass",
        detail: !input.git ? "Git 状态不可用" : input.git.dirty ? `${input.git.changes.length} 个未提交变更` : "工作区干净"
      },
      {
        id: "test-entry",
        label: "测试入口",
        status: input.qrcodeUrl ? "pass" : "pending",
        detail: input.qrcodeUrl ? "测试二维码已生成" : "尚未生成测试二维码",
        action: "generate-qrcode",
        actionLabel: "生成二维码"
      },
      {
        id: "remote-build",
        label: "远端构建",
        status: "pending",
        detail: "构建是显式交付动作，不会自动触发",
        action: "build",
        actionLabel: "开始构建"
      }
    ])
  ];

  const checks = stages.flatMap((item) => item.checks);
  const points: Record<ProjectWorkflowStatus, number> = { pass: 100, warning: 55, pending: 25, blocked: 0 };
  const score = checks.length ? Math.round(checks.reduce((sum, check) => sum + points[check.status], 0) / checks.length) : 0;
  const actionable = checks.find((check) => check.status === "blocked" && check.action)
    || checks.find((check) => check.status === "warning" && check.action)
    || checks.find((check) => check.status === "pending" && check.action);
  const status = aggregateStatus(checks);

  return {
    generatedAt: new Date().toISOString(),
    score,
    status,
    objective: workflow.objective || DEFAULT_OBJECTIVE,
    stages,
    evidence,
    assets,
    nextAction: actionable?.action ? {
      action: actionable.action,
      label: actionable.actionLabel || actionable.label,
      reason: actionable.detail
    } : undefined
  };
}
