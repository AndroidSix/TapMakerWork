import { useCallback, useState } from "react";
import { REQUIRED_MAKER_MCP_VERSION, isRequiredMakerMcpVersion, type LogChannel } from "@tapmakerwork/protocol";
import { API } from "../bridge-api";
import type { MakerRuntimeMode, MakerVersionBusy, MakerVersionState, NodeVersionState, ToastKind } from "./types";

export function useMakerVersions({ toast, makerVersion, refreshMakerHealth, loadWorkflow, setActiveTerminal }: {
  toast: (message: string, kind?: ToastKind) => void;
  makerVersion: string | undefined;
  refreshMakerHealth: () => Promise<void>;
  loadWorkflow: () => Promise<void>;
  setActiveTerminal: (channel: LogChannel) => void;
}) {
  const [makerVersions, setMakerVersions] = useState<MakerVersionState>();
  const [nodeVersions, setNodeVersions] = useState<NodeVersionState>();
  const [makerVersionBusy, setMakerVersionBusy] = useState<MakerVersionBusy>("");

  const checkMakerUpdates = useCallback(async () => {
    setMakerVersionBusy("check");
    try {
      const [makerResponse, nodeResponse] = await Promise.all([
        fetch(`${API}/api/maker/versions?refresh=1`),
        fetch(`${API}/api/node/versions?refresh=1`)
      ]);
      const makerResult = await makerResponse.json() as MakerVersionState & { error?: string };
      const nodeResult = await nodeResponse.json() as NodeVersionState & { error?: string };
      if (!makerResponse.ok) throw new Error(makerResult.error || "无法连接 Maker 版本服务");
      if (!nodeResponse.ok) throw new Error(nodeResult.error || "无法连接 Node.js 版本服务");
      setMakerVersions(makerResult);
      setNodeVersions(nodeResult);
      toast("Maker MCP 与 Node.js 更新检查完成", "success");
    } catch (error) {
      toast(`检查更新失败：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setMakerVersionBusy("");
    }
  }, [toast]);

  const selectMakerVersion = useCallback(async (mode: MakerRuntimeMode, version?: string) => {
    setMakerVersionBusy("switch");
    try {
      const response = await fetch(`${API}/api/maker/version/select`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, version })
      });
      const result = await response.json() as MakerVersionState & { error?: string };
      if (!response.ok) throw new Error(result.error || "切换失败");
      setMakerVersions(result);
      await refreshMakerHealth();
      const selected = mode === "device" ? "设备自动" : result.active?.version || version || mode;
      toast(`Maker MCP 已切换为 ${selected}`, "success");
    } catch (error) {
      toast(`切换 Maker MCP 失败：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setMakerVersionBusy("");
    }
  }, [refreshMakerHealth, toast]);

  const installMakerChannel = useCallback(async (channel: "stable" | "beta", options?: { confirm?: boolean }) => {
    const needsConfirm = options?.confirm !== false;
    let target = makerVersions?.channels[channel].latest;
    if (!target) {
      try {
        const refresh = await fetch(`${API}/api/maker/versions?refresh=1`);
        if (refresh.ok) {
          const versions = await refresh.json() as MakerVersionState;
          setMakerVersions(versions);
          target = versions.channels[channel].latest;
        }
      } catch {
        // fall through to missing-version toast
      }
    }
    if (!target) {
      toast("无法获取可安装的 Maker 版本，请检查网络后重试", "warn");
      return;
    }
    const label = channel === "stable" ? "稳定版" : "Beta 版";
    if (needsConfirm && !window.confirm(`安装 Maker MCP ${target}（${label}）并立即切换？`)) return;
    setMakerVersionBusy(channel);
    try {
      toast(`正在安装 Maker MCP ${target}（${label}）…`, "info");
      const response = await fetch(`${API}/api/maker/version/install`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel })
      });
      const result = await response.json() as MakerVersionState & { error?: string };
      if (!response.ok) throw new Error(result.error || "安装失败");
      setMakerVersions(result);
      await refreshMakerHealth();
      toast(`Maker MCP ${target} 安装完成并已切换`, "success");
    } catch (error) {
      toast(`安装 Maker MCP 失败：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setMakerVersionBusy("");
    }
  }, [makerVersions, refreshMakerHealth, toast]);

  const installRequiredMakerMcp = useCallback(async () => {
    const current = makerVersion;
    if (isRequiredMakerMcpVersion(current)) {
      await installMakerChannel(current.includes("-") ? "beta" : "stable", { confirm: false });
      await loadWorkflow();
      return;
    }
    let installed = makerVersions?.installed.some((item) => item.version === REQUIRED_MAKER_MCP_VERSION) ?? false;
    if (!installed) {
      try {
        const listed = await fetch(`${API}/api/maker/versions`);
        if (listed.ok) {
          const versions = await listed.json() as MakerVersionState;
          setMakerVersions(versions);
          installed = versions.installed.some((item) => item.version === REQUIRED_MAKER_MCP_VERSION);
        }
      } catch {
        installed = false;
      }
    }
    if (installed) {
      await selectMakerVersion("version", REQUIRED_MAKER_MCP_VERSION);
      await loadWorkflow();
      return;
    }
    setMakerVersionBusy("stable");
    try {
      toast(`正在安装 Maker MCP ${REQUIRED_MAKER_MCP_VERSION}…`, "info");
      const response = await fetch(`${API}/api/maker/version/install`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: REQUIRED_MAKER_MCP_VERSION })
      });
      const result = await response.json() as MakerVersionState & { error?: string };
      if (!response.ok) throw new Error(result.error || "安装失败");
      setMakerVersions(result);
      await refreshMakerHealth();
      await loadWorkflow();
      toast(`Maker MCP ${REQUIRED_MAKER_MCP_VERSION} 已安装并切换`, "success");
    } catch (error) {
      toast(`安装 Maker MCP 失败：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setMakerVersionBusy("");
    }
  }, [makerVersion, installMakerChannel, loadWorkflow, makerVersions, refreshMakerHealth, selectMakerVersion, toast]);

  const syncSystemNode = useCallback(async () => {
    setMakerVersionBusy("node");
    try {
      const response = await fetch(`${API}/api/node/version/sync`, { method: "POST" });
      const result = await response.json() as NodeVersionState & { error?: string; maker?: MakerVersionState };
      if (!response.ok) throw new Error(result.error || "系统 Node.js 同步失败");
      setNodeVersions(result);
      if (result.maker) setMakerVersions(result.maker);
      await refreshMakerHealth();
      toast(`已同步系统 Node.js ${result.active.version}`, "success");
    } catch (error) {
      toast(`同步 Node.js 失败：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setMakerVersionBusy("");
    }
  }, [refreshMakerHealth, toast]);

  const upgradeSystemNode = useCallback(async () => {
    setMakerVersionBusy("node-upgrade");
    setActiveTerminal("build");
    try {
      const response = await fetch(`${API}/api/node/upgrade`, { method: "POST" });
      const result = await response.json() as NodeVersionState & { error?: string; maker?: MakerVersionState };
      if (!response.ok) throw new Error(result.error || "Node.js 升级失败");
      setNodeVersions(result);
      if (result.maker) setMakerVersions(result.maker);
      await refreshMakerHealth();
      toast(`Node.js 已升级到 ${result.active.version}`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setMakerVersionBusy("");
    }
  }, [refreshMakerHealth, toast]);

  return {
    makerVersions,
    setMakerVersions,
    nodeVersions,
    setNodeVersions,
    makerVersionBusy,
    checkMakerUpdates,
    selectMakerVersion,
    installMakerChannel,
    installRequiredMakerMcp,
    syncSystemNode,
    upgradeSystemNode
  };
}
