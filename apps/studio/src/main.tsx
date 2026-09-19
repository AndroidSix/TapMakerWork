import React, { StrictMode, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

declare global {
  interface Window {
    tapMakerWork?: {
      platform: string;
      desktop: boolean;
      chooseProject?: () => Promise<string | undefined>;
      onOpenProject?: (listener: (projectPath: string) => void) => () => void;
      preview?: {
        mount: (opts: { url: string; x: number; y: number; width: number; height: number; orientation: string }) => Promise<{ ok: boolean; error?: string }>;
        reload: () => Promise<{ ok: boolean }>;
        unmount: () => Promise<{ ok: boolean }>;
        capture: () => Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
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
