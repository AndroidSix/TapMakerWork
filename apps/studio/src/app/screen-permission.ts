import { useEffect, useState } from "react";
import type { DesktopPermissionState } from "../desktop-api";

/** macOS 之外的平台没有 TCC 录屏授权，一律放行。 */
export function screenCaptureAllowed(state: DesktopPermissionState | undefined): boolean {
  if (!state) return false;
  return state.platform !== "darwin" || state.screen === "granted";
}

/**
 * 录屏授权是否可用。后台轮询必须先看这个值：macOS 的 TCC 系统框由窗口枚举触发，
 * 未授权时反复轮询会让系统框不停重弹，只有用户显式操作才允许触发一次。
 * 浏览器 / Bridge 环境没有 TCC，一律视为可用。
 */
export function useScreenCaptureAllowed(): boolean {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const api = window.tapMakerWork?.permissions;
    if (!api) {
      setAllowed(true);
      return;
    }
    let active = true;
    const apply = (state: DesktopPermissionState) => {
      if (active) setAllowed(screenCaptureAllowed(state));
    };
    void api.get().then(apply).catch(() => undefined);
    const removeListener = api.onChanged(apply);
    // 用户在系统设置里改完授权回到应用时，重新读一次，避免必须重启才生效。
    const refresh = () => {
      if (!document.hidden) void api.get().then(apply).catch(() => undefined);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      removeListener?.();
    };
  }, []);

  return allowed;
}
