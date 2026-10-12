import {
  buildAssetSizeReport,
  listTrashedAssets,
  moveUnreferencedAssetsToTrash,
  purgeTrashedAssets,
  restoreTrashedAssets
} from "../asset-trash.js";
import { readJson, sendJson } from "../http-json.js";
import { listProjectAssets } from "../ide-tools.js";
import type { BridgeRoute } from "./route-table.js";

function stringList(value: unknown, error: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error(error);
  return value;
}

export function createAssetRoutes({ projectRoot }: { projectRoot: () => string | undefined }): BridgeRoute[] {
  const requireRoot = () => {
    const root = projectRoot();
    if (!root) throw new Error("project_not_open");
    return root;
  };
  return [
    {
      method: "GET",
      path: "/api/assets/report",
      handle({ response }) {
        const root = requireRoot();
        const trash = listTrashedAssets(root);
        sendJson(response, 200, { report: buildAssetSizeReport(listProjectAssets(root), trash), trash });
      }
    },
    {
      method: "POST",
      path: "/api/assets/trash",
      async handle({ request, response }) {
        const root = requireRoot();
        const body = await readJson(request) as { paths?: unknown };
        const paths = stringList(body.paths, "asset_paths_required");
        sendJson(response, 200, moveUnreferencedAssetsToTrash(root, listProjectAssets(root), paths));
      }
    },
    {
      method: "POST",
      path: "/api/assets/restore",
      async handle({ request, response }) {
        const body = await readJson(request) as { ids?: unknown };
        sendJson(response, 200, restoreTrashedAssets(requireRoot(), stringList(body.ids, "trash_ids_required")));
      }
    },
    {
      method: "POST",
      path: "/api/assets/purge",
      async handle({ request, response }) {
        const body = await readJson(request) as { ids?: unknown };
        sendJson(response, 200, { purged: purgeTrashedAssets(requireRoot(), stringList(body.ids, "trash_ids_required")) });
      }
    }
  ];
}
