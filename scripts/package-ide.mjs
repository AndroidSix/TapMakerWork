#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(sourceRoot, "outputs", "installers");
const requestedTarget = process.argv.includes("--mac")
  ? "mac"
  : process.argv.includes("--win")
    ? "win"
    : "all";

function fail(message) {
  console.error(`\n[TapMakerWork] ${message}`);
  process.exitCode = 1;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    // Node.js 20+ 在 Windows 上禁止直接 spawn .bat/.cmd 文件，会抛 EINVAL。
    // 需要通过 cmd.exe 间接启动（与 npm/pnpm 等工具链一致）。
    const useShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
    const child = spawn(command, args, {
      cwd: sourceRoot,
      env: {
        ...process.env,
        CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY || "false"
      },
      stdio: "inherit",
      windowsHide: true,
      shell: useShell,
      ...options
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} 被信号 ${signal} 终止`));
      else if (code === 0) resolve();
      else reject(new Error(`${command} 退出，错误码 ${code ?? "unknown"}`));
    });
  });
}

function recentArtifacts(startedAt) {
  if (!fs.existsSync(outputDirectory)) return [];
  return fs.readdirSync(outputDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const file = path.join(outputDirectory, entry.name);
      return { file, modified: fs.statSync(file).mtimeMs };
    })
    .filter((entry) => entry.modified >= startedAt - 2_000)
    .sort((left, right) => left.file.localeCompare(right.file))
    .map((entry) => entry.file);
}

/** electron-builder 自带的 makensis 是 x86_64；Apple Silicon 没有 Rosetta 会报 spawn -86。 */
function hasRosettaTranslation() {
  if (process.platform !== "darwin" || os.arch() !== "arm64") return true;
  try {
    const translated = spawnSync("arch", ["-x86_64", "/usr/bin/true"], { encoding: "utf8" });
    return translated.status === 0;
  } catch {
    return false;
  }
}

function needsRosettaForWin() {
  return process.platform === "darwin" && os.arch() === "arm64";
}

function rosettaHint() {
  return [
    "在 Apple Silicon 上打 Windows NSIS 包需要 Rosetta 2（electron-builder 的 makensis 是 x86_64）。",
    "自动安装未成功时，请在本机终端手动执行：",
    "  softwareupdate --install-rosetta --agree-to-license",
    "或只打 macOS：npm run package:ide:mac",
    "Windows 安装包也可在 GitHub Actions desktop-release / 一台 Windows 机上生成。"
  ].join("\n");
}

/** 缺 Rosetta 时尝试自动安装；成功返回 true。 */
async function ensureRosettaForWin() {
  if (!needsRosettaForWin() || hasRosettaTranslation()) return true;
  console.log("[TapMakerWork] 未检测到 Rosetta 2，正在自动安装（打 Windows NSIS 需要）…");
  try {
    await run("softwareupdate", ["--install-rosetta", "--agree-to-license"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[TapMakerWork] Rosetta 自动安装失败：${message}`);
    return false;
  }
  if (hasRosettaTranslation()) {
    console.log("[TapMakerWork] Rosetta 2 已就绪。");
    return true;
  }
  console.warn("[TapMakerWork] Rosetta 安装命令已结束，但仍无法运行 x86_64 二进制。");
  return false;
}

async function main() {
  const startedAt = Date.now();
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(nodeMajor) || nodeMajor < 22) {
    throw new Error(`需要 Node.js 22 或更高版本，当前为 ${process.version}`);
  }
  if (!fs.existsSync(path.join(sourceRoot, "electron-builder.yml"))) {
    throw new Error(`未找到 IDE 源码仓库：${sourceRoot}`);
  }
  if ((requestedTarget === "all" || requestedTarget === "mac") && process.platform !== "darwin") {
    throw new Error("macOS 安装包必须在 macOS 主机或发布流水线中生成。Windows 上请运行 npm run package:ide:win；双端请触发 desktop-release 工作流。");
  }

  const wantsWin = requestedTarget === "all" || requestedTarget === "win";
  const wantsMac = requestedTarget === "all" || requestedTarget === "mac";
  let skipWinForRosetta = false;
  if (wantsWin && needsRosettaForWin()) {
    const ready = await ensureRosettaForWin();
    if (!ready) {
      if (requestedTarget === "win") {
        throw new Error(rosettaHint());
      }
      skipWinForRosetta = true;
      console.warn(`[TapMakerWork] 警告：Rosetta 不可用，本次跳过 Windows NSIS。\n${rosettaHint()}\n`);
    }
  }

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const builder = path.join(sourceRoot, "node_modules", ".bin", process.platform === "win32" ? "electron-builder.cmd" : "electron-builder");
  if (!fs.existsSync(builder)) {
    throw new Error("尚未安装项目依赖，请先运行 npm install");
  }

  const buildWin = wantsWin && !skipWinForRosetta;
  const targetLabel = wantsMac && buildWin
    ? "macOS + Windows"
    : wantsMac
      ? "macOS"
      : "Windows";
  console.log(`[TapMakerWork] 一键打包 IDE：${targetLabel}`);
  console.log(`[TapMakerWork] 源码：${sourceRoot}`);
  console.log("[1/3] 编译 IDE 与内置 Bridge…");
  await run(npm, ["run", "build:release"]);

  const builderArgs = [];
  if (wantsMac) builderArgs.push("--mac");
  if (buildWin) builderArgs.push("--win");
  console.log(`[2/3] 生成 ${targetLabel} 安装包…`);
  try {
    await run(builder, builderArgs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (buildWin && /makensis|Unknown system error -86|EBADARCH/i.test(message)) {
      throw new Error(`${message}\n\n${rosettaHint()}`);
    }
    throw error;
  }
  if (wantsMac) {
    console.log("[2/3] 生成 macOS .pkg…");
    await run(process.execPath, [path.join(sourceRoot, "scripts", "build-mac-pkg.mjs")]);
  }

  const artifacts = recentArtifacts(startedAt);
  const packageJson = JSON.parse(fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8"));
  const version = typeof packageJson.version === "string" ? packageJson.version : "unknown";
  console.log("[3/3] 打包完成");
  console.log(`包内版本：${version}（来自仓库根 package.json）`);
  if (artifacts.length) {
    console.log("本次产物：");
    for (const artifact of artifacts) console.log(`  ${artifact}`);
  } else {
    console.log(`产物目录：${outputDirectory}`);
  }
  if (skipWinForRosetta) {
    console.log("注意：因缺少 Rosetta，Windows .exe 未生成。装好 Rosetta 后可再跑 npm run package:ide:win。");
  }
  console.log("注意：一键打包只生成安装包，不会自动覆盖本机已安装的 App。");
  console.log("macOS 请双击新的 .pkg。若提示无法验证开发者，到「系统设置 → 隐私与安全性」点「仍要打开」，安装器会写入 /Applications。Windows 请重新运行新的 NSIS 安装程序。");
  console.log(`目录里若仍有旧版文件（如 *-0.1.0-*），请勿误开；请选 *-${version}-* 文件。`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
