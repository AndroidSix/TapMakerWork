# Upstream integration record

## Official Maker

- Source repository: `https://github.com/taptap/instant-games-open-mcp`
- Local inspected branch/content: beta checkout under `work/instant-games-open-mcp`
- Runtime selection defaults to the highest semantic version installed under `~/.taptap-maker/mcp-runtime`.
- Users can follow the installed stable or Beta channel, or pin an exact installed version, from Studio settings.
- Update discovery reads the official `@taptap/maker` registry `latest` and `beta` dist-tags; installation delegates to the public Maker self-upgrade command.
- Node.js update discovery reads the official release index and exposes only stable LTS releases. Optional installs live under `~/.tapmakerwork/node-runtime` and are used for Maker subprocesses without replacing the device Node.js.

## Patch status

No official Maker source or installed Runtime file has been modified.

TapMakerWork integrates through:

1. the public Maker CLI for preview lifecycle, status and logs;
2. a separate loopback Editor Bridge;
3. a project-side Lua development adapter staged at `runtime/lua/TapMakerWorkBridge.lua`;
4. the existing UIInspector and Widget public behavior in Maker projects.

The selected channel is stored as a device-level TapMakerWork preference under `~/.tapmakerwork`; project files are not changed by version selection.

If an upstream patch becomes unavoidable, place it under `patches/instant-games-open-mcp/<upstream-commit>/` and record rationale, affected files, replay command and compatibility tests here before applying it.
