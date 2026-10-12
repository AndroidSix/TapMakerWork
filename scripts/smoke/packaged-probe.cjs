// Electron main process for packaged-smoke.mjs: loads the built Studio from file:// with the same
// window settings as apps/desktop, opens SMOKE_PROJECT through Studio's own fetch and reports JSON.
const fs = require("node:fs");
const { app, BrowserWindow } = require("electron");

const studioIndex = process.env.SMOKE_STUDIO_INDEX;
const projectRoot = process.env.SMOKE_PROJECT;
const screenshot = process.env.SMOKE_SCREENSHOT;
const result = { pageErrors: [], openStatus: null, bridgeConnected: false, projectView: false, crossSiteShown: false };

function finish(extra = {}) {
  process.stdout.write(`PROBE ${JSON.stringify({ ...result, ...extra })}\n`);
  app.exit(0);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(window, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression)) return true;
    await delay(300);
  }
  return false;
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.webContents.on("console-message", (event, legacyLevel, legacyMessage) => {
    const level = event.level ?? legacyLevel;
    const message = event.message ?? legacyMessage;
    if ((level === "error" || level === 3) && !/Failed to load resource|ERR_|WebSocket/.test(message)) result.pageErrors.push(message);
  });
  window.webContents.on("render-process-gone", (_event, details) => finish({ fatal: `renderer gone: ${details.reason}` }));

  const load = () => window.loadFile(studioIndex, { query: { desktop: process.platform } });
  await load();
  await window.webContents.executeJavaScript(`localStorage.clear(); localStorage.setItem("tapmakerwork.onboarding.v1", "1");`);
  result.openStatus = await window.webContents.executeJavaScript(
    `fetch("http://127.0.0.1:43121/api/project/open", { method: "POST", headers: { "content-type": "application/json" }, body: ${JSON.stringify(JSON.stringify({ path: projectRoot }))} }).then((response) => response.status, () => 0)`
  );
  await load();
  result.projectView = await waitFor(window, `Boolean(document.querySelector(".left-pane"))`, 20_000);
  result.bridgeConnected = await waitFor(window, `document.body.innerText.includes("Bridge 已连接")`, 10_000);
  await delay(1500);
  result.crossSiteShown = await window.webContents.executeJavaScript(`document.body.innerText.includes("cross_site_request")`);
  if (screenshot) fs.writeFileSync(screenshot, (await window.webContents.capturePage()).toPNG());
  finish();
}).catch((error) => finish({ fatal: error instanceof Error ? error.message : String(error) }));
