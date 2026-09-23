# Change log

## 2026-09-23 — Yoga 工厂 UI 回写防串写（发布加固）

- **不再**把实例颜色/字段插进邻近无关 Panel（曾误改 `staminaRow`）。
- nearby 匹配窗口收紧到 ±6；禁止 nearby 插入；表达式优先走 `opts_passthrough`。
- `PrimaryButton` / `SecondaryButton` / `CaptionBar` / `Chip` / `UpgradeCard`：工厂内 `rim`/`core`/`bg`/`opts.*` 改动路由到**调用处**（`bg`/`rim`/`fontSize`/`title`/`text`…）。
- 共享文案：优先把 `text = Assets.Subtitle` **冻成该按钮字面量**，避免改到广告按钮或改坏标题用的 Assets。
- **禁止**控件编辑回写 `Assets.X = "…"`（标题用 `Title .. Subtitle` 拼接时，改按钮会误改整条标题）。
- `UpgradeCard` 颜色写入 `bg`（不再插入无效的 `backgroundColor`）。
- 同尺寸兄弟 `PrimaryButton` 的 `fontColor`/`bg` 按文案锚点写，不串到相邻按钮。
- 游戏工程内容不代改；用新 IDE 在 Studio 里再编辑一次即可正确落到 Lua。

## 2026-09-23 — 为什么改动只在 .ui.json / 重启丢失

- 游戏 Runtime **从不读取** `.ui.json`；旁路只给 IDE 用。重启后只能靠 Lua 源码。
- 你改的按钮文字落在 `UiStyle.PrimaryButton` 工厂里的 `opts.text or ""`：不能冻进工厂，以前回写失败 → 只剩 `.ui.json`，且 `123123` 还被当成数字。
- 现已：嵌套行号定位、`text` 保持字符串、跳过 `opts.*` 工厂透传，并在全项目唯一调用处改 `text = "..."` 字面量。

## 2026-09-23 — 文字回写不到代码的根因修复

- 真机快照上的布局数值曾被误写进 Lua（`MainHUD.lua` 被改坏，已建议从 git 恢复）。
- 列表模板逻辑会丢掉 `text`，导致改字只生效在内存、不进源码。
- 现改为：专用 `pendingLuaWritebacks` 保留文字；runtime 不再对整树做布局差分回写；无 source 时用当前打开文件的转换树按文案对齐行号。

## 2026-09-23 — 修复结构草图 / 运行时 Lua 回写失效

- 根因：Yoga 仅在 `UI_INSPECTOR_ENABLED` 时记录 `_sourceFile/_sourceLine`；未开启时节点变成 `runtime:0`，回写队列为空。且 `snapshotSource=runtime` 时跳过了树回写。
- 修复：启动时强制 `UI_INSPECTOR_ENABLED`；从节点 id（`file:line:type`）恢复定位；保存时用「编辑树 vs Lua 转换」差分收集脏属性；始终对提交快照做字面量回写。
- 乱世夺城已更新 `TapMakerWorkBridge.lua` 与 `client_main.lua` 引导段；需 **Maker preview refresh / 重进界面** 后新建的 UI 才带源码行号。

## 2026-09-23 — live-edit 卡顿 / 属性框 / Lua 回写修复

- Runtime 已连接时，autosave 不再同步阻塞 `maker preview refresh`（画面已由 SetStyle 生效），消除编辑卡顿主因。
- 属性输入框随选中节点重置；失焦即提交，文字支持防抖 live 提交，不必再按回车。
- Lua 回写：解析真实项目相对路径、容忍 Runtime 行号漂移（±6），非 runtime 编辑也会进入回写队列。

## 2026-09-23 — Yoga live-edit 回写 Lua 字面量

- 保存视觉旁路时，Yoga 上用户改过的视觉属性会固化进项目 Lua（按 `source.file + line + type`）。
- 原为 `style.*` / `options.theme.*` 等表达式的字段，若用户给出了具体值，会替换为字面量以真正生效到项目；`onClick` 等行为回调不改。
- 缺少的视觉字段可插入；无法序列化的残留仍留在 `.ui.json`。
- Studio 保存提示与 agent 日志会显示回写条数与文件。

## 2026-09-23 — 工具集：新游雷达

- Studio「工具」新增 **新游雷达**：拉取 TapTap 制造 `maker/v1/app-list` 榜单，本地计算赛道机会指数 / 象限，并支持离线快照。
- 工具入口提供一次性红点（首次打开新游雷达后消失）。

## 2026-09-23 — NanoVG live-edit sync + terminal tools (0.1.2)

> **macOS 安装提示：** 未签名包会被 Gatekeeper 拦截；系统设置若无「仍要打开」，请自行拉取源码打包。  
> 一键查看：
> [macOS 安装说明](../README.md#macos-install) ·
> [源码打包详细步骤](./DESKTOP_RELEASE.md#macos-build-from-source)

- NanoVG bridge no longer POSTs a runtime snapshot on every `nvgEndFrame`; Update polls `/api/runtime/commands` first so patches are not starved (fixes 台球大师-style games where the IDE tree moved but the preview did not).
- HTTP client uses a short cooldown instead of permanently disabling after the first failure.
- Adapter bootstrap embeds `project.json` / folder title as `projectName` when `Config.lua` is missing; file-channel matching also uses Maker `preview/*/session.json` `project_realpath`.
- Studio terminal panel adds **复制** and **清空** for the active log channel.
- Version bumped to **0.1.2**.
- `version.json` release notes now lead with the macOS Gatekeeper tip and expose one-click `links` into the README / DESKTOP_RELEASE anchors above.

## 2026-09-23 — Windows Maker preview supervisor recovery (harder)

- When Maker reports supervisor unreachable / ownership unverified, preview start now: `stop` → retry → **safely retire dead `~/.taptap-maker/preview/<hash>/session.json`** (and stale `operation.lock`) → start again.
- Session retirement only runs when recorded supervisor/runtime PIDs are confirmed missing (or Windows PID reuse by a non-Maker process). Processes are never killed.
- Failure copy now points at deleting/renaming `session.json` and reboot as last resorts when auto-recovery cannot clear a live or unknown PID.

## 2026-09-23 — Windows Maker preview supervisor recovery

- Preview `start` now detects Maker’s “Preview supervisor is unreachable / Process ownership is unverified” failure, runs one `stop` then retries `start` automatically.
- Studio and Runtime logs show Chinese remediation steps for leftover Windows sessions, antivirus/WMI blocks, and Task Manager cleanup instead of raw Maker JSON only.

## 2026-09-23 — live-edit window pick for bare Maker titles

- macOS Runtime capture now prefers the exact project-titled Maker preview window (e.g. `台球大师`) and demotes editor titles that only contain the project name (`App.tsx — 台球大师`).
- Window ranking also uses portrait/landscape aspect against the game viewport so a wide IDE is not mistaken for the Runtime frame.
- Runtime snapshot refresh drops stale `selectedId` values that no longer exist in the live tree (fixes empty inspector after opening `main`).

## 2026-09-22 — NanoVG source path open fix

- Runtime NanoVG call-site paths now normalize Maker `require` chunk names (`pool/ui/DrawUtil`) to project files (`scripts/pool/ui/DrawUtil.lua`).
- Bridge file open resolves the same module / absolute / missing-`.lua` variants, so clicking Runtime nodes opens the real UI source without ENOENT.
- Yoga snapshot source paths are likewise rewritten to project-relative `scripts/…` paths.

## 2026-09-22 — app update manifest

- Added root `version.json` for IDE version comparison, release notes and per-platform download URLs (Gitee/GitHub raw, same pattern as `community.json`).
- Desktop update flow now prompts with **立即更新 / 暂不更新 / 不再提醒**, plus menu **帮助 → 检查更新**.

## 2026-09-23 — GameAlgo Report Pack

- Published the TapMakerWork IDE Report Pack (`gamealgo-report-pack.json`) with overview, retention, version coverage, milestone funnels and IDE usage charts.
- Desktop telemetry now defaults to non-debug GameAlgo events so formal dashboards can receive traffic from local development builds.

## 2026-09-22 — GameAlgo IDE telemetry

- Switched anonymous usage analytics to the domestic GameAlgo Web SDK (`@gamealgo/web`); product events and milestones report with `platform=web`.
- Removed the local Node telemetry receiver, custom HTTP endpoint, and leftover main-process flush stubs; Settings keep an opt-out switch and local session/active duration.
- Registered IDE custom events in the GameAlgo catalog and linked the admin dashboard from Settings.

## 2026-09-22 — NanoVG Runtime adapter

- Added `TapMakerWorkNanoVGBridge.lua`: proxies global `nvg*` draw calls into a virtual node tree with stable call-site IDs, real AABB hit boxes, live parameter overrides and `.ui.json` persistence — without rewriting game Lua.
- 「接入当前项目」now auto-detects Yoga (`urhox-libs/UI`) vs NanoVG and installs the matching bridge; wrong-backend managed hooks are rewired on reinstall.
- Studio health exposes `uiBackend`; screen scan keeps NanoVG surfaces as runtime stubs when static Lua conversion cannot build a widget tree.

## 2026-09-21 — Gitee updates and source-control workspace

- Replaced the editable application-update source with a fixed check against the `AndroidSUP/tap-maker-work` Gitee release API, with manual release-page fallback when updater metadata is unavailable.
- Added direct Gitee and GitHub repository shortcuts to Settings.
- Removed preview screenshot capture and screenshot evidence from the workbench, preview dock, protocol and Bridge API; delivery now focuses on executable validation signals.
- Rebuilt the Git workspace around staged and unstaged groups, per-file and bulk actions, keyboard commit, pull/push controls, a compact commit graph and VS Code-style right-click menus.
- Documented the workbench as an original TapMakerWork composition built from project-specific delivery stages; external projects inform integration patterns rather than supplying its dashboard layout.

## 2026-09-21 — live editor viewport and hierarchy navigation

- Live-edit and actual Runtime panes now fit the complete game viewport by both available width and height, preserving the engine-reported aspect ratio during panel and terminal resizing.
- Selecting a visual node now opens its source UI file without leaving Runtime editing, switches to the hierarchy panel, expands its ancestor chain and reveals the matching tree row immediately.
- The hierarchy action bar now remains fixed while the node tree scrolls independently beneath it.

## 2026-09-21 — anonymous usage telemetry

- Added opt-out anonymous usage telemetry focused on session duration and active time, with local lifetime totals shown in Settings.
- Tracks bounded product events without project paths, source or Maker credentials.
- Superseded by the 2026-09-22 GameAlgo Web SDK integration (local HTTP receiver removed).

## 2026-09-21 — desktop delivery, permissions and updates

- Changed Maker subprocesses to follow the system Node.js discovered from PATH, login shells, Homebrew, Volta and standard Windows locations; legacy managed runtimes no longer override it.
- Added a skippable first-run macOS permission guide for Screen Recording and Accessibility, with live status, direct System Settings links, recheck and restart actions.
- Added a stable `com.androidsup.tapmakerwork` application identity, hardened-runtime entitlements and explicit signing guidance so new-machine permissions persist across signed releases.
- Added production loading for the bundled Studio and a packaged Bridge child process, removing the development-server dependency from installed builds.
- Added one-command macOS/Windows packaging, native two-platform CI artifacts, DMG/ZIP and NSIS targets, and deterministic explicit-signing behavior.
- Added configurable update feeds, automatic periodic checks, manual checks, download progress, failure states and restart-to-install through electron-updater.
- Added a default-off hardware-acceleration setting with an explicit restart state, so GPU rendering can be enabled only on compatible machines.
- Added strict TapTap Maker project recognition through `.project/project.json`; ordinary folders are rejected without replacing the active project.
- Added a first-install EULA and privacy-policy gate that documents local data use, Screen Recording, Accessibility, research intent and the decline-to-exit behavior.
- Added automatic live Runtime error detection with a focused recovery dialog, complete logs and a copy-ready AI repair prompt.
- Added a dedicated Maker backend shortcut beside the TapTap developer-console shortcut.
- Added project closing from both the native File menu and the title-bar project tab, including unsaved-code confirmation and a clean return to the welcome screen.
- Added author-game and voluntary-sponsorship shortcuts, with an accessible in-app viewer for the repository's WeChat and Alipay support codes.
- Added an explicit “I have authorized” permission confirmation so macOS users can enable restart even when System Settings does not refresh the permission status in-process.

## 2026-09-20 — true Runtime view and explicit source navigation

- Maker MCP now defaults to the newest version already installed on the device, with correct prerelease ordering.
- Studio settings can check the official stable and Beta channels, install updates, switch channels, or pin an installed version.
- Canvas clicks now select controls without automatically switching to code; source navigation is an explicit inspector action.
- Play mode now opens a dedicated true Runtime view instead of presenting the DOM control-tree renderer as final game output.
- The desktop host samples the actual Maker / UrhoX window, with automatic matching, manual window selection and a macOS screen-recording permission state.
- Final Runtime frames now share one surface with engine-reported hit-test rectangles, selection labels, drag movement, eight-direction resizing and keyboard nudging.
- The Runtime inspector remains visible beside the final frame and edits position, size and appearance without switching to code.
- Live-edit mode keeps the captured frame synchronized with Runtime while preserving editor-owned selection and draft overlays during interaction.
- Added an opt-in adapter installer, automatic entry backup and a savedata file transport for Maker environments that block localhost HTTP.
- Fixed the sandboxed Electron preload entry to compile as CommonJS, restoring reliable desktop IPC injection for project picking, embedded preview and Runtime capture.
- Design canvas, Web preview and true Runtime are separately named and described so each rendering path has a clear role.
- Runtime status now recognizes both the official Maker preview process and the optional UI Bridge connection.
- UI discovery now scans the complete `scripts` tree instead of assuming every screen lives under `scripts/ui`, and the refresh action performs a real rescan.
- The file browser now opens project files in a locally bundled Monaco editor, avoiding the blank loading state caused by blocked CDN initialization.
- Runtime auto-selection now rejects a bare project-name editor window and prefers the titled Maker / UrhoX game window, preventing Cursor from being shown as the final frame.
- The Events and Animation inspector tabs now expose their own populated or empty states and retain explicit source-navigation actions.
- Runtime edit mode now keeps the edit frame synchronized with the latest engine frame instead of leaving the left pane visually stale after a property change.
- Added shared Shift multi-selection across the Runtime canvas, structure canvas and hierarchy tree; group move, rotate, scale and keyboard nudging apply to every selected node.
- Added a Cocos-style transform toolbar: `Q` select, `W` move, `E` rotate, `R` scale and `T` rect, with visible gizmos, matching inspector fields, an incremental-snap toggle and Ctrl/Cmd temporary snapping.
- Added official Node.js LTS update checks beside Maker MCP versions; optional updates install into an isolated TapMakerWork runtime without overwriting the system Node.js.
- Routed desktop `Command/Ctrl+Z` and redo through the visual editor history instead of Electron's native text history, while preserving native undo inside form fields and Monaco.
- Runtime transforms now stream throttled patches while dragging and coalesce the entire gesture into one undo step.
- Added accessible Unity-style RGBA editors for image tint, text color and background color, including native color selection, per-channel sliders/numbers, alpha and hexadecimal input.
- Added native Runtime input forwarding on macOS: the captured game surface now has a Play mode and the live result pane accepts clicks that are mapped back to the real Runtime window.
- Reworked the structure canvas around its real logical viewport size, with scrollable overflow, 10–400% zoom, step controls and one-click best fit.
- Added persistent document-tab ordering plus detachable, movable and resizable workspace panels that can be dragged back to the dock; keyboard and visible-button alternatives remain available.

## 2026-09-20 — delivery loop workspace

- Added a six-stage delivery cockpit backed by live Bridge facts rather than static demo data.
- Added contextual tools for Maker Doctor, visual editing, preview, evidence capture, test QR generation and explicit remote build.
- Expanded project asset discovery to images, audio, video, models and fonts, with source/config reference detection.
- Added an evidence center for preview shots, UI sidecars, Runtime snapshots and test QR readiness.
- Exposed the shared delivery overview and objective through the project MCP.

## 2026-09-18 — M0 working slice

- Added React/Vite Studio, Electron desktop host, protocol and local Bridge workspaces.
- Bound the pilot project read-only and discovered official Maker `0.0.34-beta.4`.
- Added official preview status/log/start/stop/refresh adapters.
- Added project real-path and symlink-escape rejection.
- Added static/hybrid Lua UI conversion with stable source mappings and source hashes.
- Loaded real `HomePage.lua` in Monaco without enabling project writes.
- Added visual patch revisions, WebSocket synchronization, undo and redo.
- Added Runtime command queue and staged state-preserving Lua adapter.
- Added project MCP resources and tools for Codex, Claude and Cursor.
- Upgraded Electron and Vitest to audited fixed releases and pinned a fixed DOMPurify transitive dependency.
- Kept Shell disabled until macOS and Windows OS-sandbox escape suites pass.
- Made no changes to the pilot project or official Maker installation.
- Reserved a macOS-only title-bar safe area so the TapMakerWork brand does not overlap native traffic-light controls; browser and Windows layouts remain unchanged.
- Added double-click macOS and Windows launchers with remembered project selection, first-run dependency installation and actionable startup errors.
