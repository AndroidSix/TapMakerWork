import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

declare global {
  interface Window {
    tapMakerWork?: {
      platform: string;
      desktop: boolean;
    };
  }
}

if (window.tapMakerWork?.desktop) {
  document.documentElement.classList.add("desktop-shell", `desktop-${window.tapMakerWork.platform}`);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
