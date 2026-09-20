# TapMakerWork project MCP

创建于 2026-09-18
更新于 2026-09-19

The project MCP is a stdio adapter over the active loopback Bridge. The IDE remains the owner of project selection, UI revision history and Runtime state.

## Client command

After `npm run build`, configure the client with an absolute Node executable and the absolute path to `packages/bridge/dist/mcp.js`.

Claude Desktop and Cursor use the usual JSON server shape:

```json
{
  "mcpServers": {
    "tapmakerwork": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/packages/bridge/dist/mcp.js"],
      "env": {
        "TAPMAKERWORK_BRIDGE_URL": "http://127.0.0.1:43121"
      }
    }
  }
}
```

Codex uses the equivalent stdio server entry in its MCP configuration. Client configuration is intentionally not written automatically in M0.

## Resources

- `tapmakerwork://project`
- `tapmakerwork://ui/snapshot`
- `tapmakerwork://runtime/status`
- `tapmakerwork://runtime/logs`
- `tapmakerwork://system/info`
- `tapmakerwork://runtime/adapter`
- `tapmakerwork://workflow/overview` — delivery stages, semantic asset binding and saved evidence

## Tools

- `read_project_file`
- `convert_lua_ui`
- `ui_apply_patch`
- `ui_undo`
- `ui_redo`
- `project_search`
- `git_status`
- `maker_preview_status`
- `maker_preview_logs`
- `maker_preview_start`
- `maker_preview_stop`
- `maker_preview_refresh`
- `maker_doctor`
- `maker_build` — official remote build; does not auto-open preview URLs
- `maker_qrcode` — official test QR generation
- `maker_project_meta` — project.json metadata including test QR URL
- `export_runtime_adapter`
- `runtime_adapter_status`
- `workflow_set_objective` — writes only `.tapmakerwork/workflow.json`

All file paths are project-relative and pass through real-path boundary checks. The MCP server exposes no general shell execution.

`export_runtime_adapter` writes only under TapMakerWork `outputs/runtime-adapter` and never modifies the Maker project.
