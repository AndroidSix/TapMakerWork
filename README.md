# TapMakerWork

TapMakerWork is a macOS and Windows IDE for TapTap Maker projects. It combines the official Maker CLI and Runtime lifecycle with a live visual UI editor, project-scoped terminals, code editing, Git review, and external AI-client integration.

This repository currently contains the first working feasibility slice:

- a shared browser-based IDE workspace;
- a project-aware local bridge;
- a typed live-editor protocol;
- an Electron desktop host;
- static/hybrid conversion of existing Lua widget trees into visual IR;
- undo/redo, official Runtime lifecycle controls, and a state-preserving Runtime command queue;
- a project MCP server for Codex, Claude and Cursor;
- a reviewed, project-scoped Lua Runtime adapter installer with automatic entry backup;
- a delivery cockpit that turns environment, project, content, Runtime, evidence and build readiness into one actionable workflow;
- a semantic asset audit for images, audio, video, models and fonts, including source/config reference evidence;
- whole-project UI discovery across `scripts`, with one-click rescanning and source navigation;
- an offline-bundled Monaco editor for expanding, viewing and editing project files without a CDN dependency;
- Cocos-style Runtime transforms with Shift multi-selection, `W/E/R/T` shortcuts and Ctrl/Cmd incremental snapping;
- device-default Maker MCP discovery with stable/Beta update checks, installation and version switching;
- stable-LTS Node.js update checks and an isolated managed runtime for Maker MCP processes;
- realtime drag commits with gesture-level undo, plus Unity-style RGBA controls for image, text and background colors;
- native Maker Runtime window capture on macOS with project-aware window matching, plus fail-closed filesystem sandboxing.

## Start the prototype

### One-click launchers

- macOS: double-click `outputs/launchers/TapMakerWork-macOS.command`
- Windows: double-click `outputs/launchers/TapMakerWork-Windows.cmd`

Both launchers remember the last Maker project and install dependencies on first run. See `outputs/launchers/README.md`.

### Command line

```bash
npm install
npm run dev:web
```

Open `http://127.0.0.1:4173`. To bind a Maker project at startup:

```bash
TAPMAKERWORK_PROJECT="/absolute/path/to/project" npm run dev:web
```

The desktop host is available through `npm run dev` after Electron dependencies are installed.

The default pilot UI entry is `scripts/ui/HomePage.lua`. Override it with `TAPMAKERWORK_UI_ENTRY`.

## Project MCP

Build first, keep the Bridge running, then point any stdio MCP client at:

```text
node /absolute/path/to/packages/bridge/dist/mcp.js
```

The MCP server exposes project files, conversion, the current visual snapshot, Runtime status/logs, visual patches and undo/redo. It has no shell tool. See `docs/MCP.md`.

## Safety status

The Shell panel is deliberately disabled until an OS-backed sandbox passes the macOS and Windows escape tests. Setting a working directory is not considered a sandbox.

Runtime integration is opt-in per project. The installer writes only the managed bridge hook and adapter, and backs up the original entry file under `.tapmakerwork/backups`; it does not modify the official Maker installation.

See `docs/ARCHITECTURE.md` and `docs/ROADMAP.md` for the implementation contract.
