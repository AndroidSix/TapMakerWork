// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REQUIRED_MAKER_MCP_VERSION } from "@tapmakerwork/protocol";
import { renderHook } from "./render-hook";
import type { MakerVersionState, NodeVersionState } from "./types";
import { useMakerVersions } from "./use-maker-versions";

const makerState: MakerVersionState = {
  preference: { mode: "device" },
  active: { version: "0.0.30", entry: "/maker/0.0.30" },
  installed: [{ version: "0.0.30", entry: "/maker/0.0.30" }],
  channels: {
    stable: { installed: "0.0.30", latest: "0.0.35", updateAvailable: true },
    beta: { updateAvailable: false }
  }
};

const nodeState: NodeVersionState = {
  device: { version: "v22.11.0", executable: "/usr/bin/node" },
  embedded: { version: "v22.0.0", executable: "/app/node" },
  active: { version: "v22.11.0", executable: "/usr/bin/node", source: "device" },
  installed: [],
  stable: { latest: "v22.11.0", updateAvailable: false }
};

type Route = { status?: number; body: unknown };

function mockFetch(routes: Record<string, Route>) {
  const calls: Array<{ key: string; body?: unknown }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const key = `${init?.method ?? "GET"} ${url.pathname}${url.search}`;
    calls.push({ key, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    const route = routes[key];
    if (!route) throw new Error(`unexpected fetch ${key}`);
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
  }));
  return calls;
}

function setup(makerVersion?: string) {
  const deps = {
    toast: vi.fn(),
    refreshMakerHealth: vi.fn(async () => undefined),
    loadWorkflow: vi.fn(async () => undefined),
    setActiveTerminal: vi.fn()
  };
  const view = renderHook(() => useMakerVersions({ ...deps, makerVersion }));
  return { ...view, ...deps };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useMakerVersions", () => {
  it("checks maker and node updates together", async () => {
    mockFetch({
      "GET /api/maker/versions?refresh=1": { body: makerState },
      "GET /api/node/versions?refresh=1": { body: nodeState }
    });
    const { result, toast, unmount } = setup();
    await act(() => result.current.checkMakerUpdates());
    expect(result.current.makerVersions).toEqual(makerState);
    expect(result.current.nodeVersions).toEqual(nodeState);
    expect(result.current.makerVersionBusy).toBe("");
    expect(toast).toHaveBeenCalledWith("Maker MCP 与 Node.js 更新检查完成", "success");
    unmount();
  });

  it("reports the server error when the update check fails", async () => {
    mockFetch({
      "GET /api/maker/versions?refresh=1": { status: 502, body: { error: "registry timeout" } },
      "GET /api/node/versions?refresh=1": { body: nodeState }
    });
    const { result, toast, unmount } = setup();
    await act(() => result.current.checkMakerUpdates());
    expect(toast).toHaveBeenCalledWith("检查更新失败：registry timeout", "error");
    expect(result.current.makerVersions).toBeUndefined();
    unmount();
  });

  it("switches to device mode and refreshes health", async () => {
    const calls = mockFetch({ "POST /api/maker/version/select": { body: { ...makerState, preference: { mode: "device" } } } });
    const { result, toast, refreshMakerHealth, unmount } = setup();
    await act(() => result.current.selectMakerVersion("device"));
    expect(calls[0]?.body).toEqual({ mode: "device" });
    expect(refreshMakerHealth).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Maker MCP 已切换为 设备自动", "success");
    unmount();
  });

  it("does nothing when the channel install is not confirmed", async () => {
    const calls = mockFetch({ "GET /api/maker/versions?refresh=1": { body: makerState } });
    const confirm = vi.fn(() => false);
    Object.assign(window, { confirm });
    const { result, unmount } = setup();
    await act(() => result.current.installMakerChannel("stable"));
    expect(confirm).toHaveBeenCalledWith("安装 Maker MCP 0.0.35（稳定版）并立即切换？");
    expect(calls.map((call) => call.key)).toEqual(["GET /api/maker/versions?refresh=1"]);
    expect(result.current.makerVersionBusy).toBe("");
    unmount();
  });

  it("selects the required version when it is already installed", async () => {
    const installed = { ...makerState, installed: [...makerState.installed, { version: REQUIRED_MAKER_MCP_VERSION, entry: "/maker/required" }] };
    const calls = mockFetch({
      "GET /api/maker/versions": { body: installed },
      "POST /api/maker/version/select": { body: { ...installed, active: { version: REQUIRED_MAKER_MCP_VERSION, entry: "/maker/required" } } }
    });
    const { result, loadWorkflow, unmount } = setup("0.0.30");
    await act(() => result.current.installRequiredMakerMcp());
    expect(calls.at(-1)).toEqual({ key: "POST /api/maker/version/select", body: { mode: "version", version: REQUIRED_MAKER_MCP_VERSION } });
    expect(loadWorkflow).toHaveBeenCalled();
    unmount();
  });

  it("installs the required version when it is missing", async () => {
    const calls = mockFetch({
      "GET /api/maker/versions": { body: makerState },
      "POST /api/maker/version/install": { body: makerState }
    });
    const { result, toast, unmount } = setup("0.0.30");
    await act(() => result.current.installRequiredMakerMcp());
    expect(calls.at(-1)).toEqual({ key: "POST /api/maker/version/install", body: { version: REQUIRED_MAKER_MCP_VERSION } });
    expect(toast).toHaveBeenLastCalledWith(`Maker MCP ${REQUIRED_MAKER_MCP_VERSION} 已安装并切换`, "success");
    unmount();
  });

  it("upgrades node in the build terminal and shows failures verbatim", async () => {
    mockFetch({ "POST /api/node/upgrade": { status: 400, body: { error: "请在终端执行 nvm install --lts" } } });
    const { result, toast, setActiveTerminal, unmount } = setup();
    await act(() => result.current.upgradeSystemNode());
    expect(setActiveTerminal).toHaveBeenCalledWith("build");
    expect(toast).toHaveBeenCalledWith("请在终端执行 nvm install --lts", "error");
    expect(result.current.makerVersionBusy).toBe("");
    unmount();
  });

  it("syncs the system node and the maker state it returns", async () => {
    mockFetch({ "POST /api/node/version/sync": { body: { ...nodeState, maker: makerState } } });
    const { result, toast, unmount } = setup();
    await act(() => result.current.syncSystemNode());
    expect(result.current.nodeVersions?.active.version).toBe("v22.11.0");
    expect(result.current.makerVersions).toEqual(makerState);
    expect(toast).toHaveBeenCalledWith("已同步系统 Node.js v22.11.0", "success");
    unmount();
  });
});
