import { spawn } from "node:child_process";
import fs from "node:fs";
import type { NodeRuntime } from "./maker.js";

export type NodeInstallManager = "winget" | "homebrew" | "volta" | "nvm" | "nvm-windows" | "fnm" | "macos-pkg" | "manual";

export interface NodeUpgradePlan {
  manager: NodeInstallManager;
  label: string;
  /** 用户可复制到终端执行的命令。 */
  command: string;
  terminal: "PowerShell" | "终端";
  note?: string;
  /** 存在时 IDE 可直接执行（一键升级）。 */
  run?: { command: string; args: string[] };
}

interface PlanOptions {
  platform?: NodeJS.Platform;
  latestLts?: string | undefined;
  exists?: (candidate: string) => boolean;
}

/** APPINSTALLER_CLI_ERROR_UPDATE_NOT_APPLICABLE（0x8A15002B）：已是最新版本。 */
const WINGET_ALREADY_LATEST = new Set([-1978335189, 2316632107]);
const WINGET_ARGS = ["install", "--id", "OpenJS.NodeJS.LTS", "-e", "--source", "winget", "--accept-package-agreements", "--accept-source-agreements"];

function prefixBefore(executable: string, marker: string): string | undefined {
  const index = executable.replace(/\\/g, "/").toLowerCase().indexOf(marker);
  return index < 0 ? undefined : executable.slice(0, index);
}

function joinPath(base: string, child: string, platform: NodeJS.Platform): string {
  const separator = platform === "win32" ? "\\" : "/";
  return `${base.replace(/[\\/]+$/, "")}${separator}${child}`;
}

function dirname(executable: string): string {
  return executable.replace(/[\\/][^\\/]*$/, "");
}

export function planNodeUpgrade(node: NodeRuntime, options: PlanOptions = {}): NodeUpgradePlan {
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? fs.existsSync;
  const normalized = node.source === "device" ? node.executable.replace(/\\/g, "/").toLowerCase() : "";
  const windows = platform === "win32";
  const terminal = windows ? "PowerShell" : "终端";
  const join = windows ? "; " : " && ";

  if (normalized.includes("/volta/") || normalized.includes("/.volta/")) {
    const volta = joinPath(dirname(node.executable), windows ? "volta.exe" : "volta", platform);
    return {
      manager: "volta",
      label: "Volta",
      command: "volta install node@lts",
      terminal,
      ...(exists(volta) ? { run: { command: volta, args: ["install", "node@lts"] } } : {})
    };
  }

  if (!windows && normalized.includes("/.nvm/")) {
    const nvmDir = `${prefixBefore(node.executable, "/.nvm/")}/.nvm`;
    const script = `. "${nvmDir}/nvm.sh" && nvm install --lts && nvm alias default 'lts/*'`;
    return {
      manager: "nvm",
      label: "nvm",
      command: "nvm install --lts && nvm alias default 'lts/*'",
      terminal,
      ...(exists(`${nvmDir}/nvm.sh`) ? { run: { command: "/bin/bash", args: ["-c", script] } } : {})
    };
  }

  if (normalized.includes("fnm")) {
    return {
      manager: "fnm",
      label: "fnm",
      command: `fnm install --lts${join}fnm default lts-latest`,
      terminal,
      note: "fnm 的版本切换依赖终端环境，请在终端执行后重新打开终端。"
    };
  }

  if (windows && (normalized.includes("/nvm/") || normalized.includes("/nvm4w/"))) {
    return {
      manager: "nvm-windows",
      label: "nvm-windows",
      command: "nvm install lts; nvm use lts",
      terminal,
      note: "nvm use 需要管理员权限：请右键「以管理员身份运行」PowerShell 后执行。"
    };
  }

  if (normalized.includes("/cellar/")) {
    const brewPrefix = prefixBefore(node.executable, "/cellar/")!;
    const formula = normalized.split("/cellar/")[1]?.split("/")[0] || "node";
    const brew = `${brewPrefix}/bin/brew`;
    return {
      manager: "homebrew",
      label: "Homebrew",
      command: `brew upgrade ${formula}`,
      terminal,
      ...(formula !== "node" ? { note: `${formula} 锁定了大版本；如需最新 LTS，可改用 brew install node。` } : {}),
      ...(exists(brew) ? { run: { command: brew, args: ["upgrade", formula] } } : {})
    };
  }

  if (windows) {
    return {
      manager: "winget",
      label: "winget（官方 LTS 安装包）",
      command: `winget ${WINGET_ARGS.join(" ")}`,
      terminal,
      note: "安装过程中 Windows 可能弹出管理员授权，请点「是」。升级前建议先停止 Runtime 预览。",
      run: { command: "winget", args: WINGET_ARGS }
    };
  }

  if (platform === "darwin") {
    const brew = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"].find((candidate) => exists(candidate));
    if (node.source !== "device" && brew) {
      return { manager: "homebrew", label: "Homebrew", command: "brew install node", terminal, run: { command: brew, args: ["install", "node"] } };
    }
    const version = options.latestLts;
    return {
      manager: "macos-pkg",
      label: "官方安装包",
      command: version
        ? `curl -fL -o /tmp/node-lts.pkg https://nodejs.org/dist/v${version}/node-v${version}.pkg && sudo installer -pkg /tmp/node-lts.pkg -target /`
        : "open https://nodejs.org/zh-cn/download",
      terminal,
      note: version ? "命令会要求输入本机登录密码（sudo）。" : "先点「检查更新」获取最新 LTS 后可生成一行安装命令。"
    };
  }

  return {
    manager: "manual",
    label: "nvm",
    command: "curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash && . ~/.nvm/nvm.sh && nvm install --lts",
    terminal
  };
}

export function publicNodeUpgradePlan(plan: NodeUpgradePlan): Omit<NodeUpgradePlan, "run"> & { oneClick: boolean } {
  const { run, ...rest } = plan;
  return { ...rest, oneClick: Boolean(run) };
}

export function runNodeUpgrade(
  plan: NodeUpgradePlan,
  onLine: (line: string) => void,
  timeoutMs = 20 * 60_000
): Promise<void> {
  const run = plan.run;
  if (!run) return Promise.reject(new Error("node_upgrade_manual"));
  return new Promise((resolve, reject) => {
    const child = spawn(run.command, run.args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    const forward = (chunk: string) => {
      for (const line of chunk.split(/\r?\n|\r/)) {
        const text = line.trim();
        if (text && /[\p{L}\p{N}]/u.test(text)) onLine(text);
      }
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", forward);
    child.stderr.on("data", forward);
    child.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(error.code === "ENOENT" ? new Error(`未找到 ${plan.label} 命令，请复制命令到${plan.terminal}执行。`) : error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0 || (plan.manager === "winget" && code !== null && WINGET_ALREADY_LATEST.has(code))) resolve();
      else reject(new Error(`${plan.label} 升级失败（退出码 ${code}）。可复制命令到${plan.terminal}手动执行。`));
    });
  });
}
