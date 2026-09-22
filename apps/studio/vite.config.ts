import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import packageJson from "../../package.json";

export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version)
  },
  server: {
    strictPort: true
  },
  // @gamealgo/web spins up a module Worker with dynamic imports; Vite's default
  // worker.format "iife" cannot code-split and fails the production build.
  worker: {
    format: "es"
  },
  build: {
    outDir: "dist",
    sourcemap: false
  }
});
