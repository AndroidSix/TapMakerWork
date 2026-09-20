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

  it("prefers the newest managed Node.js runtime over the device runtime", () => {
    const root = temporaryDirectory();
    const executableName = process.platform === "win32" ? "node.exe" : "node";
    for (const version of ["22.20.0", "24.8.1"]) {
      const bin = path.join(root, version, "node_modules", "node", "bin");
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(path.join(bin, executableName), "", "utf8");
    }
    expect(listInstalledNodeRuntimes(root).map((runtime) => runtime.version)).toEqual(["24.8.1", "22.20.0"]);
    expect(discoverNodeRuntime(root)).toMatchObject({ version: "24.8.1", source: "managed" });
  });
});
