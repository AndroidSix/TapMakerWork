# Desktop release and first-run permissions

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

The scripts disable certificate auto-discovery so duplicate local certificates cannot make a build nondeterministic. Supply explicit release credentials through the standard electron-builder variables:

- macOS: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`.
- Windows: a compatible code-signing certificate via `CSC_LINK` and `CSC_KEY_PASSWORD`, or configure the organization's signing service in CI.

Unsigned artifacts are useful for local QA only. A signed macOS build is mandatory for automatic updates and provides the stable identity needed for durable permissions.

## Gitee release updates

The desktop app checks the fixed Gitee main repository through `GET /api/v5/repos/AndroidSUP/tap-maker-work/releases/latest`. There is no user-editable update source. A repository with no Release is treated as having no available update.

When a newer tag is found, the packaged app configures electron-updater against that Release's download directory. The Release must therefore contain the installers plus the generated `latest-mac.yml` / `latest.yml` and block maps. Use a `v<package.json version>` tag unless you intentionally adopt another consistent tag scheme. If the metadata is missing, Settings keeps the new-version result visible and opens the Gitee Release page as a manual-download fallback.

Upload the complete electron-builder output for each release, not only the installer:

- macOS ZIP/DMG plus `latest-mac.yml` and block maps;
- Windows NSIS executable plus `latest.yml` and block maps.

Increase the root `package.json` version before building. Installed clients check Gitee shortly after startup and every 30 minutes. The Settings panel also supports a manual check, explicit download with progress, repository shortcuts, and restart-to-install.

## Node.js behavior

Maker subprocesses now use the actual system Node.js discovered from PATH, the login shell, Homebrew, Volta, or the standard Windows install locations. TapMakerWork no longer silently prefers an older managed copy. If no system Node.js exists, the Electron-embedded Node.js is reported as a fallback; install Node.js through the operating system/package manager and click **Resync system version** afterward.
