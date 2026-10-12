import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultImageCompressSettings,
  isTooBroadCompressTarget,
  readImageCompressSettings,
  revertCompressedFile,
  runImageCompress,
  writeImageCompressSettings
} from "./image-compress.js";
import { hashBytes, memoryCompressCache, openCompressCache } from "./image-compress-cache.js";
import { BUILTIN_COMMUNITY } from "./community-config.js";

describe("community builtin", () => {
  it("has required QQ fields", () => {
    expect(BUILTIN_COMMUNITY.qqGroupId).toMatch(/^\d+$/);
    expect(BUILTIN_COMMUNITY.qqGroupJoinUrl).toMatch(/^https:\/\//);
    expect(BUILTIN_COMMUNITY.qqGroupName.length).toBeGreaterThan(0);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("image compress settings", () => {
  const dir = path.join(os.tmpdir(), `tapmakerwork-compress-test-${process.pid}-${Date.now()}`);
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;

  afterEach(() => {
    restoreEnv("HOME", prevHome);
    restoreEnv("USERPROFILE", prevUserProfile);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to tiny disabled and persists keys outside project", () => {
    fs.mkdirSync(dir, { recursive: true });
    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    expect(readImageCompressSettings()).toEqual(defaultImageCompressSettings());
    const saved = writeImageCompressSettings({
      tinyEnabled: true,
      tinyKeys: ["key-one", "# comment should not matter", "key-two"],
      useWebFallback: false
    });
    expect(saved.tinyEnabled).toBe(true);
    expect(saved.useWebFallback).toBe(false);
    expect(saved.tinyKeys).toEqual(["key-one", "key-two"]);
    expect(fs.existsSync(path.join(dir, ".tapmakerwork", "tiny_keys.txt"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".tapmakerwork", "image-compress.json"))).toBe(true);
  });
});

describe("image compress progress", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  function makeImages(names: string[]): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-compress-run-"));
    roots.push(root);
    for (const name of names) {
      fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      fs.writeFileSync(path.join(root, name), Buffer.from(name.padEnd(100, "x")));
    }
    return root;
  }

  it("reports each file as it is processed and writes compressed bytes", async () => {
    const root = makeImages(["a.png", "ui/b.png", "ui/c.jpg", "notes.txt"]);
    const updates: Array<{ processed: number; current?: string }> = [];
    const result = await runImageCompress({
      target: root,
      cache: memoryCompressCache(),
      onProgress: (progress) => updates.push({ processed: progress.processed, ...(progress.current ? { current: progress.current } : {}) }),
      compress: async (filePath) => filePath.endsWith("b.png")
        ? { ok: false, error: "boom" }
        : filePath.endsWith("c.jpg")
          ? { ok: false, skipped: true }
          : { ok: true, engine: "fake", bytes: Buffer.alloc(40, 2) }
    });

    expect(result).toMatchObject({ state: "done", total: 3, processed: 3, compressed: 1, skipped: 1, failed: 1, savedBytes: 60, ok: false });
    expect(result.files.find((file) => file.path.endsWith("b.png"))).toMatchObject({ error: "boom", beforeBytes: 100 });
    expect(result.files.every((file) => typeof file.durationMs === "number")).toBe(true);
    expect(fs.statSync(path.join(root, "a.png")).size).toBe(40);
    expect(updates.some((update) => update.current?.endsWith("a.png") && update.processed === 0)).toBe(true);
    expect(updates.at(-1)).toEqual({ processed: 3 });
  });

  it("stops between files when cancelled", async () => {
    const root = makeImages(["a.png", "b.png", "c.png"]);
    const controller = new AbortController();
    const result = await runImageCompress({
      target: root,
      cache: memoryCompressCache(),
      signal: controller.signal,
      compress: async () => {
        controller.abort();
        return { ok: false, skipped: true };
      }
    });
    expect(result).toMatchObject({ state: "cancelled", total: 3, processed: 1 });
    expect(result.finishedAt).toBeTruthy();
  });

  it("fails fast on a missing target", async () => {
    const result = await runImageCompress({ target: path.join(os.tmpdir(), "tapmakerwork-missing-dir-xyz"), cache: memoryCompressCache() });
    expect(result.state).toBe("failed");
    expect(result.error).toContain("路径不存在");
  });

  it("skips files whose content hash is cached unless forced", async () => {
    const root = makeImages(["a.png", "b.png"]);
    const cache = memoryCompressCache();
    const shrink = async () => ({ ok: true, engine: "fake", bytes: Buffer.alloc(40, 2) });
    const first = await runImageCompress({ target: root, cache, compress: async (filePath) => filePath.endsWith("a.png") ? shrink() : { ok: false, skipped: true } });
    expect(first).toMatchObject({ compressed: 1, skipped: 1, cached: 0 });

    let calls = 0;
    const second = await runImageCompress({ target: root, cache, compress: async () => { calls += 1; return { ok: false, skipped: true }; } });
    expect(second).toMatchObject({ compressed: 0, skipped: 2, cached: 2 });
    expect(second.files.every((file) => file.cached)).toBe(true);
    expect(calls).toBe(0);

    await runImageCompress({ target: root, cache, force: true, compress: async () => { calls += 1; return { ok: false, skipped: true }; } });
    expect(calls).toBe(2);
  });

  it("backs up originals and reverts a compressed file", async () => {
    const root = makeImages(["a.png"]);
    const backupDir = path.join(root, ".backup");
    const cache = memoryCompressCache();
    const original = fs.readFileSync(path.join(root, "a.png"));
    const result = await runImageCompress({ target: root, cache, backupDir, compress: async () => ({ ok: true, bytes: Buffer.alloc(40, 2) }) });
    expect(result.files[0]).toMatchObject({ success: true, backedUp: true });

    revertCompressedFile(result, 0, backupDir, cache);
    expect(fs.readFileSync(path.join(root, "a.png"))).toEqual(original);
    expect(result).toMatchObject({ compressed: 0, savedBytes: 0 });
    expect(result.files[0]?.reverted).toBe(true);
    expect(cache.has(hashBytes(original))).toBe(true);
    expect(() => revertCompressedFile(result, 0, backupDir, cache)).toThrow("file_not_revertable");
  });
});

describe("compress cache file", () => {
  it("persists remembered hashes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-compress-cache-"));
    const cachePath = path.join(dir, "cache.json");
    const cache = openCompressCache(cachePath);
    cache.remember("abc");
    cache.save();
    expect(openCompressCache(cachePath).has("abc")).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("image compress target guard", () => {
  it("rejects the filesystem root and the home directory", () => {
    expect(isTooBroadCompressTarget(path.parse(process.cwd()).root)).toBe(true);
    expect(isTooBroadCompressTarget(os.homedir())).toBe(true);
    expect(isTooBroadCompressTarget(path.join(os.homedir(), "game", "assets"))).toBe(false);
  });
});
