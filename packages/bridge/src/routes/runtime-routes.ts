import { sendJson } from "../http-json.js";
import { readPreviewDirLogs } from "../ide-tools.js";
import { listPreviewSessions, type PidPresence } from "../runtime-file-channel.js";
import type { BridgeRoute } from "./route-table.js";

const RUNTIME_LOG_LINES = 300;

export function createRuntimeRoutes({ presence, currentProjectRoot }: {
  presence: (pid: number) => PidPresence;
  currentProjectRoot: () => string | undefined;
}): BridgeRoute[] {
  return [
    {
      method: "GET",
      path: "/api/runtimes",
      handle({ response }) {
        sendJson(response, 200, { sessions: listPreviewSessions(presence), currentProjectRoot: currentProjectRoot() ?? null });
      }
    },
    {
      method: "GET",
      path: "/api/runtimes/logs",
      handle({ response, url }) {
        const projectRoot = url.searchParams.get("projectRoot") ?? "";
        const session = listPreviewSessions(presence).find((candidate) => candidate.projectRoot === projectRoot);
        if (!session) {
          sendJson(response, 404, { error: "runtime_session_not_found" });
          return;
        }
        sendJson(response, 200, readPreviewDirLogs(session.previewDir, session.supervisorLogPath, RUNTIME_LOG_LINES));
      }
    }
  ];
}
