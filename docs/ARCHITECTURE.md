# TapMakerWork architecture

## Product boundary

TapMakerWork is the IDE. The official `@taptap/maker` CLI remains the authority for Runtime installation, local preview lifecycle, builds, QR codes, and logs. TapMakerWork composes those capabilities instead of reimplementing them.

## Processes

```text
Electron desktop host / Maker console iframe
                 |
          shared Studio UI
                 |
       loopback Editor Bridge
        /        |          \
Maker CLI   UI Dev Bridge   sandbox worker
    |            |               |
Preview      live widgets     project-only PTY
Supervisor       |
    \________ UrhoXRuntime
```

The loopback bridge must validate `Host` and `Origin`, expose no Maker credentials, and bind only to `127.0.0.1`.

## UI source-of-truth migration

The runtime converter observes an instantiated widget tree and emits:

- `*.ui.json`: hierarchy, layout, appearance, animation, theme and responsive rules;
- `*.controller.lua`: named actions, data bindings, conditions and list providers;
- `*.legacy.lua`: the recoverable source used before conversion.

Only executed UI states can be observed. Conditional variants are captured as separate scenarios and merged into conditional or list nodes. After conversion, `.ui.json` owns visual structure and Lua owns behavior.

## Live editing

The existing `urhox-libs/UI/Core/UIInspector` is the runtime editing kernel. The project dev bridge adds transport and stable node identifiers without changing the official Runtime binary. Layout and appearance patches mutate live widgets. Behavior or custom-widget code changes replace only the affected UI subtree.

The first transport is a Runtime-initiated loopback HTTP channel. Lua polls a bounded command queue from the existing game update loop and applies property changes through `Widget:SetStyle`. This avoids the official `preview refresh` path, which explicitly restarts Runtime and loses memory state. A Runtime snapshot replaces the static converter's dynamic slots once the adapter is installed.

## Runtime view

The editor protocol supports adjustable 1-60 FPS, pause, resolution, orientation, DPR and safe-area metadata. The first spike uses a portable frame-provider interface. Native capture is admitted only after latency, permission and window-identity tests pass on both platforms.

## Terminals

Channels are isolated by purpose: Runtime, Build, Lua diagnostics, Shell, Lua REPL, QR, and Agent. Shell execution fails closed until an OS-level sandbox proves that child processes cannot read or write outside the mounted project root.

## Upstream maintenance

Official Maker changes are kept behind adapters. Any unavoidable upstream modification must include the exact upstream commit, a patch series, a rationale, replay instructions, and compatibility tests. Runtime binary changes are a last resort.

The current milestone modifies neither the official Maker runtime nor the pilot project. See `UPSTREAM.md`.
