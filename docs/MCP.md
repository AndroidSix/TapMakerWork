# TapMakerWork project MCP

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

## Tools

- `read_project_file`
- `convert_lua_ui`
- `ui_apply_patch`
- `ui_undo`
- `ui_redo`

All file paths are project-relative and pass through real-path boundary checks. The MCP server exposes no general shell execution.
