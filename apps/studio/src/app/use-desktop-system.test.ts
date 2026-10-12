// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopPermissionState, DesktopUpdateState } from "../desktop-api";
import { flushPromises, renderHook } from "./render-hook";
import { useDesktopSystem } from "./use-desktop-system";

type DesktopApi = NonNullable<Window["tapMakerWork"]>;

const notReady: DesktopPermissionState = { platform: "darwin", packaged: true, stableIdentity: true, screen: "denied", accessibility: "denied", ready: false };
const upToDate: DesktopUpdateState = { phase: "up-to-date", currentVersion: "0.1.6", packaged: true };

function mockDesktop() {
  const listeners: { prompt?: (state: DesktopUpdateState) => void; permission?: (state: DesktopPermissionState) => void } = {};
  const api: DesktopApi = {
    platform: "darwin",
    desktop: true,
    permissions: {
      get: vi.fn(async () => notReady),
      request: vi.fn(async () => ({ ...notReady, screen: "granted" as const })),
      open: vi.fn(async () => notReady),
      restart: vi.fn(async () => undefined),
      onChanged: (listener) => { listeners.permission = listener; return () => undefined; }
    },
    updates: {
      get: vi.fn(async () => upToDate),
      check: vi.fn(async () => ({ ...upToDate, phase: "available" as const, availableVersion: "0.1.7" })),
      download: vi.fn(async () => upToDate),
      restart: vi.fn(async () => upToDate),
      snooze: vi.fn(async () => ({ ...upToDate, message: "已暂不更新" })),
      mute: vi.fn(async () => upToDate),
      openSite: vi.fn(async () => upToDate),
      onState: () => () => undefined,
      onPrompt: (listener) => { listeners.prompt = listener; return () => undefined; }
    },
    legal: {
      get: vi.fn(async () => ({ version: "1", accepted: false })),
      accept: vi.fn(async () => ({ version: "1", accepted: true, acceptedAt: "2026-10-12T00:00:00Z" })),
      decline: vi.fn(async () => ({ accepted: false as const, closing: true }))
    }
  };
  window.tapMakerWork = api;
  return { api, listeners };
}

function setup() {
  const toast = vi.fn();
  const trackTelemetry = vi.fn();
  const view = renderHook(() => useDesktopSystem({ toast, trackTelemetry }));
  return { ...view, toast, trackTelemetry };
}

afterEach(() => {
  delete window.tapMakerWork;
  localStorage.clear();
});

describe("useDesktopSystem", () => {
  it("stays idle in a plain browser", () => {
    const { result, unmount } = setup();
    expect(result.current.legalDialogOpen).toBe(false);
    expect(result.current.desktopUpdate).toBeUndefined();
    unmount();
  });

  it("loads desktop state and opens the permission guide and legal dialog on first run", async () => {
    mockDesktop();
    const { result, unmount } = setup();
    expect(result.current.legalDialogOpen).toBe(true);
    await flushPromises();
    expect(result.current.desktopPermissions?.ready).toBe(false);
    expect(result.current.permissionGuideOpen).toBe(true);
    expect(result.current.desktopUpdate?.phase).toBe("up-to-date");
    expect(result.current.legalDialogOpen).toBe(true);
    unmount();
  });

  it("does not reopen a dismissed permission guide", async () => {
    mockDesktop();
    localStorage.setItem("tapmakerwork.permissions.dismissed", "1");
    const { result, unmount } = setup();
    await flushPromises();
    expect(result.current.permissionGuideOpen).toBe(false);
    unmount();
  });

  it("remembers closing the permission guide", async () => {
    mockDesktop();
    const { result, unmount } = setup();
    await flushPromises();
    act(() => result.current.closePermissionGuide());
    expect(result.current.permissionGuideOpen).toBe(false);
    expect(localStorage.getItem("tapmakerwork.permissions.dismissed")).toBe("1");
    unmount();
  });

  it("opens the update prompt from the main process and toasts when already latest", async () => {
    const { listeners } = mockDesktop();
    const { result, toast, unmount } = setup();
    await flushPromises();
    act(() => listeners.prompt?.({ ...upToDate, phase: "available", availableVersion: "0.1.7" }));
    expect(result.current.updatePromptOpen).toBe(true);
    act(() => listeners.prompt?.(upToDate));
    expect(result.current.updatePromptOpen).toBe(false);
    expect(toast).toHaveBeenCalledWith("当前已是最新版本", "success");
    unmount();
  });

  it("checks for updates and snoozes the prompt", async () => {
    const { api } = mockDesktop();
    const { result, toast, unmount } = setup();
    await act(() => result.current.runDesktopUpdateAction("check"));
    expect(result.current.updatePromptOpen).toBe(true);
    expect(result.current.desktopUpdate?.availableVersion).toBe("0.1.7");
    await act(() => result.current.runDesktopUpdateAction("snooze"));
    expect(api.updates?.snooze).toHaveBeenCalled();
    expect(result.current.updatePromptOpen).toBe(false);
    expect(result.current.desktopUpdateBusy).toBe("");
    expect(toast).toHaveBeenLastCalledWith("已暂不更新", "info");
    unmount();
  });

  it("clears the dismissed flag once permissions become ready", async () => {
    const { listeners } = mockDesktop();
    localStorage.setItem("tapmakerwork.permissions.dismissed", "1");
    const { result, unmount } = setup();
    await flushPromises();
    act(() => listeners.permission?.({ ...notReady, screen: "granted", accessibility: "granted", ready: true }));
    expect(result.current.permissionConfirmed).toBe(true);
    expect(localStorage.getItem("tapmakerwork.permissions.dismissed")).toBeNull();
    unmount();
  });

  it("accepts the legal terms and records the event", async () => {
    mockDesktop();
    const { result, trackTelemetry, unmount } = setup();
    await flushPromises();
    await act(() => result.current.acceptLegalTerms());
    expect(result.current.legalDialogOpen).toBe(false);
    expect(result.current.desktopLegal?.accepted).toBe(true);
    expect(trackTelemetry).toHaveBeenCalledWith("eula.accept", { version: "1" });
    unmount();
  });

  it("reports permission request failures", async () => {
    const { api } = mockDesktop();
    vi.mocked(api.permissions!.request).mockRejectedValueOnce(new Error("denied by policy"));
    const { result, toast, unmount } = setup();
    await act(() => result.current.runPermissionAction("screen"));
    expect(toast).toHaveBeenCalledWith("权限操作失败：denied by policy", "error");
    expect(result.current.permissionBusy).toBe("");
    unmount();
  });
});
