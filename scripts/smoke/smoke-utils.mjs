import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const BRIDGE = "http://127.0.0.1:43121";
export const isWindows = process.platform === "win32";

const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export function createReport() {
  const items = [];
  return {
    check: (name, ok, detail = "") => items.push({ name, ok, detail }),
    print() {
      for (const item of items) console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
      return items.length > 0 && items.every((item) => item.ok);
    }
  };
}

export async function isUp(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

export async function waitUntilUp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isUp(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${url}`);
}

export function startProcess(children, command, args, { env = {}, stdio = "ignore", shell = isWindows } = {}) {
  const child = spawn(command, args, { cwd: repoRoot, env: { ...process.env, ...env }, stdio, shell, detached: !isWindows });
  children.push(child);
  return child;
}

export function stopProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  try {
    if (isWindows) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    // already exited
  }
}

export function createFixtureProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tmw-smoke-"));
  fs.mkdirSync(path.join(root, ".project"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "assets", "images"), { recursive: true });
  fs.writeFileSync(path.join(root, ".project", "project.json"), JSON.stringify({ project_id: "smoke", entry: "scripts/main.lua" }));
  fs.writeFileSync(path.join(root, "scripts", "main.lua"), [
    "local UI = require(\"urhox-libs/UI\")",
    "local root = UI.Panel { width = 720, height = 1280, children = {",
    "  UI.Label { id = \"title\", text = \"Smoke\", fontSize = 32 },",
    "  UI.Button { id = \"start\", text = \"开始\", width = 200, height = 64 },",
    "} }",
    "UI.SetRoot(root)",
    ""
  ].join("\n"));
  fs.writeFileSync(path.join(root, "assets", "images", "pixel.png"), Buffer.from(ONE_PIXEL_PNG, "base64"));
  return root;
}
