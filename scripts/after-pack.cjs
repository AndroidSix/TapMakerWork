const { execFileSync, spawnSync } = require("node:child_process");
const path = require("node:path");

/**
 * electron-builder 在 CSC_IDENTITY_AUTO_DISCOVERY=false 下会完全跳过签名，
 * 产出的 .app 只剩 Electron 二进制自带的链接器签名（Identifier=Electron），
 * 没有 _CodeSignature/CodeResources，codesign --verify 直接失败。
 *
 * macOS 的 TCC 靠代码签名把录屏授权绑定到 app 身份上：签名无效时系统无法复用
 * 已记录的授权，表现就是「已经在系统设置里允许了，每次抓屏还是弹授权框」。
 *
 * 这里在打包后补签，让签名合法、bundle id 正确：
 * - 有 TAPMAKERWORK_CODESIGN_IDENTITY 时用它（真实证书，跨版本授权不失效）
 * - 否则用 ad-hoc（每次发版会重新询问一次授权）
 * 已有合法签名的包不会被覆盖。
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  if (signatureValid(appPath)) {
    console.log(`[after-pack] 已有合法签名，跳过：${appPath}`);
    return;
  }

  const identity = process.env.TAPMAKERWORK_CODESIGN_IDENTITY?.trim() || "-";
  console.log(`[after-pack] 补签名（${identity === "-" ? "ad-hoc" : identity}）：${appPath}`);
  execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", identity, appPath], { stdio: "inherit" });

  if (!signatureValid(appPath)) {
    throw new Error("签名校验失败，安装后录屏授权会反复失效。请检查 build/entitlements.mac.plist 与证书。");
  }
};

function signatureValid(appPath) {
  const result = spawnSync("/usr/bin/codesign", ["--verify", "--strict", appPath], { encoding: "utf8", windowsHide: true });
  return result.status === 0;
}
