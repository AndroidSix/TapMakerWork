import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";

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
  source: "device" | "managed" | "embedded";
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

function commandOutput(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      timeout: 4_000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

function systemNodeCandidates(): string[] {
  const candidates = [process.env.TAPMAKERWORK_NODE, process.env.NODE];
  const executableName = process.platform === "win32" ? "node.exe" : "node";
  for (const directory of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(directory, executableName));
  }
  if (process.platform === "win32") {
    candidates.push(...commandOutput("where.exe", ["node"]).split(/\r?\n/));
    if (process.env.ProgramFiles) candidates.push(path.join(process.env.ProgramFiles, "nodejs", "node.exe"));
    if (process.env.LOCALAPPDATA) {
      candidates.push(path.join(process.env.LOCALAPPDATA, "Programs", "nodejs", "node.exe"));
      candidates.push(path.join(process.env.LOCALAPPDATA, "Volta", "bin", "node.exe"));
    }
  } else {
    const shell = process.env.SHELL && fs.existsSync(process.env.SHELL) ? process.env.SHELL : "/bin/zsh";
    candidates.push(...commandOutput(shell, ["-lic", "command -v node"]).split(/\r?\n/));
    candidates.push("/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node");
  }
  return [...new Set(candidates.map((candidate) => candidate?.trim()).filter((candidate): candidate is string => Boolean(candidate)))];
}

export function resolveSystemNodeRuntime(candidates = systemNodeCandidates()): NodeRuntime | undefined {
  for (const candidate of candidates) {
    try {
      if (!path.isAbsolute(candidate) || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
      const version = normalizedNodeVersion(commandOutput(candidate, ["--version"]));
      if (!VERSION_PATTERN.test(version)) continue;
      return { executable: fs.realpathSync(candidate), version, source: "device" };
    } catch {
      // Keep probing: GUI apps often inherit an incomplete PATH on a new machine.
    }
  }
  return undefined;
}

export function discoverNodeRuntime(): NodeRuntime {
  return resolveSystemNodeRuntime() ?? {
    executable: process.execPath,
    version: normalizedNodeVersion(process.version),
    source: "embedded"
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

/** Extract Maker CLI JSON error payloads embedded in thrown Error.message / stdout. */
export function parseMakerCliFailure(raw: unknown): { ok: false; result?: string; error?: string; message: string } | undefined {
  const text = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "";
  if (!text.trim()) return undefined;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { ok?: boolean; result?: string; error?: string };
    if (parsed && parsed.ok === false) {
      const detail = typeof parsed.error === "string" ? parsed.error : text;
      return {
        ok: false,
        message: detail,
        error: detail,
        ...(typeof parsed.result === "string" ? { result: parsed.result } : {})
      };
    }
  } catch {
    // not JSON
  }
  return undefined;
}

export function isPreviewSupervisorUnreachable(raw: unknown): boolean {
  const text = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : String(raw ?? "");
  return /Preview supervisor is unreachable/i.test(text)
    || /Process ownership is unverified/i.test(text)
    || /Previous preview ownership could not be verified/i.test(text);
}

export type ProcessPresence = "alive" | "missing" | "unknown";

/** Maker stores per-project preview state under ~/.taptap-maker/preview/<sha256(realpath)>. */
export function resolveMakerPreviewDirectory(projectRoot: string, makerHome = path.join(os.homedir(), ".taptap-maker")): string {
  const project = fs.realpathSync(projectRoot);
  return path.join(makerHome, "preview", createHash("sha256").update(project).digest("hex"));
}

/**
 * Same contract as Maker's processPresence, with a Windows tasklist fallback.
 * PID <= 0 means “no process registered” for recovery purposes.
 */
export function probeProcessPresence(pid: number): ProcessPresence {
  if (!Number.isInteger(pid) || pid <= 0) return "missing";
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return "missing";
  }
  if (process.platform === "win32") {
    const output = commandOutput("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
    if (!output || /info:\s*no tasks/i.test(output) || /没有.*任务/i.test(output)) return "missing";
    if (new RegExp(`(^|,)"?${pid}"?(,|$)`).test(output.replace(/\s+/g, ""))) return "alive";
    if (output.includes(String(pid))) return "alive";
  }
  return "unknown";
}

function windowsProcessImageName(pid: number): string {
  if (process.platform !== "win32" || pid <= 0) return "";
  const output = commandOutput("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
  if (!output || /info:\s*no tasks/i.test(output)) return "";
  const match = /^"([^"]+)"/.exec(output.trim());
  return match?.[1]?.toLowerCase() ?? "";
}

function looksLikeMakerPreviewProcess(pid: number): boolean {
  if (process.platform !== "win32") return true;
  const name = windowsProcessImageName(pid);
  if (!name) return false;
  return /^(node\.exe|urhoxruntime\.exe|powershell\.exe|pwsh\.exe|cmd\.exe)$/i.test(name);
}

export interface MakerPreviewSessionRecord {
  project_realpath?: string;
  state?: string;
  supervisor_pid?: number;
  runtime_pid?: number;
  session_id?: string;
  started_at?: string;
}

export interface RetireStalePreviewSessionResult {
  retired: boolean;
  reason: string;
  sessionPath?: string;
  supervisorPid?: number;
  runtimePid?: number;
}

/**
 * When Maker refuses start/stop because the control channel is dead but a session.json
 * still claims ownership, retire that record only if both recorded PIDs are gone
 * (or reused by an unrelated process on Windows). Never kill processes.
 */
export function retireStaleMakerPreviewSession(
  projectRoot: string,
  options?: { makerHome?: string; now?: number }
): RetireStalePreviewSessionResult {
  let project: string;
  try {
    project = fs.realpathSync(projectRoot);
  } catch {
    return { retired: false, reason: "project_unreadable" };
  }
  const previewDir = resolveMakerPreviewDirectory(project, options?.makerHome ?? path.join(os.homedir(), ".taptap-maker"));
  const sessionPath = path.join(previewDir, "session.json");
  if (!fs.existsSync(sessionPath)) return { retired: false, reason: "no_session", sessionPath };

  let record: MakerPreviewSessionRecord;
  try {
    record = JSON.parse(fs.readFileSync(sessionPath, "utf8")) as MakerPreviewSessionRecord;
  } catch {
    return { retired: false, reason: "session_unreadable", sessionPath };
  }
  if (record.project_realpath && record.project_realpath !== project) {
    return { retired: false, reason: "project_mismatch", sessionPath };
  }
  if (record.state === "stopped") {
    return { retired: false, reason: "already_stopped", sessionPath };
  }

  const supervisorPid = Number(record.supervisor_pid ?? 0);
  const runtimePid = Number(record.runtime_pid ?? 0);
  const supervisorPresence = probeProcessPresence(supervisorPid);
  const runtimePresence = probeProcessPresence(runtimePid);

  const supervisorSafe = supervisorPresence === "missing"
    || (supervisorPresence === "alive" && !looksLikeMakerPreviewProcess(supervisorPid));
  const runtimeSafe = runtimePresence === "missing"
    || (runtimePresence === "alive" && !looksLikeMakerPreviewProcess(runtimePid));

  if (!supervisorSafe || !runtimeSafe) {
    return {
      retired: false,
      reason: `pids_not_safe:supervisor=${supervisorPresence},runtime=${runtimePresence}`,
      sessionPath,
      supervisorPid,
      runtimePid
    };
  }

  const stamp = new Date(options?.now ?? Date.now()).toISOString().replace(/[:.]/g, "-");
  const retiredPath = path.join(previewDir, `session.json.retired.${stamp}`);
  try {
    fs.renameSync(sessionPath, retiredPath);
  } catch (error) {
    return {
      retired: false,
      reason: `rename_failed:${error instanceof Error ? error.message : String(error)}`,
      sessionPath,
      supervisorPid,
      runtimePid
    };
  }

  const lockPath = path.join(previewDir, "operation.lock");
  if (fs.existsSync(lockPath)) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf8")) as { pid?: number };
      if (probeProcessPresence(Number(lock.pid ?? 0)) === "missing") fs.unlinkSync(lockPath);
    } catch {
      // Leave the lock alone when ownership cannot be confirmed.
    }
  }

  return {
    retired: true,
    reason: "session_retired",
    sessionPath: retiredPath,
    supervisorPid,
    runtimePid
  };
}

/**
 * Windows often leaves a stale preview session after antivirus/WMI launch races.
 * Maker then refuses start/stop until the dead supervisor record is cleared.
 * Recovery: stop → retry start → if still stuck, safely retire dead session.json → start again.
 */
export async function runMakerPreviewStartWithRecovery(
  runtime: MakerRuntime,
  project: string,
  timeoutMs = 60_000,
  onRecover?: (message: string) => void
): Promise<unknown> {
  const looksFailed = (value: unknown) => {
    if (isPreviewSupervisorUnreachable(value)) return true;
    if (value && typeof value === "object" && "ok" in value && (value as { ok?: boolean }).ok === false) {
      return isPreviewSupervisorUnreachable(JSON.stringify(value));
    }
    return false;
  };

  const attemptStart = async () => {
    try {
      const result = await runMakerCommand(runtime, project, "start", timeoutMs);
      if (!looksFailed(result)) return { ok: true as const, result };
      return { ok: false as const, result };
    } catch (error) {
      if (!isPreviewSupervisorUnreachable(error)) throw error;
      return { ok: false as const, error };
    }
  };

  const first = await attemptStart();
  if (first.ok) return first.result;

  onRecover?.("检测到预览 Supervisor 不可达（常见于 Windows 残留会话），正在 stop 后重试 start…");
  try {
    await runMakerCommand(runtime, project, "stop", Math.min(timeoutMs, 30_000));
  } catch {
    // stop may also fail with the same ownership message; continue recovery
  }

  const second = await attemptStart();
  if (second.ok) return second.result;

  onRecover?.("stop 后仍不可达，正在安全退役已确认死亡的预览会话记录（不杀进程）…");
  const retired = retireStaleMakerPreviewSession(project);
  if (retired.retired) {
    onRecover?.(`已退役残留会话：${retired.sessionPath}`);
  } else {
    onRecover?.(`无法自动退役会话（${retired.reason}）。若 PID 仍存活请先在任务管理器结束 UrhoXRuntime / node。`);
  }

  const third = await attemptStart();
  if (third.ok) return third.result;
  if ("error" in third && third.error) throw third.error;
  return third.result;
}

export function formatMakerPreviewError(raw: unknown): string {
  const parsed = parseMakerCliFailure(raw);
  const detail = parsed?.error || (raw instanceof Error ? raw.message : String(raw ?? "unknown"));
  if (isPreviewSupervisorUnreachable(detail)) {
    return [
      "Maker 预览 Supervisor 不可达（Windows 常见：上次预览异常退出后会话残留，或杀毒/WMI 后台启动被拦截）。",
      "已自动尝试：stop 重试 → 退役确认死亡的 session.json → 再次 start。",
      "若仍失败，请在本机执行：",
      "1) 任务管理器结束 UrhoXRuntime / TapTap Maker Preview / 相关 node 进程",
      "2) 删除或重命名：%USERPROFILE%\\.taptap-maker\\preview\\<项目哈希>\\session.json",
      "3) 在项目目录运行：npx @taptap/maker preview stop --target-dir . --json",
      "4) 再运行：npx @taptap/maker preview start --target-dir . --json",
      "5) 若 supervisor 日志为空，检查杀毒软件是否拦截 Node/PowerShell 后台启动；仍不行可重启电脑后再开预览",
      `原始错误：${detail}`
    ].join("\n");
  }
  return detail;
}
