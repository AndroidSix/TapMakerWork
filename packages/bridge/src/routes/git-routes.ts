import type { BridgeEvent } from "@tapmakerwork/protocol";
import { readJson, sendJson } from "../http-json.js";
import { commitGitProject, mutateGitProject, pullGitProject, readGitDiff, readGitStatus } from "../ide-tools.js";
import { readMakerProjectMeta, runMakerBuild, runMakerCommand, type MakerRuntime } from "../maker.js";
import type { AccountResolution } from "../maker-accounts.js";
import { bumpPreviewReload } from "../preview-panel.js";
import type { ProjectBinding } from "../project.js";
import type { BridgeRoute } from "./route-table.js";

export interface GitRouteContext {
  broadcast: (event: BridgeEvent) => void;
  currentProject: () => ProjectBinding | undefined;
  currentMakerRuntime: () => MakerRuntime | undefined;
  freshAccount: (projectRoot: string, channel: "runtime" | "build" | "qrcode") => Promise<AccountResolution>;
  previewHome: (projectRoot: string) => Promise<string>;
}

export function createGitRoutes({ broadcast, currentProject, currentMakerRuntime, freshAccount, previewHome }: GitRouteContext): BridgeRoute[] {
  return [
    {
      method: "GET",
      path: "/api/git/status",
      async handle({ response }) {
        const project = currentProject();
        if (!project) throw new Error("project_not_open");
        sendJson(response, 200, await readGitStatus(project.root));
      }
    },
    {
      method: "GET",
      path: "/api/git/diff",
      async handle({ response, url }) {
        const project = currentProject();
        if (!project) throw new Error("project_not_open");
        const filePath = url.searchParams.get("path") || "";
        const scope = url.searchParams.get("scope") === "staged" ? "staged" : "worktree";
        if (!filePath) throw new Error("git_path_required");
        sendJson(response, 200, await readGitDiff(project.root, filePath, scope));
      }
    },
    {
      method: "POST",
      path: "/api/git/pull",
      async handle({ response }) {
        const project = currentProject();
        if (!project) throw new Error("project_not_open");
        const result = await pullGitProject(project.root);
        broadcast({ type: "log.append", channel: "build", lines: [result.ok ? "Git 拉取完成。" : `Git 拉取停止：${result.error || "unknown"}`] });
        sendJson(response, result.ok ? 200 : 409, result);
      }
    },
    {
      method: "POST",
      path: "/api/git/mutate",
      async handle({ request, response }) {
        const project = currentProject();
        if (!project) throw new Error("project_not_open");
        const body = await readJson(request) as { action?: "stage" | "unstage" | "discard" | "stage-all" | "unstage-all" | "discard-all"; path?: string };
        if (!body.action) throw new Error("git_action_required");
        const result = await mutateGitProject(project.root, body.action, body.path);
        broadcast({ type: "log.append", channel: "build", lines: [`Git ${body.action}${body.path ? `：${body.path}` : ""}`] });
        sendJson(response, 200, result);
      }
    },
    {
      method: "POST",
      path: "/api/git/commit",
      async handle({ request, response }) {
        const project = currentProject();
        const makerRuntime = currentMakerRuntime();
        if (!project) throw new Error("project_not_open");
        const body = await readJson(request) as { message?: string; push?: boolean; remoteBuild?: boolean };
        const result = await commitGitProject(project.root, body.message || "", Boolean(body.push));
        if (!result.ok) {
          broadcast({ type: "log.append", channel: "build", lines: [`Git 提交停止：${result.error || "unknown"}`] });
          sendJson(response, 409, result);
        } else if (body.remoteBuild) {
          if (!body.push) throw new Error("remote_build_requires_push");
          if (!makerRuntime) throw new Error("maker_cli_not_found");
          broadcast({ type: "log.append", channel: "build", lines: ["Git 已推送，开始调用 Maker MCP 远端构建并刷新预览…"] });
          try {
            const account = await freshAccount(project.root, "build");
            const build = await runMakerBuild(makerRuntime, project.root, undefined, account.home);
            let previewRefresh: { ok: boolean; error?: string } = { ok: true };
            try {
              await runMakerCommand(makerRuntime, project.root, "refresh", 45_000, await previewHome(project.root));
            } catch (refreshError) {
              previewRefresh = { ok: false, error: refreshError instanceof Error ? refreshError.message : String(refreshError) };
            }
            const panel = bumpPreviewReload(project.root, {}, readMakerProjectMeta(project.root));
            broadcast({ type: "preview.panel", panel, reason: "git-remote-build" });
            broadcast({
              type: "log.append",
              channel: "build",
              lines: [
                "Maker MCP 远端构建完成。",
                previewRefresh.ok ? "Maker Runtime / Web 预览刷新完成。" : `构建成功，但 Runtime 刷新未完成：${previewRefresh.error}`,
                JSON.stringify(build).slice(0, 4000)
              ]
            });
            sendJson(response, 200, { ...result, remoteBuild: { ok: true, result: build, previewRefresh }, panel });
          } catch (buildError) {
            const message = buildError instanceof Error ? buildError.message : String(buildError);
            broadcast({ type: "log.append", channel: "build", lines: [`Git 已推送，但 Maker MCP 远端构建失败：${message}`] });
            sendJson(response, 502, { ...result, remoteBuild: { ok: false, error: message } });
          }
        } else {
          broadcast({ type: "log.append", channel: "build", lines: [body.push ? "Git 提交并推送完成。" : "Git 本地提交完成。"] });
          sendJson(response, 200, result);
        }
      }
    }
  ];
}
