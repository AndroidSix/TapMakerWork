import { describe, expect, it } from "vitest";
import { planNodeUpgrade, publicNodeUpgradePlan } from "./node-upgrade.js";

const device = (executable: string) => ({ executable, version: "18.0.0", source: "device" as const });
const always = () => true;
const never = () => false;

describe("planNodeUpgrade", () => {
  it("upgrades Windows installer builds with winget in one click", () => {
    const plan = planNodeUpgrade(device("C:\\Program Files\\nodejs\\node.exe"), { platform: "win32", exists: never });
    expect(plan.manager).toBe("winget");
    expect(plan.command).toContain("OpenJS.NodeJS.LTS");
    expect(plan.run?.command).toBe("winget");
  });

  it("uses the Homebrew formula and brew next to the Cellar", () => {
    const plan = planNodeUpgrade(device("/opt/homebrew/Cellar/node@20/20.1.0/bin/node"), { platform: "darwin", exists: always });
    expect(plan.command).toBe("brew upgrade node@20");
    expect(plan.run).toEqual({ command: "/opt/homebrew/bin/brew", args: ["upgrade", "node@20"] });
    expect(plan.note).toContain("brew install node");
  });

  it("sources nvm.sh for nvm installs", () => {
    const plan = planNodeUpgrade(device("/Users/me/.nvm/versions/node/v18.0.0/bin/node"), { platform: "darwin", exists: always });
    expect(plan.manager).toBe("nvm");
    expect(plan.run?.args[1]).toContain('. "/Users/me/.nvm/nvm.sh"');
  });

  it("keeps nvm-windows and fnm as copy-only commands", () => {
    const nvmWindows = planNodeUpgrade(device("C:\\Users\\me\\AppData\\Roaming\\nvm\\v18.0.0\\node.exe"), { platform: "win32", exists: always });
    expect(nvmWindows.manager).toBe("nvm-windows");
    expect(nvmWindows.run).toBeUndefined();
    const fnm = planNodeUpgrade(device("/Users/me/.local/share/fnm/node-versions/v18.0.0/installation/bin/node"), { platform: "darwin", exists: always });
    expect(fnm.manager).toBe("fnm");
    expect(publicNodeUpgradePlan(fnm)).toMatchObject({ oneClick: false, command: "fnm install --lts && fnm default lts-latest" });
  });

  it("uses Volta when Node comes from a Volta shim", () => {
    const plan = planNodeUpgrade(device("/Users/me/.volta/bin/volta-shim"), { platform: "darwin", exists: always });
    expect(plan.run).toEqual({ command: "/Users/me/.volta/bin/volta", args: ["install", "node@lts"] });
  });

  it("falls back to the official macOS pkg command with the latest LTS", () => {
    const plan = planNodeUpgrade(device("/usr/local/bin/node"), { platform: "darwin", latestLts: "22.11.0", exists: never });
    expect(plan.manager).toBe("macos-pkg");
    expect(plan.command).toContain("node-v22.11.0.pkg");
    expect(plan.run).toBeUndefined();
  });

  it("installs with Homebrew when no system Node exists on macOS", () => {
    const plan = planNodeUpgrade({ executable: "/Applications/TapMakerWork.app/x", version: "22.0.0", source: "embedded" }, {
      platform: "darwin",
      exists: (candidate) => candidate === "/usr/local/bin/brew"
    });
    expect(plan.run).toEqual({ command: "/usr/local/bin/brew", args: ["install", "node"] });
  });
});
