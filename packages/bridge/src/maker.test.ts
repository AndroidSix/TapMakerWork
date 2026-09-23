import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkNodeRuntimeUpdates,
  checkMakerRuntimeUpdates,
  compareMakerVersions,
  discoverNodeRuntime,
  listInstalledNodeRuntimes,
  listInstalledMakerRuntimes,
  readMakerRuntimePreference,
  resolveSystemNodeRuntime,
  selectMakerRuntime,
  writeMakerRuntimePreference
} from "./maker.js";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-maker-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("Maker runtime selection", () => {
  it("sorts stable and prerelease versions using semver precedence", () => {
    expect(compareMakerVersions("0.0.34-beta.7", "0.0.34-beta.4")).toBeGreaterThan(0);
    expect(compareMakerVersions("0.0.34", "0.0.34-beta.7")).toBeGreaterThan(0);
    expect(compareMakerVersions("0.0.35-beta.1", "0.0.34")).toBeGreaterThan(0);
  });

  it("uses the newest installed device version and supports stable/beta channels", () => {
    const root = temporaryDirectory();
    for (const version of ["0.0.32", "0.0.34-beta.4", "0.0.34-beta.7"]) {
      const dist = path.join(root, version, "dist");
      fs.mkdirSync(dist, { recursive: true });
      fs.writeFileSync(path.join(dist, "maker.js"), "", "utf8");
    }
    const installed = listInstalledMakerRuntimes(root);
    expect(installed.map((runtime) => runtime.version)).toEqual(["0.0.34-beta.7", "0.0.34-beta.4", "0.0.32"]);
    expect(selectMakerRuntime(installed, { mode: "device" })?.version).toBe("0.0.34-beta.7");
    expect(selectMakerRuntime(installed, { mode: "stable" })?.version).toBe("0.0.32");
    expect(selectMakerRuntime(installed, { mode: "beta" })?.version).toBe("0.0.34-beta.7");
  });

  it("persists an explicit version preference atomically", () => {
    const preferenceFile = path.join(temporaryDirectory(), "settings", "maker-runtime.json");
    expect(readMakerRuntimePreference(preferenceFile)).toEqual({ mode: "device" });
    writeMakerRuntimePreference({ mode: "version", version: "0.0.34-beta.7" }, preferenceFile);
    expect(readMakerRuntimePreference(preferenceFile)).toEqual({ mode: "version", version: "0.0.34-beta.7" });
  });

  it("reads stable and beta dist-tags from the official registry catalog", async () => {
    const fakeFetch = async () => new Response(JSON.stringify({
      versions: { "0.0.32": {}, "0.0.34-beta.4": {}, "0.0.34-beta.7": {} },
      "dist-tags": { latest: "0.0.32", beta: "0.0.34-beta.7" }
    }), { status: 200 });
    const catalog = await checkMakerRuntimeUpdates(fakeFetch as typeof fetch);
    expect(catalog.stable).toBe("0.0.32");
    expect(catalog.beta).toBe("0.0.34-beta.7");
  });

  it("keeps stable and beta channels separate when registry tags are malformed", async () => {
    const fakeFetch = async () => new Response(JSON.stringify({
      versions: { "0.0.34": {}, "0.0.35-beta.2": {} },
      "dist-tags": { latest: "0.0.35-beta.2", beta: "0.0.34" }
    }), { status: 200 });
    const catalog = await checkMakerRuntimeUpdates(fakeFetch as typeof fetch);
    expect(catalog.stable).toBe("0.0.34");
    expect(catalog.beta).toBe("0.0.35-beta.2");
  });

  it("selects only the newest stable LTS Node.js release", async () => {
    const fakeFetch = async () => new Response(JSON.stringify([
      { version: "v26.1.0", lts: false },
      { version: "v24.8.1", lts: "Krypton" },
      { version: "v22.20.0", lts: "Jod" }
    ]), { status: 200 });
    const catalog = await checkNodeRuntimeUpdates(fakeFetch as typeof fetch);
    expect(catalog.stable).toBe("24.8.1");
  });

  it("keeps legacy managed Node.js runtimes listed without overriding the system runtime", () => {
    const root = temporaryDirectory();
    const executableName = process.platform === "win32" ? "node.exe" : "node";
    for (const version of ["22.20.0", "24.8.1"]) {
      const bin = path.join(root, version, "node_modules", "node", "bin");
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(path.join(bin, executableName), "", "utf8");
    }
    expect(listInstalledNodeRuntimes(root).map((runtime) => runtime.version)).toEqual(["24.8.1", "22.20.0"]);
    expect(discoverNodeRuntime()).toMatchObject({ source: expect.stringMatching(/device|embedded/) });
  });

  it("resolves the real system executable and ignores invalid candidates", () => {
    expect(resolveSystemNodeRuntime([path.join(temporaryDirectory(), "missing-node"), process.execPath])).toMatchObject({
      executable: fs.realpathSync(process.execPath),
      version: process.version.replace(/^v/, ""),
      source: "device"
    });
  });

  it("detects Windows supervisor-unreachable Maker failures", async () => {
    const { isPreviewSupervisorUnreachable, parseMakerCliFailure, formatMakerPreviewError } = await import("./maker.js");
    const raw = '{"ok":false,"protocol_version":1,"result":"FAIL","error":"Error: Preview supervisor is unreachable. Process ownership is unverified; no PID was killed and no session was restarted.","artifacts":[]}';
    expect(isPreviewSupervisorUnreachable(raw)).toBe(true);
    expect(isPreviewSupervisorUnreachable("Previous preview ownership could not be verified. Refusing to start a duplicate session.")).toBe(true);
    expect(parseMakerCliFailure(raw)?.ok).toBe(false);
    expect(formatMakerPreviewError(raw)).toContain("Supervisor 不可达");
    expect(formatMakerPreviewError(raw)).toContain("session.json");
  });

  it("retires dead Maker preview session records without killing processes", async () => {
    const {
      resolveMakerPreviewDirectory,
      retireStaleMakerPreviewSession,
      probeProcessPresence
    } = await import("./maker.js");
    const project = temporaryDirectory();
    const makerHome = temporaryDirectory();
    const previewDir = resolveMakerPreviewDirectory(project, makerHome);
    fs.mkdirSync(previewDir, { recursive: true });
    const sessionPath = path.join(previewDir, "session.json");
    fs.writeFileSync(sessionPath, JSON.stringify({
      protocol_version: 1,
      project_realpath: fs.realpathSync(project),
      state: "running",
      supervisor_pid: 0,
      runtime_pid: 0,
      session_id: "00000000-0000-4000-8000-000000000001"
    }), "utf8");
    fs.writeFileSync(path.join(previewDir, "operation.lock"), JSON.stringify({ pid: 0 }), "utf8");

    expect(probeProcessPresence(0)).toBe("missing");
    const retired = retireStaleMakerPreviewSession(project, { makerHome });
    expect(retired.retired).toBe(true);
    expect(fs.existsSync(sessionPath)).toBe(false);
    expect(fs.existsSync(path.join(previewDir, "operation.lock"))).toBe(false);
    expect(fs.readdirSync(previewDir).some((name) => name.startsWith("session.json.retired."))).toBe(true);
  });

  it("refuses to retire a session when a recorded PID is still alive", async () => {
    const { resolveMakerPreviewDirectory, retireStaleMakerPreviewSession } = await import("./maker.js");
    const project = temporaryDirectory();
    const makerHome = temporaryDirectory();
    const previewDir = resolveMakerPreviewDirectory(project, makerHome);
    fs.mkdirSync(previewDir, { recursive: true });
    fs.writeFileSync(path.join(previewDir, "session.json"), JSON.stringify({
      protocol_version: 1,
      project_realpath: fs.realpathSync(project),
      state: "running",
      supervisor_pid: process.pid,
      runtime_pid: 0
    }), "utf8");
    const retired = retireStaleMakerPreviewSession(project, { makerHome });
    expect(retired.retired).toBe(false);
    expect(retired.reason).toContain("pids_not_safe");
    expect(fs.existsSync(path.join(previewDir, "session.json"))).toBe(true);
  });
});
