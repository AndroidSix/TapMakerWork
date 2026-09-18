import { StrictMode } from "react";
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
    };
  }
}

const desktopPlatform = window.tapMakerWork?.platform || new URLSearchParams(window.location.search).get("desktop");
if (desktopPlatform) {
  document.documentElement.classList.add("desktop-shell", `desktop-${desktopPlatform}`);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
