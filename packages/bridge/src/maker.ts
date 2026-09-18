import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export interface MakerRuntime {
  node: string;
  entry: string;
  version: string;
}

export function discoverMakerRuntime(): MakerRuntime | undefined {
  const runtimeRoot = path.join(os.homedir(), ".taptap-maker", "mcp-runtime");
  if (!fs.existsSync(runtimeRoot)) return undefined;
  const candidates = fs.readdirSync(runtimeRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      version: entry.name,
      entry: path.join(runtimeRoot, entry.name, "dist", "maker.js")
    }))
    .filter((candidate) => fs.existsSync(candidate.entry))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  const current = candidates[0];
  return current ? { node: process.execPath, entry: current.entry, version: current.version } : undefined;
}

export function runMakerReadOnly(
  runtime: MakerRuntime,
  project: string,
  command: "status" | "logs",
  timeoutMs = 20_000
): Promise<unknown> {
  return runMakerCommand(runtime, project, command, timeoutMs);
}

export function runMakerCommand(
  runtime: MakerRuntime,
  project: string,
  command: "start" | "stop" | "refresh" | "status" | "logs",
  timeoutMs = 60_000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(runtime.node, [runtime.entry, "preview", command, "--target-dir", project, "--json"], {
      cwd: project,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (value: string) => { stdout += value; });
    child.stderr.on("data", (value: string) => { stderr += value; });
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `maker_exit_${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
        return;
      } catch {
        // Some Maker commands print progress before the JSON result.
      }
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean).reverse();
      for (const line of lines) {
        try {
          resolve(JSON.parse(line));
          return;
        } catch {
          // Maker progress may precede its final JSON result.
        }
      }
      resolve({ output: stdout.trim() });
    });
  });
}
