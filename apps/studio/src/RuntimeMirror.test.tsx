// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { UiSnapshot } from "@tapmakerwork/protocol";
import { RuntimeMirror } from "./RuntimeMirror";

const noop = () => undefined;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const portraitSnapshot: UiSnapshot = { revision: 1, viewport: { width: 720, height: 1280 }, root: { id: "root", type: "Panel", name: "Root", props: {}, children: [] } };

it("keeps a wide frame before the bridge connects, then uses the actual Runtime viewport", async () => {
  const captureRuntime = vi.fn(async () => ({ ok: true, dataUrl: "frame", width: 1500, height: 700 }));
  window.tapMakerWork = { desktop: true, platform: "darwin", captureRuntime };
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = (live: boolean) => <RuntimeMirror
    runtimeLive runtimeConnected={live} runtimeBusy={false} adapterInstalled installBusy={false}
    projectName="Wide game" orientation="landscape"
    snapshot={live ? { ...portraitSnapshot, viewport: { width: 1440, height: 720 } } : portraitSnapshot}
    snapshotSource={live ? "runtime" : "conversion"} selectedIds={[]} editRevision={0} mode="live-edit"
    onModeChange={noop} onStart={noop} onInstallAdapter={noop} onSelect={noop} onPermissionAction={async () => undefined}
    onContextMenu={noop} onPatch={async () => undefined} onToast={noop} syncCode onSyncCodeChange={noop}
  />;
  try {
    await act(async () => root.render(render(false)));
    expect(captureRuntime).toHaveBeenLastCalledWith({ projectName: "Wide game", orientation: "landscape" });
    expect(container.querySelector(".runtime-editor-stacked")).not.toBeNull();
    await act(async () => root.render(render(true)));
    expect(captureRuntime).toHaveBeenLastCalledWith({ projectName: "Wide game", orientation: "landscape", viewportWidth: 1440, viewportHeight: 720 });
  } finally {
    await act(async () => root.unmount());
    delete window.tapMakerWork;
  }
});
