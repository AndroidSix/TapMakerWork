import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import packageJson from "../../package.json";

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    // @gamealgo/web only calls getQuickJS(); the full package bundles four wasm variants.
    alias: [{ find: /^quickjs-emscripten$/, replacement: fileURLToPath(new URL("./src/quickjs-release-sync.ts", import.meta.url)) }]
  },
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
