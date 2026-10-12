import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { REQUIRED_MAKER_MCP_VERSION } from "@tapmakerwork/protocol";
import type { DesktopPermissionState, DesktopUpdateState } from "../desktop-api";
import { DesktopPermissionsCard, DesktopUpdateCard, MakerVersionSettings } from "./settings-cards";
import type { MakerVersionState, NodeVersionState } from "./types";

const done = async () => undefined;

const makerVersions: MakerVersionState = {
  preference: { mode: "stable" },
  active: { version: "0.0.30", entry: "/maker/0.0.30" },
  installed: [{ version: "0.0.30", entry: "/maker/0.0.30" }],
  channels: {
    stable: { installed: "0.0.30", latest: "0.0.35", updateAvailable: true },
    beta: { updateAvailable: false }
  }
};

const nodeVersions: NodeVersionState = {
  device: { version: "v18.0.0", executable: "/usr/bin/node" },
  embedded: { version: "v22.0.0", executable: "/app/node" },
  active: { version: "v18.0.0", executable: "/usr/bin/node", source: "device" },
  installed: [],
  stable: { latest: "v22.11.0", updateAvailable: true },
  upgrade: { manager: "nvm", label: "nvm", command: "nvm install --lts", terminal: "终端", oneClick: false }
};

function renderMaker(busy: "" | "check" = "") {
  return renderToStaticMarkup(
    <MakerVersionSettings
      makerVersions={makerVersions}
      nodeVersions={nodeVersions}
      busy={busy}
      onCheck={done}
      onSelect={done}
      onInstallRequired={done}
      onInstallChannel={done}
      onSyncNode={done}
      onUpgradeNode={done}
      onCopy={done}
    />
  );
}

describe("settings cards", () => {
  it("shows channel versions, the required upgrade and the copyable node command", () => {
    const html = renderMaker();
    expect(html).toContain("正在使用");
    expect(html).toContain("更新 0.0.35");
    expect(html).toContain(`升级到 ${REQUIRED_MAKER_MCP_VERSION}`);
    expect(html).toContain("nvm install --lts");
    expect(html).toContain("请粘贴到终端执行");
    expect(html).not.toContain("一键升级");
  });

  it("marks the check button busy while checking", () => {
    expect(renderMaker("check")).toContain("检查中…");
  });

  it("offers update actions only when a new version is available", () => {
    const base: DesktopUpdateState = { phase: "up-to-date", currentVersion: "0.1.6", packaged: true };
    const latest = renderToStaticMarkup(<DesktopUpdateCard update={base} busy="" onAction={done} onOpenUrl={() => undefined} />);
    expect(latest).toContain("最新");
    expect(latest).not.toContain("立即更新");
    const available = renderToStaticMarkup(
      <DesktopUpdateCard update={{ ...base, phase: "available", availableVersion: "0.1.7" }} busy="" onAction={done} onOpenUrl={() => undefined} />
    );
    expect(available).toContain("可更新 0.1.7");
    expect(available).toContain("立即更新");
  });

  it("disables granted permissions and enables restart once ready", () => {
    const permissions: DesktopPermissionState = { platform: "darwin", packaged: true, stableIdentity: true, screen: "granted", accessibility: "denied", ready: false };
    const html = renderToStaticMarkup(
      <DesktopPermissionsCard permissions={permissions} busy="" confirmed={false} onAction={done} onOpenGuide={() => undefined} />
    );
    expect(html).toContain("需处理");
    expect(html).toMatch(/<button disabled="">完成<\/button>/);
    expect(html).toMatch(/<button class="primary" disabled="">重启应用<\/button>/);
  });
});
