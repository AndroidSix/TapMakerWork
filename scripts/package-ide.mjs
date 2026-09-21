#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
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
    const child = spawn(command, args, {
      cwd: sourceRoot,
      env: {
        ...process.env,
        CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY || "false"
      },
      stdio: "inherit",
      windowsHide: true,
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

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const builder = path.join(sourceRoot, "node_modules", ".bin", process.platform === "win32" ? "electron-builder.cmd" : "electron-builder");
  if (!fs.existsSync(builder)) {
    throw new Error("尚未安装项目依赖，请先运行 npm install");
  }

  const targetLabel = requestedTarget === "all" ? "macOS + Windows" : requestedTarget === "mac" ? "macOS" : "Windows";
  console.log(`[TapMakerWork] 一键打包 IDE：${targetLabel}`);
  console.log(`[TapMakerWork] 源码：${sourceRoot}`);
  console.log("[1/3] 编译 IDE 与内置 Bridge…");
  await run(npm, ["run", "build:release"]);

  const builderArgs = requestedTarget === "all"
    ? ["--mac", "--win"]
    : requestedTarget === "mac"
      ? ["--mac"]
      : ["--win"];
  console.log(`[2/3] 生成 ${targetLabel} 安装包…`);
  await run(builder, builderArgs);

  const artifacts = recentArtifacts(startedAt);
  console.log("[3/3] 打包完成");
  if (artifacts.length) {
    console.log("本次产物：");
    for (const artifact of artifacts) console.log(`  ${artifact}`);
  } else {
    console.log(`产物目录：${outputDirectory}`);
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
