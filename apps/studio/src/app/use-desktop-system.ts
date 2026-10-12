import { useCallback, useEffect, useState } from "react";
import type {
  DesktopHardwareAccelerationState,
  DesktopLegalState,
  DesktopPermissionState,
  DesktopTelemetryState,
  DesktopUpdateState
} from "../desktop-api";
import { flushStudioGameAlgo, initStudioGameAlgo, setStudioGameAlgoEnabled, trackStudioGameAlgo } from "../gamealgo";
import type { DesktopUpdateAction, PermissionAction, ToastKind } from "./types";

declare const __APP_VERSION__: string;

export function useDesktopSystem({ toast, trackTelemetry }: {
  toast: (message: string, kind?: ToastKind) => void;
  trackTelemetry: (name: string, props?: Record<string, unknown>) => void;
}) {
  const [desktopPermissions, setDesktopPermissions] = useState<DesktopPermissionState>();
  const [permissionGuideOpen, setPermissionGuideOpen] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState("");
  const [permissionConfirmed, setPermissionConfirmed] = useState(false);
  const [desktopUpdate, setDesktopUpdate] = useState<DesktopUpdateState>();
  const [desktopUpdateBusy, setDesktopUpdateBusy] = useState("");
  const [updatePromptOpen, setUpdatePromptOpen] = useState(false);
  const [desktopHardware, setDesktopHardware] = useState<DesktopHardwareAccelerationState>();
  const [hardwareBusy, setHardwareBusy] = useState(false);
  const [desktopLegal, setDesktopLegal] = useState<DesktopLegalState>();
  const [desktopTelemetry, setDesktopTelemetry] = useState<DesktopTelemetryState>();
  const [telemetryBusy, setTelemetryBusy] = useState(false);
  const [legalDialogOpen, setLegalDialogOpen] = useState(Boolean(window.tapMakerWork?.legal));
  const [legalBusy, setLegalBusy] = useState<"accept" | "decline" | "">("");

  useEffect(() => {
    const permissionsApi = window.tapMakerWork?.permissions;
    const updatesApi = window.tapMakerWork?.updates;
    const hardwareApi = window.tapMakerWork?.hardwareAcceleration;
    const legalApi = window.tapMakerWork?.legal;
    const telemetryApi = window.tapMakerWork?.telemetry;
    if (!permissionsApi && !updatesApi && !hardwareApi && !legalApi && !telemetryApi) return;
    let active = true;
    if (permissionsApi) {
      void permissionsApi.get().then((state) => {
        if (!active) return;
        setDesktopPermissions(state);
        if (state.ready) setPermissionConfirmed(true);
        const dismissed = localStorage.getItem("tapmakerwork.permissions.dismissed") === "1";
        if (state.platform === "darwin" && !state.ready && !dismissed) setPermissionGuideOpen(true);
      });
    }
    if (updatesApi) {
      void updatesApi.get().then((state) => {
        if (!active) return;
        setDesktopUpdate(state);
      });
    }
    if (hardwareApi) {
      void hardwareApi.get().then((state) => {
        if (active) setDesktopHardware(state);
      }).catch(() => undefined);
    }
    if (legalApi) {
      void legalApi.get().then((state) => {
        if (!active) return;
        setDesktopLegal(state);
        setLegalDialogOpen(!state.accepted);
      }).catch((error) => {
        if (active) toast(`无法读取用户协议状态：${error instanceof Error ? error.message : String(error)}`, "error");
      });
    }
    if (telemetryApi) {
      void telemetryApi.get().then(async (state) => {
        if (!active) return;
        setDesktopTelemetry(state);
        await initStudioGameAlgo({
          enabled: state.enabled,
          gameKey: state.gameKey,
          appVersion: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.1.0",
          // 正式看板只统计非 debug；需要调试事件时在控制台执行 localStorage.setItem("tapmakerwork.gamealgo.debug","1")
          isDebug: typeof localStorage !== "undefined" && localStorage.getItem("tapmakerwork.gamealgo.debug") === "1"
        });
      }).catch(() => undefined);
    }
    const removePermissionListener = permissionsApi?.onChanged((state) => {
      setDesktopPermissions(state);
      if (state.ready) {
        setPermissionConfirmed(true);
        localStorage.removeItem("tapmakerwork.permissions.dismissed");
      }
    });
    const removeUpdateListener = updatesApi?.onState((state) => {
      setDesktopUpdate(state);
    });
    const removeUpdatePromptListener = updatesApi?.onPrompt((state) => {
      setDesktopUpdate(state);
      if (state.phase === "available") {
        setUpdatePromptOpen(true);
      } else if (state.phase === "up-to-date") {
        setUpdatePromptOpen(false);
        toast(state.message || "当前已是最新版本", "success");
      } else if (state.phase === "error") {
        toast(state.message || "检查更新失败", "error");
      }
    });
    const removeTrackListener = telemetryApi?.onTrack?.((name, props) => {
      trackStudioGameAlgo(name, props);
    });
    const removeSessionEndListener = telemetryApi?.onSessionEnd?.((payload) => {
      trackStudioGameAlgo("ide.session", payload);
      void flushStudioGameAlgo();
    });
    const telemetryTimer = telemetryApi
      ? window.setInterval(() => {
        if (document.hidden) return;
        void telemetryApi.get().then((state) => {
          if (active) setDesktopTelemetry(state);
        }).catch(() => undefined);
      }, 15_000)
      : undefined;
    return () => {
      active = false;
      if (telemetryTimer) window.clearInterval(telemetryTimer);
      removePermissionListener?.();
      removeUpdateListener?.();
      removeUpdatePromptListener?.();
      removeTrackListener?.();
      removeSessionEndListener?.();
    };
  }, [toast]);

  const runPermissionAction = useCallback(async (action: PermissionAction) => {
    const api = window.tapMakerWork?.permissions;
    if (!api) return;
    setPermissionBusy(action);
    try {
      if (action === "restart") {
        await api.restart();
        return;
      }
      if (action === "confirm") {
        const state = await api.get();
        setDesktopPermissions(state);
        setPermissionConfirmed(true);
        toast(state.ready ? "系统权限已检测为就绪，可以重启应用" : "已记录你的授权确认；现在可以重启应用完成系统状态刷新", "success");
        return;
      }
      const state = action === "refresh" ? await api.get() : await api.request(action);
      setDesktopPermissions(state);
      if (state.ready) {
        setPermissionConfirmed(true);
        toast("系统权限已就绪，可以使用真实 Runtime 预览与交互", "success");
      } else if (action === "refresh") {
        toast("系统尚未返回最新授权状态；若你已在设置中开启，可点击“我已授权”后重启", "warn");
      }
    } catch (error) {
      toast(`权限操作失败：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setPermissionBusy("");
    }
  }, [toast]);

  const closePermissionGuide = useCallback(() => {
    localStorage.setItem("tapmakerwork.permissions.dismissed", "1");
    setPermissionGuideOpen(false);
  }, []);

  const runDesktopUpdateAction = useCallback(async (action: DesktopUpdateAction) => {
    const api = window.tapMakerWork?.updates;
    if (!api) return;
    setDesktopUpdateBusy(action);
    try {
      const state = await api[action]();
      setDesktopUpdate(state);
      if (action === "check") {
        if (state.phase === "available") setUpdatePromptOpen(true);
        else if (state.phase === "up-to-date") toast(state.message || "当前已是最新版本", "success");
        else if (state.phase === "error") toast(state.message || "检查更新失败", "error");
      } else if (action === "download") {
        toast(state.message || "已打开下载页", "success");
      } else if (action === "snooze") {
        setUpdatePromptOpen(false);
        toast(state.message || "已暂不更新", "info");
      } else if (action === "mute") {
        setUpdatePromptOpen(false);
        toast(state.message || "已不再提醒此版本", "info");
      }
    } catch (error) {
      toast(`应用更新失败：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setDesktopUpdateBusy("");
    }
  }, [toast]);

  const setHardwareAcceleration = useCallback(async (enabled: boolean) => {
    const api = window.tapMakerWork?.hardwareAcceleration;
    if (!api) return;
    setHardwareBusy(true);
    try {
      const state = await api.set(enabled);
      setDesktopHardware(state);
      toast(`硬件加速已${enabled ? "开启" : "关闭"}，重启应用后生效`, "success");
    } catch (error) {
      toast(`硬件加速设置失败：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setHardwareBusy(false);
    }
  }, [toast]);

  const acceptLegalTerms = useCallback(async () => {
    const api = window.tapMakerWork?.legal;
    if (!api) { setLegalDialogOpen(false); return; }
    setLegalBusy("accept");
    try {
      const state = await api.accept();
      setDesktopLegal(state);
      setLegalDialogOpen(false);
      trackTelemetry("eula.accept", { version: state.version });
      toast("已接受用户协议与隐私政策", "success");
    } catch (error) {
      toast(`协议状态保存失败：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setLegalBusy("");
    }
  }, [toast, trackTelemetry]);

  const setTelemetryEnabled = useCallback(async (enabled: boolean) => {
    const api = window.tapMakerWork?.telemetry;
    if (!api) return;
    setTelemetryBusy(true);
    try {
      const state = await api.setEnabled(enabled);
      setDesktopTelemetry(state);
      setStudioGameAlgoEnabled(enabled);
      if (enabled) {
        await initStudioGameAlgo({
          enabled: true,
          gameKey: state.gameKey,
          appVersion: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.1.0",
          isDebug: typeof localStorage !== "undefined" && localStorage.getItem("tapmakerwork.gamealgo.debug") === "1"
        });
      }
      toast(enabled ? "已开启 GameAlgo 匿名使用统计" : "已关闭匿名使用统计", "success");
    } catch (error) {
      toast(`遥测设置失败：${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setTelemetryBusy(false);
    }
  }, [toast]);

  const declineLegalTerms = useCallback(async () => {
    setLegalBusy("decline");
    try {
      await window.tapMakerWork?.legal?.decline();
    } catch (error) {
      setLegalBusy("");
      toast(`无法关闭应用：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }, [toast]);

  return {
    desktopPermissions,
    permissionGuideOpen,
    setPermissionGuideOpen,
    permissionBusy,
    permissionConfirmed,
    desktopUpdate,
    desktopUpdateBusy,
    updatePromptOpen,
    setUpdatePromptOpen,
    desktopHardware,
    hardwareBusy,
    desktopLegal,
    desktopTelemetry,
    telemetryBusy,
    legalDialogOpen,
    setLegalDialogOpen,
    legalBusy,
    runPermissionAction,
    closePermissionGuide,
    runDesktopUpdateAction,
    setHardwareAcceleration,
    acceptLegalTerms,
    setTelemetryEnabled,
    declineLegalTerms
  };
}
