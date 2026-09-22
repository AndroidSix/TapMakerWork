import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultImageCompressSettings,
  readImageCompressSettings,
  writeImageCompressSettings
} from "./image-compress.js";
import { BUILTIN_COMMUNITY } from "./community-config.js";

describe("community builtin", () => {
  it("has required QQ fields", () => {
    expect(BUILTIN_COMMUNITY.qqGroupId).toMatch(/^\d+$/);
    expect(BUILTIN_COMMUNITY.qqGroupJoinUrl).toMatch(/^https:\/\//);
    expect(BUILTIN_COMMUNITY.qqGroupName.length).toBeGreaterThan(0);
  });
});

describe("image compress settings", () => {
  const dir = path.join(os.tmpdir(), `tapmakerwork-compress-test-${process.pid}-${Date.now()}`);
  const prevHome = process.env.HOME;

  afterEach(() => {
    process.env.HOME = prevHome;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to tiny disabled and persists keys outside project", () => {
    fs.mkdirSync(dir, { recursive: true });
    process.env.HOME = dir;
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
