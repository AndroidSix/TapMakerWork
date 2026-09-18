# Upstream integration record

## Official Maker

- Source repository: `https://github.com/taptap/instant-games-open-mcp`
- Local inspected branch/content: beta checkout under `work/instant-games-open-mcp`
- Installed Maker runtime used by the adapter: `0.0.34-beta.4`
- Installed entry: `~/.taptap-maker/mcp-runtime/0.0.34-beta.4/dist/maker.js`

## Patch status

No official Maker source or installed Runtime file has been modified.

TapMakerWork integrates through:

1. the public Maker CLI for preview lifecycle, status and logs;
2. a separate loopback Editor Bridge;
3. a project-side Lua development adapter staged at `runtime/lua/TapMakerWorkBridge.lua`;
4. the existing UIInspector and Widget public behavior in Maker projects.

If an upstream patch becomes unavoidable, place it under `patches/instant-games-open-mcp/<upstream-commit>/` and record rationale, affected files, replay command and compatibility tests here before applying it.
