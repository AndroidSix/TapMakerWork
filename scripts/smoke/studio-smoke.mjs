#!/usr/bin/env node
// Studio UI smoke test: boots Bridge + Vite (unless already running), opens a fixture project
// and drives the IDE with Playwright. Usage: CHROME_PATH=/path/to/chrome npm run smoke
// Bridge uses your real HOME (or SMOKE_HOME) so the installed Maker MCP passes the version gate.
import fs from "node:fs";
import { chromium } from "playwright-core";
import { BRIDGE, createFixtureProject, createReport, isUp, startProcess, stopProcessTree, waitUntilUp } from "./smoke-utils.mjs";

const STUDIO = "http://127.0.0.1:4173";
const report = createReport();
const check = report.check;
const children = [];

async function run() {
  if (!(await isUp(`${BRIDGE}/api/health`))) {
    const home = process.env.SMOKE_HOME;
    startProcess(children, "npx", ["tsx", "packages/bridge/src/index.ts"], { env: home ? { HOME: home, USERPROFILE: home } : {} });
    await waitUntilUp(`${BRIDGE}/api/health`, 30_000);
  }
  if (!(await isUp(STUDIO))) {
    startProcess(children, "npm", ["run", "dev", "-w", "@tapmakerwork/studio"]);
    await waitUntilUp(STUDIO, 60_000);
  }
  const projectRoot = createFixtureProject();
  const opened = await fetch(`${BRIDGE}/api/project/open`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: projectRoot })
  });
  check("open fixture project via Bridge", opened.ok, `${opened.status}`);

  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" })
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    const requests = [];
    const forbidden = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !/Failed to load resource|ERR_|WebSocket/.test(message.text())) errors.push(message.text());
    });
    page.on("request", (request) => requests.push({ url: request.url(), at: Date.now() }));
    page.on("response", (response) => { if (response.status() === 403) forbidden.push(response.url()); });

    await page.goto(STUDIO);
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("tapmakerwork.onboarding.v1", "1");
    });
    await page.reload();
    await page.waitForSelector(".left-pane", { timeout: 20_000 });
    await page.waitForTimeout(1500);
    if (await page.$(".maker-version-backdrop")) throw new Error("Maker MCP 未安装或版本过低，先在本机安装后再跑冒烟");

    const leftWidth = () => page.$eval(".left-pane", (element) => Math.round(element.getBoundingClientRect().width));
    const before = await leftWidth();
    const resizer = await page.$('[aria-label="调节左侧栏宽度"]');
    const box = await resizer.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 150, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
    const after = await leftWidth();
    check("drag left pane wider", after > before + 100, `${before}px -> ${after}px`);
    await page.reload();
    await page.waitForSelector(".left-pane");
    await page.waitForTimeout(800);
    check("layout persists after reload", Math.abs((await leftWidth()) - after) <= 2);

    const terminalHeight = () => page.$eval(".terminal-panel", (element) => Math.round(element.getBoundingClientRect().height));
    const t0 = await terminalHeight();
    await page.click(".terminal-size >> text=最大化");
    const t1 = await terminalHeight();
    await page.click(".terminal-size >> text=收起");
    const t2 = await terminalHeight();
    await page.click(".terminal-size >> text=展开");
    const t3 = await terminalHeight();
    check("terminal maximize / collapse / expand", t1 > t0 && t2 < t0 && Math.abs(t3 - t0) <= 2, `${t0} ${t1} ${t2} ${t3}`);

    const windowStart = Date.now();
    await page.waitForTimeout(6000);
    const inWindow = requests.filter((request) => request.at >= windowStart && request.at < windowStart + 6000);
    const healthCount = inWindow.filter((request) => request.url.includes("/api/health")).length;
    const snapshotCount = inWindow.filter((request) => request.url.includes("/api/ui/snapshot")).length;
    check("one health poll (~4 per 6s)", healthCount >= 3 && healthCount <= 5, `health=${healthCount}`);
    check("no snapshot polling", snapshotCount === 0, `snapshot=${snapshotCount}`);

    const editorRequestedEarly = requests.some((request) => request.url.includes("code-editors"));
    await page.click('[aria-label="项目文件"]');
    await page.locator(".file-row", { hasText: "scripts" }).first().click();
    await page.locator(".file-row", { hasText: "main.lua" }).first().click();
    await page.waitForSelector(".monaco-editor .view-line", { timeout: 20_000 });
    const editorText = await page.$eval(".monaco-editor .view-lines", (element) => element.textContent || "");
    check("Monaco loads lazily on first code open", !editorRequestedEarly && editorText.includes("UI.Panel"), editorText.slice(0, 60));

    await page.click("button:has-text('工具')");
    await page.locator("button", { hasText: "图片压缩" }).first().click();
    await page.waitForTimeout(1200);
    check("image compress panel opens", requests.some((request) => request.url.includes("ImageCompressPanel")));

    check("no 403 responses", forbidden.length === 0, forbidden.slice(0, 3).join(", "));
    check("no runtime errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    if (process.env.SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.SMOKE_SCREENSHOT });
  } finally {
    await browser.close();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}

try {
  await run();
} catch (error) {
  check("smoke run", false, error instanceof Error ? error.message : String(error));
} finally {
  for (const child of children) stopProcessTree(child);
}
process.exit(report.print() ? 0 : 1);
