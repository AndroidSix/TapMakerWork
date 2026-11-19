import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listMakerCacheNames, nativeMakerCacheNames } from "./runtime-cache-index.js";
import { findRuntimeFileStatus, runtimeFileSearchRoots } from "./runtime-file-channel.js";

const fixtures: string[] = [];

function tempDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-index-test-"));
  fixtures.push(directory);
  return directory;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of fixtures.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("Runtime cache index", () => {
  it("runs the native addon when explicitly requested", () => {
    if (process.env.TAPMAKERWORK_REQUIRE_RUST_INDEX === "1") expect(nativeMakerCacheNames).toBeTypeOf("function");
  });

  it("returns the same ordered names as the original scan, including non-directories", () => {
    const directory = tempDirectory();
    for (const name of ["maker-cache", "maker-cache-测", "maker-cache-z", "maker-cache-🎮", "maker-cache-A"]) fs.mkdirSync(path.join(directory, name));
    for (const name of ["xmaker-cache", "maker-cache.log", ".maker-cache", "unrelated", "Maker-Cache-uppercase"]) fs.writeFileSync(path.join(directory, name), "");
    if (process.platform !== "win32") fs.symlinkSync("missing", path.join(directory, "maker-cache-link"));
    const expected = fs.readdirSync(directory).filter((name) => name.startsWith("maker-cache"));
    expect(listMakerCacheNames(directory)).toEqual(expected);
    if (nativeMakerCacheNames) expect(nativeMakerCacheNames(directory)).toEqual(expected);
  });

  it("reads changes immediately rather than caching results", () => {
    const directory = tempDirectory();
    expect(listMakerCacheNames(directory)).toEqual([]);
    fs.mkdirSync(path.join(directory, "maker-cache-new"));
    expect(listMakerCacheNames(directory)).toEqual(["maker-cache-new"]);
    fs.rmdirSync(path.join(directory, "maker-cache-new"));
    expect(listMakerCacheNames(directory)).toEqual([]);
  });

  it("reports filesystem errors with the original Node semantics", () => {
    const directory = tempDirectory();
    expect(() => listMakerCacheNames(path.join(directory, "missing"))).toThrow(/ENOENT/);
    fs.writeFileSync(path.join(directory, "regular-file"), "");
    expect(() => listMakerCacheNames(path.join(directory, "regular-file"))).toThrow(/ENOTDIR|ENOENT/);
  });

  it("preserves Runtime selection when matching roots have identical timestamps", () => {
    const directory = tempDirectory();
    vi.stubEnv(process.platform === "win32" ? "TEMP" : "TMPDIR", directory);
    const time = new Date("2025-01-01T00:00:00Z");
    for (const name of ["maker-cache-z", "maker-cache-a", "other-cache"]) {
      const root = path.join(directory, name);
      fs.mkdirSync(root);
      const status = path.join(root, "tapmakerwork-runtime-status.json");
      fs.writeFileSync(status, JSON.stringify({ sessionId: name, projectName: "fixture" }));
      fs.utimesSync(status, time, time);
    }
    const original = fs.readdirSync(directory).filter((name) => name.startsWith("maker-cache"));
    const searchRoots = runtimeFileSearchRoots().filter((root) => path.dirname(root) === directory);
    expect(searchRoots).toEqual(original.map((name) => path.join(directory, name)));
    expect(findRuntimeFileStatus(searchRoots, { projectName: "fixture", previewProjects: new Map() })?.sessionId).toBe(original.at(-1));
  });
});
