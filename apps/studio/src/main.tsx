import React, { StrictMode, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/languages/definitions/lua/register";
import "monaco-editor/language/json/monaco.contribution";
import "monaco-editor/language/typescript/monaco.contribution";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker?worker";
import { App } from "./App";
import type { DesktopHardwareAccelerationState, DesktopLegalState, DesktopPermissionState, DesktopTelemetryState, DesktopUpdateState } from "./desktop-api";
import "./styles.css";

self.MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    if (label === "json") return new JsonWorker();
    if (label === "typescript" || label === "javascript") return new TsWorker();
    return new EditorWorker();
  }
};
loader.config({ monaco });

declare global {
  interface Window {
    tapMakerWork?: {
      platform: string;
      desktop: boolean;
      chooseProject?: () => Promise<string | undefined>;
      chooseDirectory?: (opts?: { title?: string; defaultPath?: string }) => Promise<string | undefined>;
      clipboard?: {
        writeText: (text: string) => Promise<{ ok: boolean; error?: string }>;
      };
      onOpenProject?: (listener: (projectPath: string) => void) => () => void;
      onCloseProject?: (listener: () => void) => () => void;
      onHistoryAction?: (listener: (action: "undo" | "redo") => void) => () => void;
      permissions?: {
        get: () => Promise<DesktopPermissionState>;
        request: (permission: "screen" | "accessibility") => Promise<DesktopPermissionState>;
        open: (permission: "screen" | "accessibility") => Promise<DesktopPermissionState>;
        restart: () => Promise<void>;
        onChanged: (listener: (state: DesktopPermissionState) => void) => () => void;
      };
      updates?: {
        get: () => Promise<DesktopUpdateState>;
        check: () => Promise<DesktopUpdateState>;
        download: () => Promise<DesktopUpdateState>;
        restart: () => Promise<DesktopUpdateState>;
        onState: (listener: (state: DesktopUpdateState) => void) => () => void;
      };
      hardwareAcceleration?: {
        get: () => Promise<DesktopHardwareAccelerationState>;
        set: (enabled: boolean) => Promise<DesktopHardwareAccelerationState>;
        restart: () => Promise<void>;
      };
      legal?: {
        get: () => Promise<DesktopLegalState>;
        accept: () => Promise<DesktopLegalState>;
        decline: () => Promise<{ accepted: false; closing: boolean }>;
      };
      telemetry?: {
        get: () => Promise<DesktopTelemetryState>;
        setEnabled: (enabled: boolean) => Promise<DesktopTelemetryState>;
        setEndpoint: (endpoint: string) => Promise<DesktopTelemetryState>;
        track: (name: string, props?: Record<string, unknown>) => Promise<{ ok: boolean }>;
        flush: () => Promise<{ ok: boolean; sent: number; error?: string; summary: DesktopTelemetryState }>;
      };
      captureRuntime?: (opts?: { projectName?: string; sourceId?: string; orientation?: "portrait" | "landscape"; viewportWidth?: number; viewportHeight?: number }) => Promise<{
        ok: boolean;
        dataUrl?: string;
        sourceId?: string;
        sourceName?: string;
        width?: number;
        height?: number;
        permission?: string;
        error?: string;
        candidates?: Array<{ id: string; name: string }>;
      }>;
      preview?: {
        mount: (opts: { url: string; x: number; y: number; width: number; height: number; orientation: string }) => Promise<{ ok: boolean; error?: string }>;
        reload: () => Promise<{ ok: boolean }>;
        unmount: () => Promise<{ ok: boolean }>;
        capture: () => Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
      };
      runtime?: {
        capture: (opts?: { projectName?: string; sourceId?: string; orientation?: "portrait" | "landscape"; viewportWidth?: number; viewportHeight?: number }) => Promise<{
          ok: boolean;
          dataUrl?: string;
          sourceId?: string;
          sourceName?: string;
          width?: number;
          height?: number;
          permission?: string;
          error?: string;
          candidates?: Array<{ id: string; name: string }>;
        }>;
        interact: (opts: { sourceName: string; sourceId: string; normalizedX: number; normalizedY: number; viewportWidth: number; viewportHeight: number }) => Promise<{ ok: boolean; error?: string }>;
      };
    };
  }
}

class RootErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("[TapMakerWork Studio]", error);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: "100vh",
          padding: 32,
          background: "#0d1017",
          color: "#e8edf5",
          fontFamily: "Inter, sans-serif"
        }}>
          <h1 style={{ fontSize: 20, marginBottom: 12 }}>TapMakerWork 界面加载失败</h1>
          <p style={{ color: "#ffb5ae" }}>{String(this.state.error.message || this.state.error)}</p>
          <p style={{ color: "#8d98aa", marginTop: 16 }}>请关闭后重新打开 IDE。若持续出现，请反馈该错误信息。</p>
        </div>
      );
    }
    return this.props.children;
  }
}

const desktopPlatform = window.tapMakerWork?.platform || new URLSearchParams(window.location.search).get("desktop");
if (desktopPlatform) {
  document.documentElement.classList.add("desktop-shell", `desktop-${desktopPlatform}`);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>
);
