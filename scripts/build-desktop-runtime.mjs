import { build } from "esbuild";

await build({
  entryPoints: ["packages/bridge/src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: "packages/bridge/dist-app/index.mjs",
  banner: {
    js: "import { createRequire as __tapmakerworkCreateRequire } from 'node:module'; const require = __tapmakerworkCreateRequire(import.meta.url);"
  }
});
