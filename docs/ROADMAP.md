# Delivery roadmap

## M0 - feasibility gates

- [ ] Runtime frame-provider contract and adjustable-FPS demo (UI contract exists; native frames are not connected).
- [x] Remote UI snapshot, command queue and live property patching contract.
- [ ] macOS and Windows filesystem-sandbox escape suite (Shell remains fail-closed).
- [x] Official Maker preview status, log and lifecycle adapters.
- [x] Static/hybrid Lua UI converter with source mapping and dynamic-slot preservation.
- [x] Project MCP resources/tools smoke-tested over stdio.

## M1 - IDE foundation

- project tabs, file tree, Monaco editor and search;
- Git status and diff review;
- official Runtime lifecycle controls;
- categorized terminals and task history.

## M2 - visual editor

- hierarchy, canvas selection, resize and keyboard alternatives;
- property, event, animation, theme and responsive inspectors;
- device presets plus custom resolution, DPR and safe areas;
- undo/redo and transactional saves.

## M3 - Lua migration and hot reload

- page-by-page runtime capture;
- `.ui.json + Controller.lua` generation;
- legacy preservation and rollback;
- subtree replacement without process restart.

## M4 - external agents

- project-scoped MCP resources for selection, logs and diagnostics;
- tools that produce reviewable code/event diffs;
- adapters for Codex, Claude and Cursor.

## Pilot acceptance

Open the `HomePage` of the selected Maker project, select a button in the live Runtime view, change layout and appearance, save to `.ui.json`, and observe the result without restarting Runtime or losing the game/network state.
