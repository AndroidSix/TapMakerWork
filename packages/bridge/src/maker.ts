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
    .sort((a, b) => {
      const score = (version: string) => {
        const beta = /beta/i.test(version) ? 1 : 0;
        const nums = version.match(/\d+/g)?.map(Number) ?? [0];
        return beta * 10000 + (nums[0] || 0) * 1000 + (nums[1] || 0) * 100 + (nums[2] || 0);
      };
      return score(b.version) - score(a.version);
    });
  const current = candidates[0];
  return current ? { node: process.execPath, entry: current.entry, version: current.version } : undefined;
}

function runMakerArgs(
  runtime: MakerRuntime,
  project: string,
  args: string[],
  timeoutMs: number
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(runtime.node, [runtime.entry, ...args, "--target-dir", project, "--json"], {
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

export function runMakerReadOnly(
  runtime: MakerRuntime,
  project: string,
  command: "status" | "logs",
  timeoutMs = 20_000
): Promise<unknown> {
  return runMakerCommand(runtime, project, command, timeoutMs);
}

export function runMakerDoctor(runtime: MakerRuntime, project: string, timeoutMs = 45_000): Promise<unknown> {
  return runMakerArgs(runtime, project, ["doctor"], timeoutMs);
}

export function runMakerBuild(runtime: MakerRuntime, project: string, timeoutMs = 10 * 60_000): Promise<unknown> {
  return runMakerArgs(runtime, project, ["build"], timeoutMs);
}

export function runMakerQrcode(
  runtime: MakerRuntime,
  project: string,
  orientation?: "portrait" | "landscape",
  timeoutMs = 3 * 60_000
): Promise<unknown> {
  const args = ["qrcode"];
  if (orientation === "portrait" || orientation === "landscape") {
    args.push("--confirmed-screen-orientation", orientation);
  }
  return runMakerArgs(runtime, project, args, timeoutMs);
}

export function readMakerProjectMeta(projectRoot: string): {
  title?: string | undefined;
  appId?: string | undefined;
  orientation?: string | undefined;
  publishStatus?: number | undefined;
  qrcodeUrl?: string | undefined;
  qrcodeGeneratedAt?: string | undefined;
} {
  try {
    const projectJson = path.join(projectRoot, ".project", "project.json");
    if (!fs.existsSync(projectJson)) return {};
    const parsed = JSON.parse(fs.readFileSync(projectJson, "utf8")) as {
      taptap_publish?: { title?: string; app_id?: number | string; screen_orientation?: string; publish_status?: number };
      test_qrcode?: { url?: string; generated_at?: string };
    };
    return {
      title: parsed.taptap_publish?.title,
      appId: parsed.taptap_publish?.app_id != null ? String(parsed.taptap_publish.app_id) : undefined,
      orientation: parsed.taptap_publish?.screen_orientation,
      publishStatus: parsed.taptap_publish?.publish_status,
      qrcodeUrl: parsed.test_qrcode?.url,
      qrcodeGeneratedAt: parsed.test_qrcode?.generated_at
    };
  } catch {
    return {};
  }
}

export function runMakerCommand(
  runtime: MakerRuntime,
  project: string,
  command: "start" | "stop" | "refresh" | "status" | "logs",
  timeoutMs = 60_000
): Promise<unknown> {
  return runMakerArgs(runtime, project, ["preview", command], timeoutMs);
}
