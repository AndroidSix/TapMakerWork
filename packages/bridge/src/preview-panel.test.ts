import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "vitest";
import {
  applyPreviewPanelPatch,
  bumpPreviewReload,
  resolvePreviewPanel
} from "./preview-panel.js";

function tempProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tmw-preview-"));
  fs.mkdirSync(path.join(root, ".tapmakerwork"), { recursive: true });
  return root;
}

describe("preview-panel", () => {
  it("resolvePreviewPanel keeps qrcode evidence out of the web preview channel", () => {
    const root = tempProject();
    const fromQr = resolvePreviewPanel(root, { qrcodeUrl: "https://example.test/qr", orientation: "landscape" });
    assert.equal(fromQr.url, "");
    assert.equal(fromQr.urlSource, "none");
    assert.equal(fromQr.orientation, "landscape");

    const patched = applyPreviewPanelPatch(root, { url: "https://example.test/live" }, { qrcodeUrl: "https://example.test/qr" });
    assert.equal(patched.url, "https://example.test/live");
    assert.equal(patched.urlSource, "manual");

    const merged = resolvePreviewPanel(root, { qrcodeUrl: "https://example.test/qr" });
    assert.equal(merged.url, "https://example.test/live");
    assert.equal(merged.urlSource, "manual");

    const cleared = applyPreviewPanelPatch(root, { url: "" }, { qrcodeUrl: "https://example.test/qr" });
    assert.equal(cleared.url, "");
    assert.equal(cleared.urlSource, "none");
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
});
