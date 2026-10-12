#!/usr/bin/env node
// Packaged-mode smoke test: runs Bridge with TAPMAKERWORK_PACKAGED=1 and loads the built Studio
// from file:// in Electron, the way the installed app does. Fails if Bridge rejects any request.
// Usage: npm run build && npm run smoke:packaged (Linux CI: xvfb-run -a npm run smoke:packaged)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import electronPath from "electron";
import { BRIDGE, createFixtureProject, createReport, isUp, repoRoot, startProcess, stopProcessTree, waitUntilUp } from "./smoke-utils.mjs";

const studioIndex = path.join(repoRoot, "apps", "studio", "dist", "index.html");
// A dev Studio tab left open on :4173 keeps polling and is rejected in packaged mode by design.
const DEV_STUDIO_TAB = /origin=http:\/\/(127\.0\.0\.1|localhost):4173 /;
const report = createReport();
const children = [];

function collectOutput(stream) {
  const lines = [];
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    const parts = `${pending}${chunk}`.split(/\r?\n/);
    pending = parts.pop() ?? "";
    lines.push(...parts);
  });
  return lines;
}

function runProbe(projectRoot) {
  const args = [...(process.platform === "linux" ? ["--no-sandbox"] : []), path.join(repoRoot, "scripts", "smoke", "packaged-probe.cjs")];
  const child = startProcess(children, electronPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    env: { SMOKE_STUDIO_INDEX: studioIndex, SMOKE_PROJECT: projectRoot, ...(process.env.SMOKE_SCREENSHOT ? { SMOKE_SCREENSHOT: process.env.SMOKE_SCREENSHOT } : {}) }
  });
  const stdout = collectOutput(child.stdout);
  const stderr = collectOutput(child.stderr);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Electron probe timed out")), 90_000);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      const line = stdout.find((entry) => entry.startsWith("PROBE "));
      if (line) resolve(JSON.parse(line.slice("PROBE ".length)));
      else reject(new Error(`Electron probe exited (${code}) without a result: ${stderr.slice(-5).join(" | ")}`));
    });
  });
}

async function run() {
  if (!fs.existsSync(studioIndex)) throw new Error("apps/studio/dist/index.html 不存在，先运行 npm run build");
  if (await isUp(`${BRIDGE}/api/health`)) throw new Error("43121 端口已有 Bridge 在运行，先停止它再跑打包版冒烟");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tmw-packaged-home-"));
  const projectRoot = createFixtureProject();
  try {
    const bridge = startProcess(children, "npx", ["tsx", "packages/bridge/src/index.ts"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { TAPMAKERWORK_PACKAGED: "1", HOME: home, USERPROFILE: home }
    });
    const bridgeOutput = collectOutput(bridge.stderr);
    collectOutput(bridge.stdout);
    await waitUntilUp(`${BRIDGE}/api/health`, 30_000);

    const probe = await runProbe(projectRoot);
    const rejected = bridgeOutput.filter((line) => line.includes("[TapMakerWork] reject") && !DEV_STUDIO_TAB.test(line));
    report.check("Electron probe completed", !probe.fatal, probe.fatal ?? "");
    report.check("Studio (file://) opens a project through Bridge", probe.openStatus === 200, `status=${probe.openStatus}`);
    report.check("project view renders", probe.projectView);
    report.check("Bridge shows as connected", probe.bridgeConnected);
    report.check("Bridge rejected no requests", rejected.length === 0, rejected.slice(0, 3).join(" | "));
    report.check("no cross_site_request shown", !probe.crossSiteShown);
    report.check("no page errors", probe.pageErrors.length === 0, probe.pageErrors.slice(0, 3).join(" | "));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    for (const child of children) stopProcessTree(child);
    await new Promise((resolve) => setTimeout(resolve, 500));
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

try {
  await run();
} catch (error) {
  report.check("packaged smoke run", false, error instanceof Error ? error.message : String(error));
  for (const child of children) stopProcessTree(child);
}
process.exit(report.print() ? 0 : 1);
