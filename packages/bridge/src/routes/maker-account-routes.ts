import type { BridgeEvent } from "@tapmakerwork/protocol";
import { readJson, sendJson } from "../http-json.js";
import { runMakerLogin, type MakerRuntime } from "../maker.js";
import {
  activateGlobalMakerHome,
  addMakerAccount,
  clearMakerAppsCache,
  getMakerAccount,
  makerAccountSnapshot,
  MAKER_CONSOLE_URL,
  projectAccountKey,
  removeMakerAccount,
  renameMakerAccount,
  setGlobalMakerAccount,
  setProjectMakerAccount,
  type AccountResolution,
  type MakerAccountMode
} from "../maker-accounts.js";
import type { BridgeRoute } from "./route-table.js";

export interface MakerAccountRouteContext {
  broadcast: (event: BridgeEvent) => void;
  currentMakerRuntime: () => MakerRuntime | undefined;
  resolveAccountsProjectRoot: (candidate?: string | null) => string | undefined;
  accountFor: (projectRoot: string) => Promise<AccountResolution>;
  previewAccountHomes: Map<string, string>;
}

export function createMakerAccountRoutes({
  broadcast,
  currentMakerRuntime,
  resolveAccountsProjectRoot,
  accountFor,
  previewAccountHomes
}: MakerAccountRouteContext): BridgeRoute[] {
  return [
    {
      method: "GET",
      path: "/api/maker/accounts",
      async handle({ response, url }) {
        const activation = activateGlobalMakerHome();
        const root = resolveAccountsProjectRoot(url.searchParams.get("projectRoot"));
        const resolution = root ? await accountFor(root) : undefined;
        sendJson(response, 200, {
          ...makerAccountSnapshot(root, resolution, activation),
          consoleUrl: MAKER_CONSOLE_URL
        });
      }
    },
    {
      method: "POST",
      path: "/api/maker/accounts",
      async handle({ request, response }) {
        const body = await readJson(request) as { label?: string; projectRoot?: string };
        const created = addMakerAccount(typeof body.label === "string" ? body.label : "");
        const activation = activateGlobalMakerHome();
        const root = resolveAccountsProjectRoot(body.projectRoot);
        sendJson(response, 200, {
          ok: true,
          account: { id: created.id, label: created.label },
          ...makerAccountSnapshot(root, undefined, activation),
          consoleUrl: MAKER_CONSOLE_URL
        });
      }
    },
    {
      method: "POST",
      path: "/api/maker/accounts/global",
      async handle({ request, response }) {
        const body = await readJson(request) as { accountId?: string; projectRoot?: string };
        if (!body.accountId) throw new Error("maker_account_not_found");
        const activation = setGlobalMakerAccount(body.accountId);
        previewAccountHomes.clear();
        const root = resolveAccountsProjectRoot(body.projectRoot);
        const resolution = root ? await accountFor(root) : undefined;
        broadcast({
          type: "log.append",
          channel: "build",
          lines: [`全局账号已切换并同步本机 ~/.taptap-maker → ${activation.activatedHome}`]
        });
        sendJson(response, 200, {
          ok: true,
          ...makerAccountSnapshot(root, resolution, activation),
          consoleUrl: MAKER_CONSOLE_URL
        });
      }
    },
    {
      method: "POST",
      path: "/api/maker/accounts/rename",
      async handle({ request, response }) {
        const body = await readJson(request) as { accountId?: string; label?: string; projectRoot?: string };
        if (!body.accountId) throw new Error("maker_account_not_found");
        renameMakerAccount(body.accountId, body.label || "");
        const root = resolveAccountsProjectRoot(body.projectRoot);
        sendJson(response, 200, { ok: true, ...makerAccountSnapshot(root), consoleUrl: MAKER_CONSOLE_URL });
      }
    },
    {
      method: "POST",
      path: "/api/maker/accounts/remove",
      async handle({ request, response }) {
        const body = await readJson(request) as { accountId?: string; projectRoot?: string };
        if (!body.accountId) throw new Error("maker_account_not_found");
        const activation = removeMakerAccount(body.accountId) ?? activateGlobalMakerHome();
        previewAccountHomes.clear();
        const root = resolveAccountsProjectRoot(body.projectRoot);
        const resolution = root ? await accountFor(root) : undefined;
        sendJson(response, 200, {
          ok: true,
          ...makerAccountSnapshot(root, resolution, activation),
          consoleUrl: MAKER_CONSOLE_URL
        });
      }
    },
    {
      method: "POST",
      path: "/api/maker/accounts/project",
      async handle({ request, response }) {
        const body = await readJson(request) as { mode?: MakerAccountMode; accountId?: string; projectRoot?: string };
        if (body.mode !== "auto" && body.mode !== "manual") throw new Error("maker_account_mode_invalid");
        const root = resolveAccountsProjectRoot(body.projectRoot);
        if (!root) throw new Error("project_not_open");
        setProjectMakerAccount(root, body.mode, body.accountId);
        clearMakerAppsCache();
        previewAccountHomes.delete(projectAccountKey(root));
        const resolution = await accountFor(root);
        broadcast({
          type: "log.append",
          channel: "build",
          lines: [
            body.mode === "manual"
              ? `项目已指定账号「${resolution.label}」（${root}）`
              : `项目已改回自动核对（当前解析为「${resolution.label}」）`
          ]
        });
        sendJson(response, 200, { ok: true, ...makerAccountSnapshot(root, resolution) });
      }
    },
    {
      method: "POST",
      path: "/api/maker/accounts/login",
      async handle({ request, response }) {
        const makerRuntime = currentMakerRuntime();
        if (!makerRuntime) throw new Error("maker_cli_not_found");
        const body = await readJson(request) as { accountId?: string; projectRoot?: string };
        if (!body.accountId) throw new Error("maker_account_not_found");
        const target = getMakerAccount(body.accountId);
        if (!target) throw new Error("maker_account_not_found");
        const root = resolveAccountsProjectRoot(body.projectRoot);
        const cwd = root ?? target.home;
        broadcast({ type: "log.append", channel: "build", lines: [`正在用无痕窗口打开登录页，请登录账号「${target.label}」并创建 token。`] });
        try {
          await runMakerLogin(makerRuntime, cwd, target.home);
          clearMakerAppsCache();
          broadcast({ type: "log.append", channel: "build", lines: [`账号「${target.label}」登录完成。`] });
          const resolution = root ? await accountFor(root) : undefined;
          sendJson(response, 200, { ok: true, ...makerAccountSnapshot(root, resolution) });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          broadcast({ type: "log.append", channel: "build", lines: [`账号「${target.label}」登录失败：${message}`] });
          sendJson(response, 400, { error: message });
        }
      }
    }
  ];
}
