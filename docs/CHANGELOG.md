# Change log

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
- Tracks bounded product events (`app.launch` / `app.quit`, project open, preview, live-edit, adapter install, build) without project paths, source or Maker credentials.
- Added a free local receiver (`npm run telemetry:receiver`) and optional HTTPS / localhost endpoint flush from desktop settings.

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
