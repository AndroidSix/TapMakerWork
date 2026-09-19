import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "vitest";
import {
  applyPreviewPanelPatch,
  bumpPreviewReload,
  listPreviewShots,
  resolvePreviewPanel,
  savePreviewShot
} from "./preview-panel.js";

function tempProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tmw-preview-"));
  fs.mkdirSync(path.join(root, ".tapmakerwork"), { recursive: true });
  return root;
}

describe("preview-panel", () => {
  it("resolvePreviewPanel prefers manual url over qrcode", () => {
    const root = tempProject();
    const fromQr = resolvePreviewPanel(root, { qrcodeUrl: "https://example.test/qr", orientation: "landscape" });
    assert.equal(fromQr.url, "https://example.test/qr");
    assert.equal(fromQr.urlSource, "qrcode");
    assert.equal(fromQr.orientation, "landscape");

    const patched = applyPreviewPanelPatch(root, { url: "https://example.test/live" }, { qrcodeUrl: "https://example.test/qr" });
    assert.equal(patched.url, "https://example.test/live");
    assert.equal(patched.urlSource, "manual");

    const merged = resolvePreviewPanel(root, { qrcodeUrl: "https://example.test/qr" });
    assert.equal(merged.url, "https://example.test/live");
    assert.equal(merged.urlSource, "manual");

    const cleared = applyPreviewPanelPatch(root, { url: "" }, { qrcodeUrl: "https://example.test/qr" });
    assert.equal(cleared.url, "https://example.test/qr");
    assert.equal(cleared.urlSource, "qrcode");
  });

  it("bumpPreviewReload increments token", () => {
    const root = tempProject();
    const first = bumpPreviewReload(root);
    assert.equal(first.reloadToken, 1);
    assert.ok(first.lastRefreshedAt);
    const second = bumpPreviewReload(root, { autoRefreshMaker: true });
    assert.equal(second.reloadToken, 2);
    assert.equal(second.autoRefreshMaker, true);
  });

  it("savePreviewShot writes under outputs/preview-shots", () => {
    const ideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tmw-ide-"));
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]).toString("base64");
    const saved = savePreviewShot(ideRoot, "demo-game", `data:image/png;base64,${png}`, "live-edit");
    assert.ok(saved.path.includes(path.join("outputs", "preview-shots", "demo-game")));
    assert.ok(fs.existsSync(saved.path));
    const shots = listPreviewShots(ideRoot, "demo-game");
    assert.equal(shots.length, 1);
    assert.equal(shots[0]?.path, saved.path);
  });
});
