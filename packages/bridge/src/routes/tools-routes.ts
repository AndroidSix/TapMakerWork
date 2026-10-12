import path from "node:path";
import type { BridgeEvent } from "@tapmakerwork/protocol";
import { loadCommunityConfig } from "../community-config.js";
import { readJson, sendJson } from "../http-json.js";
import {
  imageCompressPublicSettings,
  readImageCompressSettings,
  resolveDefaultCompressTarget,
  runImageCompress,
  writeImageCompressSettings,
  type ImageCompressProgress,
  type ImageCompressSettings
} from "../image-compress.js";
import {
  emptyDailyReport,
  emptyRadarSnapshot,
  fetchLatestRadarSnapshot,
  getDailyLaunchReport,
  loadRadarSnapshot,
  proxyTapIcon,
  readOfflineSnapshot
} from "../new-game-radar.js";
import type { BridgeRoute } from "./route-table.js";

export interface ToolsRouteContext {
  projectRoot: () => string | undefined;
  broadcast: (event: BridgeEvent) => void;
}

export function createToolsRoutes({ projectRoot, broadcast }: ToolsRouteContext): BridgeRoute[] {
  let imageCompressJob: { progress: ImageCompressProgress; controller: AbortController } | undefined;

  function startImageCompressJob(target: string, recursive: boolean): ImageCompressProgress {
    const controller = new AbortController();
    const job = {
      controller,
      progress: { ok: false, state: "running", target: path.resolve(target), total: 0, processed: 0, compressed: 0, skipped: 0, failed: 0, savedBytes: 0, tinyEnabled: false, keyCount: 0, engine: "", files: [], aiCopyText: "", startedAt: new Date().toISOString() } as ImageCompressProgress
    };
    imageCompressJob = job;
    broadcast({ type: "log.append", channel: "build", lines: [`图片压缩开始：${job.progress.target}`] });
    void runImageCompress({
      target,
      recursive,
      signal: controller.signal,
      onProgress: (progress) => {
        const finished = progress.files.at(-1);
        if (finished?.error && progress.files.length > job.progress.files.length) {
          broadcast({ type: "log.append", channel: "build", lines: [`压缩失败：${path.relative(progress.target, finished.path) || finished.path} · ${finished.error}`] });
        }
        job.progress = progress;
      }
    }).then((result) => {
      const summary = result.state === "failed"
        ? `图片压缩失败：${result.error}`
        : `图片压缩${result.state === "cancelled" ? "已停止" : "完成"}：处理 ${result.processed}/${result.total}，压缩 ${result.compressed}，跳过 ${result.skipped}，失败 ${result.failed}，节省 ${(result.savedBytes / 1024).toFixed(1)} KB`;
      broadcast({ type: "log.append", channel: "build", lines: [summary] });
    }).catch((error: unknown) => {
      job.progress = { ...job.progress, state: "failed", error: error instanceof Error ? error.message : String(error), finishedAt: new Date().toISOString() };
    });
    return job.progress;
  }

  return [
    {
      method: "GET",
      path: "/api/community",
      async handle({ response, url }) {
        const force = url.searchParams.get("force") === "1";
        sendJson(response, 200, { community: await loadCommunityConfig(force) });
      }
    },
    {
      method: "GET",
      path: "/api/tools/image-compress/job",
      handle({ response }) {
        sendJson(response, 200, { job: imageCompressJob?.progress ?? null });
      }
    },
    {
      method: "GET",
      path: "/api/tools/image-compress",
      handle({ response, url }) {
        const settings = imageCompressPublicSettings();
        const stored = readImageCompressSettings();
        const projectRootParam = url.searchParams.get("projectRoot") || projectRoot();
        const defaultTarget = projectRootParam ? resolveDefaultCompressTarget(projectRootParam) : "";
        sendJson(response, 200, {
          settings,
          keysText: stored.tinyKeys.join("\n"),
          defaultTarget
        });
      }
    },
    {
      method: "POST",
      path: "/api/tools/image-compress",
      async handle({ request, response }) {
        const body = await readJson(request) as {
          action?: string;
          tinyEnabled?: boolean;
          useWebFallback?: boolean;
          tinyKeys?: string[];
          target?: string;
          projectRoot?: string;
          recursive?: boolean;
        };
        if (body.action === "save-settings") {
          const patch: Partial<ImageCompressSettings> = {
            tinyEnabled: Boolean(body.tinyEnabled),
            useWebFallback: body.useWebFallback !== false
          };
          if (Array.isArray(body.tinyKeys)) patch.tinyKeys = body.tinyKeys.map(String);
          const saved = writeImageCompressSettings(patch);
          sendJson(response, 200, {
            settings: imageCompressPublicSettings(),
            keysText: saved.tinyKeys.join("\n")
          });
        } else if (body.action === "run") {
          const target = typeof body.target === "string" ? body.target.trim() : "";
          if (!target) {
            sendJson(response, 400, { error: "target_required" });
          } else if (imageCompressJob?.progress.state === "running") {
            sendJson(response, 409, { error: "已有压缩任务在进行中", job: imageCompressJob.progress });
          } else {
            sendJson(response, 202, { job: startImageCompressJob(target, body.recursive !== false) });
          }
        } else if (body.action === "cancel") {
          imageCompressJob?.controller.abort();
          sendJson(response, 200, { job: imageCompressJob?.progress ?? null });
        } else {
          sendJson(response, 400, { error: "unknown_action" });
        }
      }
    },
    {
      method: "GET",
      path: "/api/tools/new-game-radar/icon",
      async handle({ response, url }) {
        const iconUrl = url.searchParams.get("url") || "";
        try {
          const image = await proxyTapIcon(iconUrl);
          response.writeHead(200, {
            "content-type": image.contentType,
            "cache-control": "public, max-age=86400",
            "access-control-allow-origin": "*"
          });
          response.end(image.body);
        } catch (error) {
          sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
        }
      }
    },
    {
      method: "GET",
      path: "/api/tools/new-game-radar",
      async handle({ response, url }) {
        const mode = url.searchParams.get("mode") === "offline" ? "offline" : "auto";
        try {
          if (mode === "offline") {
            const offline = readOfflineSnapshot();
            sendJson(response, 200, { snapshot: offline || emptyRadarSnapshot("尚无离线快照，请先获取最新排行") });
          } else {
            const offline = readOfflineSnapshot();
            if (offline) {
              sendJson(response, 200, { snapshot: offline });
            } else {
              const snapshot = await fetchLatestRadarSnapshot();
              sendJson(response, 200, { snapshot });
            }
          }
        } catch (error) {
          sendJson(response, 502, {
            snapshot: emptyRadarSnapshot(error instanceof Error ? error.message : String(error)),
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    },
    {
      method: "POST",
      path: "/api/tools/new-game-radar",
      async handle({ request, response }) {
        const body = await readJson(request) as {
          action?: string;
          from?: string;
          to?: string;
          refresh?: boolean;
        };
        try {
          if (body.action === "refresh") {
            const snapshot = await fetchLatestRadarSnapshot();
            sendJson(response, 200, { snapshot });
          } else if (body.action === "offline") {
            const offline = readOfflineSnapshot();
            sendJson(response, 200, { snapshot: offline || emptyRadarSnapshot("尚无离线快照") });
          } else if (body.action === "auto") {
            const snapshot = await loadRadarSnapshot(false);
            sendJson(response, 200, { snapshot });
          } else if (body.action === "daily") {
            const report = await getDailyLaunchReport({
              ...(typeof body.from === "string" ? { from: body.from } : {}),
              ...(typeof body.to === "string" ? { to: body.to } : {}),
              refresh: body.refresh === true
            });
            sendJson(response, 200, { report });
          } else {
            sendJson(response, 400, { error: "unknown_action" });
          }
        } catch (error) {
          if (body.action === "daily") {
            sendJson(response, 502, {
              report: emptyDailyReport(
                error instanceof Error ? error.message : String(error),
                typeof body.from === "string" ? body.from : undefined,
                typeof body.to === "string" ? body.to : undefined
              ),
              error: error instanceof Error ? error.message : String(error)
            });
            return;
          }
          const offline = readOfflineSnapshot();
          sendJson(response, offline ? 200 : 502, {
            snapshot: offline
              ? { ...offline, error: error instanceof Error ? error.message : String(error) }
              : emptyRadarSnapshot(error instanceof Error ? error.message : String(error)),
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
  ];
}
