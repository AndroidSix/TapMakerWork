# TapMakerWork M0 status

Date: 2026-09-18

The first executable TapMakerWork slice is running against the Maker project `乱世夺城` without modifying that project.

## Working now

- Electron desktop host and dense dark IDE workspace.
- Current-project binding and real project file viewing.
- Official Maker `0.0.34-beta.4` discovery and preview status/log/lifecycle calls.
- Central resolution-aware UI canvas with phone portrait, phone landscape, tablet, desktop, custom size, DPR, safe area metadata and 1–60 FPS control.
- Static/hybrid conversion of `scripts/ui/HomePage.lua` into a visual tree with exact source-line mapping.
- Dynamic Lua expressions preserved as explicit Runtime slots instead of guessed values.
- Live in-memory property patches, WebSocket synchronization, revision checks, undo and redo.
- Runtime-side command queue and a staged Lua adapter that applies `Widget:SetStyle` without `preview refresh`.
- Project MCP verified with 5 tools and 4 resources for Codex, Claude and Cursor.
- Project path traversal and symlink escape rejection.

## Deliberately locked

- Shell execution: disabled until real macOS and Windows OS-level sandboxes pass escape tests.
- Pilot-project writes: disabled until the Runtime adapter and rollback path are reviewed and tested.
- Native Runtime frames: not yet embedded; the center canvas currently renders converted UI IR. The frame-provider capability remains false.

## Verification

- TypeScript strict typecheck: passed.
- Unit tests: 8 total checks across protocol, project boundary, history and Lua conversion; passed at the time of this report.
- Production builds: protocol, Bridge, Studio and desktop host passed.
- Electron desktop host: launched successfully on macOS; dependency baseline upgraded to the audited `44.4.2` before final verification.
- npm dependency audit: 0 known vulnerabilities.
- Official Maker preview status: returned a valid stopped session for the pilot project.
- MCP stdio smoke test: listed tools/resources and read the real `HomePage.lua`.

## Next acceptance gate

Install the staged Runtime adapter into a reviewable pilot branch, capture the authoritative live widget tree, apply visual patches to the running game, and verify that gameplay/network state survives. Native macOS and Windows frame-provider and sandbox tests remain parallel platform gates.
