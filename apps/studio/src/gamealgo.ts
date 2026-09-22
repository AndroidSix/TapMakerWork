import { GameAlgoWebClient } from "@gamealgo/web";

const DOMESTIC_BASE_URL = "https://game-algo-sdk.dictapis.cn";

const MILESTONES: Record<string, { milestoneType: string; milestonePoint: string }> = {
  "project.open": { milestoneType: "global", milestonePoint: "打开项目" },
  "live_edit.enter": { milestoneType: "global", milestonePoint: "进入实时编辑" },
  "adapter.install": { milestoneType: "global", milestonePoint: "安装运行时适配器" },
  "eula.accept": { milestoneType: "new_user", milestonePoint: "接受用户协议" }
};

let client: GameAlgoWebClient | undefined;
let enabled = false;
let lastError: string | undefined;

export function gameAlgoStatus(): { ready: boolean; enabled: boolean; error?: string } {
  return {
    ready: Boolean(client),
    enabled,
    ...(lastError ? { error: lastError } : {})
  };
}

export async function initStudioGameAlgo(options: {
  enabled: boolean;
  gameKey: string;
  appVersion: string;
  isDebug?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  enabled = Boolean(options.enabled);
  if (!enabled) {
    client?.close();
    client = undefined;
    lastError = undefined;
    return { ok: true };
  }
  const gameKey = options.gameKey.trim();
  if (!gameKey.startsWith("ga_live_")) {
    lastError = "missing_gamealgo_client_key";
    return { ok: false, error: lastError };
  }
  if (client) return { ok: true };
  try {
    client = GameAlgoWebClient.init({
      baseUrl: DOMESTIC_BASE_URL,
      gameKey,
      appVersion: options.appVersion,
      experimentIntegrationVersion: 0,
      isDebug: Boolean(options.isDebug),
      // IDE 默认不上报完整打开 URL；需要投放归因时再在设置中打开。
      autoUrlAttribution: false
    });
    void client.waitForReady(1500).catch(() => undefined);
    client.tracker.track("milestone", {
      milestoneType: "new_user",
      milestonePoint: "启动 IDE"
    });
    lastError = undefined;
    return { ok: true };
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    client = undefined;
    return { ok: false, error: lastError };
  }
}

export function trackStudioGameAlgo(name: string, props?: Record<string, unknown>): void {
  if (!enabled || !client) return;
  const milestone = MILESTONES[name];
  if (milestone) {
    client.tracker.track("milestone", milestone);
    return;
  }
  const payload: Record<string, string | number | boolean | null> = {};
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        payload[key] = typeof value === "string" ? value.slice(0, 120) : value;
      }
    }
  }
  // Custom IDE events → `_project_open` style names via trackEvent.
  const type = name.replace(/\./g, "_").replace(/^_+/, "");
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(type)) return;
  client.tracker.trackEvent(type, payload);
}

export async function flushStudioGameAlgo(): Promise<void> {
  if (!client) return;
  await client.flush().catch(() => undefined);
}

export function setStudioGameAlgoEnabled(next: boolean): void {
  enabled = next;
  if (!next) {
    void flushStudioGameAlgo();
    client?.close();
    client = undefined;
  }
}
