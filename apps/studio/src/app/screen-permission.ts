import { useEffect, useState } from "react";
import type { DesktopPermissionState } from "../desktop-api";

/**
 * 签名无效的安装包，TCC 认不出它是同一个 app，每次抓屏都会重新弹系统框。
 * 这种状态下抓屏不可能成功，门禁直接拦住，避免把问题表现成「授权了还在弹」。
 */
export function screenSignatureInvalid(state: DesktopPermissionState | undefined): boolean {
  return Boolean(state && state.platform === "darwin" && state.signatureValid === false);
}

/** macOS 之外的平台没有 TCC 录屏授权，一律放行。 */
export function screenCaptureAllowed(state: DesktopPermissionState | undefined): boolean {
  if (!state) return false;
  if (state.platform !== "darwin") return true;
  return state.screen === "granted" && !screenSignatureInvalid(state);
}

/**
 * 桌面权限状态。没有桌面桥（浏览器 / Bridge）时返回 undefined。
 * 在系统设置里改完授权回到应用时会重读一次，不必重启。
 */
export function useScreenPermissionState(): DesktopPermissionState | undefined {
  const [state, setState] = useState<DesktopPermissionState>();

  useEffect(() => {
    const api = window.tapMakerWork?.permissions;
    if (!api) return;
    let active = true;
    const apply = (next: DesktopPermissionState) => {
      if (active) setState(next);
    };
    const refresh = () => {
      if (!document.hidden) void api.get().then(apply).catch(() => undefined);
    };
    void api.get().then(apply).catch(() => undefined);
    const removeListener = api.onChanged(apply);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      removeListener?.();
    };
  }, []);

  return state;
}

/**
 * 录屏授权是否可用。后台轮询必须先看这个值：macOS 的 TCC 系统框由窗口枚举触发，
 * 未授权时反复轮询会让系统框不停重弹，只有用户显式操作才允许触发一次。
 * 浏览器 / Bridge 环境没有 TCC，一律视为可用。
 */
export function useScreenCaptureAllowed(): boolean {
  const state = useScreenPermissionState();
  const [bridgeMissing, setBridgeMissing] = useState(false);

  useEffect(() => {
    setBridgeMissing(!window.tapMakerWork?.permissions);
  }, []);

  if (bridgeMissing) return true;
  return screenCaptureAllowed(state);
}
