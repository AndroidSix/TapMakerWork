#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(sourceRoot, "outputs", "installers");
const productName = "TapMakerWork";
const bundleId = "com.androidsup.tapmakerwork";

const apps = [
  {
    arch: "arm64",
    appleArch: "arm64",
    app: path.join(outputDirectory, "mac-arm64", `${productName}.app`)
  },
  {
    arch: "x64",
    appleArch: "x86_64",
    app: path.join(outputDirectory, "mac", `${productName}.app`)
  }
];

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", ...options });
}

function bundleVersion(appPath) {
  return execFileSync("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleShortVersionString",
    path.join(appPath, "Contents", "Info.plist")
  ], { encoding: "utf8" }).trim();
}

function buildPackage(item) {
  const version = bundleVersion(item.app);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `tapmakerwork-pkg-${item.arch}-`));
  const root = path.join(work, "root");
  const requirements = path.join(work, "requirements.plist");
  const distribution = path.join(work, "distribution.xml");
  const componentPlist = path.join(work, "component.plist");
  const componentPackage = path.join(work, `${bundleId}.pkg`);
  const artifact = path.join(outputDirectory, `${productName}-${version}-mac-${item.arch}.pkg`);

  fs.mkdirSync(root);
  run("/bin/cp", ["-cR", item.app, path.join(root, `${productName}.app`)]);

  fs.writeFileSync(requirements, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>arch</key><array><string>${item.appleArch}</string></array></dict></plist>
`);

  run("productbuild", ["--synthesize", "--product", requirements, "--component", path.join(root, `${productName}.app`), distribution]);
  const mustClose = `    <pkg-ref id="${bundleId}">\n        <must-close>\n            <app id="${bundleId}"/>\n        </must-close>\n    </pkg-ref>\n`;
  const domains = `    <domains enable_anywhere="false" enable_currentUserHome="false" enable_localSystem="true"/>\n`;
  const distributionXml = fs.readFileSync(distribution, "utf8")
    .replace(
      `<choice id="${bundleId}" title="${productName}" visible="false">`,
      `<choice id="${bundleId}" title="${productName}" visible="false" customLocation="/Applications">`
    )
    .replace("</installer-gui-script>", `${mustClose}${domains}</installer-gui-script>`);
  fs.writeFileSync(distribution, distributionXml);

  run("pkgbuild", ["--analyze", "--root", root, componentPlist]);
  run("/usr/libexec/PlistBuddy", ["-c", "Set :0:BundleIsRelocatable false", componentPlist]);
  run("/usr/libexec/PlistBuddy", ["-c", "Delete :0:ChildBundles", componentPlist]);
  run("pkgbuild", [
    "--root", root,
    "--identifier", bundleId,
    "--component-plist", componentPlist,
    "--install-location", "/Applications",
    "--version", version,
    componentPackage
  ]);
  run("productbuild", ["--distribution", distribution, "--package-path", work, artifact], { cwd: work });

  fs.rmSync(work, { recursive: true, force: true });
  console.log(`[TapMakerWork] ${artifact}`);
}

const present = apps.filter((item) => fs.existsSync(item.app));
if (!present.length) {
  console.error("[TapMakerWork] 未找到 macOS App，请先运行 electron-builder --mac");
  process.exit(1);
}

for (const item of present) {
  console.log(`[TapMakerWork] 生成 ${item.arch} 安装包…`);
  buildPackage(item);
}
