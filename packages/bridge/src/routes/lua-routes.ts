import { readJson, sendJson } from "../http-json.js";
import { diagnoseLuaSource, indexProjectLuaSymbols } from "../lua-symbols.js";
import type { BridgeRoute } from "./route-table.js";

const MAX_DIAGNOSE_BYTES = 4_000_000;

export function createLuaRoutes({ projectRoot }: { projectRoot: () => string | undefined }): BridgeRoute[] {
  return [
    {
      method: "GET",
      path: "/api/lua/symbols",
      handle({ response }) {
        const root = projectRoot();
        if (!root) throw new Error("project_not_open");
        sendJson(response, 200, { symbols: indexProjectLuaSymbols(root) });
      }
    },
    {
      method: "POST",
      path: "/api/lua/diagnostics",
      async handle({ request, response }) {
        const body = await readJson(request, MAX_DIAGNOSE_BYTES) as { source?: unknown };
        if (typeof body.source !== "string") throw new Error("lua_source_required");
        sendJson(response, 200, { diagnostics: diagnoseLuaSource(body.source) });
      }
    }
  ];
}
