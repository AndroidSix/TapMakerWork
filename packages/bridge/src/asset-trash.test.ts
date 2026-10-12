import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAssetSizeReport,
  listTrashedAssets,
  moveUnreferencedAssetsToTrash,
  purgeTrashedAssets,
  restoreTrashedAssets
} from "./asset-trash.js";
import { listProjectAssets } from "./ide-tools.js";

const temporary: string[] = [];

function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-trash-"));
  temporary.push(root);
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "main.lua"), 'local hero = "image/hero.png"', "utf8");
  fs.mkdirSync(path.join(root, "assets", "image"), { recursive: true });
  fs.writeFileSync(path.join(root, "assets", "image", "hero.png"), Buffer.alloc(80 * 1024));
  fs.writeFileSync(path.join(root, "assets", "image", "unused.png"), Buffer.alloc(10));
  return root;
}

afterEach(() => {
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("asset trash", () => {
  it("moves only unreferenced assets and restores them", () => {
    const root = project();
    const moved = moveUnreferencedAssetsToTrash(root, listProjectAssets(root), ["assets/image/unused.png", "assets/image/hero.png"]);
    expect(moved.moved.map((entry) => entry.originalPath)).toEqual(["assets/image/unused.png"]);
    expect(moved.skipped).toEqual([{ path: "assets/image/hero.png", reason: "not_unreferenced" }]);
    expect(fs.existsSync(path.join(root, "assets", "image", "unused.png"))).toBe(false);
    expect(listProjectAssets(root).map((asset) => asset.name)).toEqual(["hero.png"]);

    const restored = restoreTrashedAssets(root, [moved.moved[0]!.id]);
    expect(restored.restored).toHaveLength(1);
    expect(fs.readFileSync(path.join(root, "assets", "image", "unused.png")).length).toBe(10);
    expect(listTrashedAssets(root)).toEqual([]);
  });

  it("refuses to overwrite a file that reappeared at the original path", () => {
    const root = project();
    const [entry] = moveUnreferencedAssetsToTrash(root, listProjectAssets(root), ["assets/image/unused.png"]).moved;
    fs.writeFileSync(path.join(root, "assets", "image", "unused.png"), "new", "utf8");
    expect(restoreTrashedAssets(root, [entry!.id]).skipped).toEqual([{ id: entry!.id, reason: "target_exists" }]);
    expect(listTrashedAssets(root)).toHaveLength(1);
  });

  it("purges trashed files permanently", () => {
    const root = project();
    const [entry] = moveUnreferencedAssetsToTrash(root, listProjectAssets(root), ["assets/image/unused.png"]).moved;
    expect(purgeTrashedAssets(root, [entry!.id])).toHaveLength(1);
    expect(listTrashedAssets(root)).toEqual([]);
    expect(fs.existsSync(path.join(root, ".tapmakerwork", "trash", "files", entry!.id))).toBe(false);
  });
});

describe("asset size report", () => {
  it("summarizes kinds, unreferenced bytes and compress candidates", () => {
    const root = project();
    const report = buildAssetSizeReport(listProjectAssets(root), []);
    expect(report.totalBytes).toBe(80 * 1024 + 10);
    expect(report.byKind.image).toEqual({ count: 2, bytes: 80 * 1024 + 10 });
    expect(report.unreferenced).toEqual({ count: 1, bytes: 10 });
    expect(report.compressCandidates).toEqual({ count: 1, bytes: 80 * 1024 });
    expect(report.largest[0]).toMatchObject({ path: "assets/image/hero.png", referenced: true });
  });

  it("skips images that are already compressed", () => {
    const root = project();
    const report = buildAssetSizeReport(listProjectAssets(root), [], (asset) => asset.name === "hero.png");
    expect(report.compressCandidates.count).toBe(0);
  });
});
