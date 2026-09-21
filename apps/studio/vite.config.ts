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
  build: {
    outDir: "dist",
    sourcemap: false
  }
});
