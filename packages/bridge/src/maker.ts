import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const MAKER_PACKAGE = "@taptap/maker";
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export type MakerRuntimeMode = "device" | "stable" | "beta" | "version";

export interface MakerRuntimePreference {
  mode: MakerRuntimeMode;
  version?: string | undefined;
}

export interface MakerRemoteVersions {
  stable?: string | undefined;
  beta?: string | undefined;
  versions: string[];
  checkedAt: string;
}

export interface MakerRuntime {
  node: string;
  entry: string;
  version: string;
}

export interface NodeRuntime {
  executable: string;
  version: string;
  source: "device" | "managed";
}

export interface NodeRemoteVersion {
  stable?: string | undefined;
  checkedAt: string;
}

function makerRuntimeRoot(): string {
  return path.join(os.homedir(), ".taptap-maker", "mcp-runtime");
}

function makerPreferenceFile(): string {
  return path.join(os.homedir(), ".tapmakerwork", "maker-runtime.json");
}

function nodeRuntimeRoot(): string {
  return path.join(os.homedir(), ".tapmakerwork", "node-runtime");
}

function normalizedNodeVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

function parsedVersion(version: string): { core: number[]; prerelease: string[] } | undefined {
  const match = VERSION_PATTERN.exec(version);
  if (!match) return undefined;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split(".") ?? []
  };
}

export function compareMakerVersions(leftVersion: string, rightVersion: string): number {
  const left = parsedVersion(leftVersion);
  const right = parsedVersion(rightVersion);
  if (!left || !right) return leftVersion.localeCompare(rightVersion, undefined, { numeric: true });
  for (let index = 0; index < 3; index += 1) {
    const difference = (left.core[index] ?? 0) - (right.core[index] ?? 0);
    if (difference) return difference;
  }
  if (!left.prerelease.length && right.prerelease.length) return 1;
  if (left.prerelease.length && !right.prerelease.length) return -1;
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart == null) return -1;
    if (rightPart == null) return 1;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined;
    if (leftNumber !== undefined && rightNumber !== undefined && leftNumber !== rightNumber) return leftNumber - rightNumber;
    if (leftNumber !== undefined && rightNumber === undefined) return -1;
    if (leftNumber === undefined && rightNumber !== undefined) return 1;
    const difference = leftPart.localeCompare(rightPart);
    if (difference) return difference;
  }
  return 0;
}

export function listInstalledNodeRuntimes(runtimeRoot = nodeRuntimeRoot()): NodeRuntime[] {
  if (!fs.existsSync(runtimeRoot)) return [];
  const executableName = process.platform === "win32" ? "node.exe" : "node";
  return fs.readdirSync(runtimeRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && VERSION_PATTERN.test(normalizedNodeVersion(entry.name)))
    .map((entry) => {
      const version = normalizedNodeVersion(entry.name);
      return {
        version,
        executable: path.join(runtimeRoot, entry.name, "node_modules", "node", "bin", executableName),
        source: "managed" as const
      };
    })
    .filter((runtime) => fs.existsSync(runtime.executable))
    .sort((left, right) => compareMakerVersions(right.version, left.version));
}

export function discoverNodeRuntime(runtimeRoot = nodeRuntimeRoot()): NodeRuntime {
  return listInstalledNodeRuntimes(runtimeRoot)[0] ?? {
    executable: process.execPath,
    version: normalizedNodeVersion(process.version),
    source: "device"
  };
}

export function listInstalledMakerRuntimes(runtimeRoot = makerRuntimeRoot()): MakerRuntime[] {
  if (!fs.existsSync(runtimeRoot)) return [];
  const node = discoverNodeRuntime().executable;
  return fs.readdirSync(runtimeRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      node,
      version: entry.name,
      entry: path.join(runtimeRoot, entry.name, "dist", "maker.js")
    }))
    .filter((candidate) => VERSION_PATTERN.test(candidate.version) && fs.existsSync(candidate.entry))
    .sort((a, b) => compareMakerVersions(b.version, a.version));
}

export async function checkNodeRuntimeUpdates(fetchImpl: typeof fetch = fetch): Promise<NodeRemoteVersion> {
  const response = await fetchImpl("https://nodejs.org/dist/index.json", {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`node_registry_${response.status}`);
  const data = await response.json() as Array<{ version?: string; lts?: string | boolean }>;
  const stable = data
    .map((release) => ({ version: normalizedNodeVersion(release.version || ""), lts: release.lts }))
    .filter((release) => release.lts && VERSION_PATTERN.test(release.version) && !release.version.includes("-"))
    .sort((left, right) => compareMakerVersions(right.version, left.version))[0]?.version;
  return { stable, checkedAt: new Date().toISOString() };
}

export function installNodeRuntimeVersion(
  requestedVersion: string,
  runtimeRoot = nodeRuntimeRoot(),
  timeoutMs = 10 * 60_000
): Promise<NodeRuntime> {
  const version = normalizedNodeVersion(requestedVersion);
  if (!VERSION_PATTERN.test(version) || version.includes("-")) return Promise.reject(new Error("invalid_node_version"));
  const target = path.join(runtimeRoot, version);
  fs.mkdirSync(target, { recursive: true });
  const npmEntry = process.env.npm_execpath;
  const useNpmEntry = Boolean(npmEntry && fs.existsSync(npmEntry));
  const command = useNpmEntry ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const args = [
    ...(useNpmEntry && npmEntry ? [npmEntry] : []),
    "install",
    "--prefix",
    target,
    `node@${version}`,
    "--no-save",
    "--omit=dev",
    "--no-audit",
    "--no-fund"
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: target,
      shell: false,
      windowsHide: true,
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
      if (code !== 0) return reject(new Error(stderr.trim() || stdout.trim() || `node_install_exit_${code}`));
      const installed = listInstalledNodeRuntimes(runtimeRoot).find((runtime) => runtime.version === version);
      if (!installed) return reject(new Error("node_install_not_found_after_install"));
      resolve(installed);
    });
  });
}

export function readMakerRuntimePreference(preferenceFile = makerPreferenceFile()): MakerRuntimePreference {
  try {
    const value = JSON.parse(fs.readFileSync(preferenceFile, "utf8")) as Partial<MakerRuntimePreference>;
    if (value.mode === "device" || value.mode === "stable" || value.mode === "beta") return { mode: value.mode };
    if (value.mode === "version" && typeof value.version === "string" && VERSION_PATTERN.test(value.version)) return { mode: "version", version: value.version };
  } catch {
    // Missing or invalid preferences intentionally fall back to the device default.
  }
  return { mode: "device" };
}

export function writeMakerRuntimePreference(preference: MakerRuntimePreference, preferenceFile = makerPreferenceFile()): void {
  const normalized = preference.mode === "version"
    ? { mode: "version" as const, version: preference.version }
    : { mode: preference.mode };
  if (normalized.mode === "version" && (!normalized.version || !VERSION_PATTERN.test(normalized.version))) throw new Error("invalid_maker_version");
  fs.mkdirSync(path.dirname(preferenceFile), { recursive: true });
  const temporary = `${preferenceFile}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, preferenceFile);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function selectMakerRuntime(installed: MakerRuntime[], preference: MakerRuntimePreference): MakerRuntime | undefined {
  if (preference.mode === "version") return installed.find((runtime) => runtime.version === preference.version);
  if (preference.mode === "stable") return installed.find((runtime) => !parsedVersion(runtime.version)?.prerelease.length);
  if (preference.mode === "beta") return installed.find((runtime) => Boolean(parsedVersion(runtime.version)?.prerelease.length));
  return installed[0];
}

export function discoverMakerRuntime(): MakerRuntime | undefined {
  return selectMakerRuntime(listInstalledMakerRuntimes(), readMakerRuntimePreference());
}

export async function checkMakerRuntimeUpdates(fetchImpl: typeof fetch = fetch): Promise<MakerRemoteVersions> {
  const response = await fetchImpl("https://registry.npmjs.org/@taptap%2fmaker", {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`maker_registry_${response.status}`);
  const data = await response.json() as { versions?: Record<string, unknown>; "dist-tags"?: { latest?: string; beta?: string } };
  const versions = Object.keys(data.versions ?? {}).filter((version) => VERSION_PATTERN.test(version)).sort(compareMakerVersions).reverse();
  const stableTag = data["dist-tags"]?.latest;
  const betaTag = data["dist-tags"]?.beta;
  const stable = stableTag && VERSION_PATTERN.test(stableTag) && !parsedVersion(stableTag)?.prerelease.length ? stableTag : undefined;
  const beta = betaTag && VERSION_PATTERN.test(betaTag) && parsedVersion(betaTag)?.prerelease.length ? betaTag : undefined;
  return {
    stable: stable ?? versions.find((version) => !parsedVersion(version)?.prerelease.length),
    beta: beta ?? versions.find((version) => Boolean(parsedVersion(version)?.prerelease.length)),
    versions: versions.slice(0, 20),
    checkedAt: new Date().toISOString()
  };
}

export function installMakerRuntimeVersion(version: string, timeoutMs = 10 * 60_000): Promise<unknown> {
  if (!VERSION_PATTERN.test(version)) return Promise.reject(new Error("invalid_maker_version"));
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  const cache = path.join(os.homedir(), ".taptap-maker", "cache", "npm");
  fs.mkdirSync(cache, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["-y", "--package", `${MAKER_PACKAGE}@${version}`, "taptap-maker", "upgrade", "--launcher", "self", "--json"], {
      cwd: os.homedir(),
      shell: false,
      windowsHide: true,
      env: { ...process.env, npm_config_cache: cache },
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
      if (code !== 0) return reject(new Error(stderr.trim() || stdout.trim() || `maker_upgrade_exit_${code}`));
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean).reverse();
      for (const line of lines) {
        try { resolve(JSON.parse(line)); return; } catch { /* progress output can precede JSON */ }
      }
      resolve({ ok: true, output: stdout.trim() });
    });
  });
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
