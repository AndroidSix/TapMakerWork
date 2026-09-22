# Desktop release and first-run permissions

创建于 2026-09-22（本文随发布流程持续更新）

## 给分发者：安装包能不能直接给普通用户？

**先看结论：**

| 包类型 | 能不能对外给普通用户 | 说明 |
|--------|----------------------|------|
| **已正式签名**（Mac：Developer ID + 公证；Win：Authenticode） | 可以 | 安装体验接近正常软件 |
| **本机一键打包、未配置证书** | **不要对外发** | 仅限自己 / 团队内部 QA |
| 开发态 `electron .` / `npm run dev` | 不要当安装包发 | 权限与更新行为都不等于正式版 |

自有代码 + 正规依赖打出来的安装包**不涉及侵权**。「没签名」只表示系统还不信任发布者身份，**不是违法、也不是盗用证书**。对外分发时请只用你们自己申请/购买的证书签名，不要使用他人证书或伪造签名。

### 未签名包时，普通用户会遇到什么

- **macOS（`.dmg` / `.zip`）**
  - 常见提示：「无法验证开发者」「已损坏，无法打开」。
  - 需要用户右键 → 打开，或手动清除隔离属性后才能装；很多用户会直接放弃。
  - 屏幕录制 / 辅助功能授权不稳定（身份是 adhoc，不是正式 Developer ID），换机器或升级后可能要重新授权。
  - 自动更新不可靠。
- **Windows（`.exe` NSIS）**
  - SmartScreen：「Windows 已保护你的电脑」，需「更多信息 → 仍要运行」。
  - 部分杀软可能对未签名安装包误报。

因此：`outputs/installers/` 里刚打出来的包，**默认按未签名 QA 包对待**，除非你已确认本机构建注入了证书、或产物来自配置了 Secrets 的 `desktop-release` CI。

### 正式对外发布前请确认

1. 已配置签名环境变量（见下文「Signing credentials」），或 CI Secrets 齐全。
2. **Mac**：`codesign -dv --verbose=4 TapMakerWork.app` 可见正式 `Developer ID Application` 与 `TeamIdentifier`；`spctl -a -vv` 可通过；公证完成（`scripts/notarize.cjs` 在提供 Apple 账号变量时执行）。
3. **Windows**：安装包带 Authenticode（证书表非空）；可用系统属性「数字签名」或签名工具验证。
4. 上传到 Release 时带齐安装包 + `latest-mac.yml` / `latest.yml` + blockmap（见「Gitee release updates」）。

给下载页 / 群公告写一句即可，例如：

> 请下载带版本号的正式 Release 安装包。若系统提示无法验证开发者或 SmartScreen 拦截，说明当前文件不是已签名正式版，请改从官方 Release 重新下载，不要用同事私自打包的 QA 文件。

---

## Why a packaged, signed app matters

macOS records Screen Recording and Accessibility consent against the application's stable identity. TapMakerWork uses the fixed bundle ID `com.androidsup.tapmakerwork`; production releases should also be signed with the same Developer ID certificate and notarized. An unpackaged `electron .` process is useful for development, but macOS may show it as Electron and its consent does not reliably carry over to a release build.

TapMakerWork never grants these permissions itself:

- **Screen Recording** lets the desktop host capture the real Maker Runtime window. macOS requires the user to enable it in System Settings.
- **Accessibility** lets a click on the Runtime mirror be forwarded to the real game window. The app can request the system prompt, but the user remains in control.
- Windows does not require the equivalent TCC grants for the current capture and interaction path.

The first-run guide is skippable, remains available under Settings → System authorization, rechecks current OS state, and offers a restart after both grants are ready.

## Build commands

```bash
npm ci
npm run dist:mac   # DMG + ZIP, arm64 and x64
npm run dist:win   # NSIS installer, x64
npm run dist:all   # both targets from one command when cross-build prerequisites exist
```

## One-key IDE packaging

After changing the IDE, use the canonical wrapper instead of calling electron-builder directly:

```bash
npm run package:ide       # macOS + Windows (run on macOS)
npm run package:ide:mac   # macOS only
npm run package:ide:win   # Windows only
```

The desktop IDE exposes the same task from the title bar, **构建 → 一键打包 IDE**, and `Cmd/Ctrl+Shift+B`. Build output is streamed to the IDE's **构建** terminal, with cancel and open-output actions in Settings. When running an installed copy, use **设置 → IDE 一键打包 → 选择源码** once; the selected repository is remembered. The macOS launcher `outputs/launchers/Package-TapMakerWork-All.command` and Windows launcher `outputs/launchers/Package-TapMakerWork-All.cmd` call the same wrapper.

Apple's packaging tools only run on macOS. A Mac can generate both targets in one pass; a Windows workstation builds the Windows target locally and should use the `desktop-release` workflow when both platform artifacts are required.

For a reliable two-platform release, push a `v*` tag or manually run `.github/workflows/desktop-release.yml`. It executes the same build on native macOS and Windows runners and uploads both artifact groups.

### Signing credentials

The scripts disable certificate auto-discovery (`CSC_IDENTITY_AUTO_DISCOVERY=false`) so duplicate local certificates cannot make a build nondeterministic. Supply explicit release credentials through the standard electron-builder variables:

- **macOS**: `CSC_LINK`, `CSC_KEY_PASSWORD`, plus notarization `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`.
- **Windows**: a compatible Authenticode certificate via `CSC_LINK` and `CSC_KEY_PASSWORD`, or the organization's signing service in CI.

CI mapping in `.github/workflows/desktop-release.yml`:

- macOS runner → `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` + Apple notarization secrets
- Windows runner → `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`

**Unsigned artifacts are for local QA only.** Do not publish them as the download that end users should install. A signed (and on macOS, notarized) build is required for a normal install experience, durable Screen Recording / Accessibility consent, and reliable automatic updates.

## 应用内更新（version.json）

仓库根目录 [`version.json`](../version.json) 控制 IDE 版本比对与更新说明（与 `community.json` 同款远程拉取：Gitee raw → GitHub raw → 内置兜底）。

发版时同步修改该文件：

- `latest`：最新版本号（可写 `0.1.1` 或 `v0.1.1`）
- `title` / `notes`：更新弹窗标题与条目
- `downloads.macArm64` / `macX64` / `windowsX64`：对应平台安装包直链
- `downloads.page` / `site`：发行页与官网
- `force: true`：强制提醒（忽略「暂不更新 / 不再提醒」）

IDE 行为：

- 启动后静默检查；菜单 **帮助 → 检查更新**（`Cmd/Ctrl+Shift+U`）与设置页均可手动检查
- 有新版本时弹窗：**立即更新**（打开本机平台下载链接）、**暂不更新**（24 小时内不弹）、**不再提醒**（跳过该版本，直到出现更高版本）
- 「立即更新」优先打开 `version.json` 中的平台直链；若发行版具备 electron-updater 元数据，正式包仍可尝试应用内下载

---

## Gitee release updates

The desktop app checks the fixed Gitee main repository through `GET /api/v5/repos/AndroidSUP/tap-maker-work/releases/latest`. There is no user-editable update source. A repository with no Release is treated as having no available update.

When a newer tag is found, the packaged app configures electron-updater against that Release's download directory. The Release must therefore contain the installers plus the generated `latest-mac.yml` / `latest.yml` and block maps. Use a `v<package.json version>` tag unless you intentionally adopt another consistent tag scheme. If the metadata is missing, Settings keeps the new-version result visible and opens the Gitee Release page as a manual-download fallback.

Upload the complete electron-builder output for each release, not only the installer:

- macOS ZIP/DMG plus `latest-mac.yml` and block maps;
- Windows NSIS executable plus `latest.yml` and block maps.

Increase the root `package.json` version before building. Installed clients check Gitee shortly after startup and every 30 minutes. The Settings panel also supports a manual check, explicit download with progress, repository shortcuts, and restart-to-install.

## Node.js behavior

Maker subprocesses now use the actual system Node.js discovered from PATH, the login shell, Homebrew, Volta, or the standard Windows install locations. TapMakerWork no longer silently prefers an older managed copy. If no system Node.js exists, the Electron-embedded Node.js is reported as a fallback; install Node.js through the operating system/package manager and click **Resync system version** afterward.
