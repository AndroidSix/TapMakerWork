import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import type { UiPatch, UiSnapshot, UiValue } from "@tapmakerwork/protocol";

const bridgeUrl = process.env.TAPMAKERWORK_BRIDGE_URL || "http://127.0.0.1:43121";

async function bridge<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${bridgeUrl}${pathname}`, init);
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error || `bridge_http_${response.status}`);
  return value;
}

function jsonText(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

const server = new Server(
  { name: "tapmakerwork-project", version: "0.1.3" },
  { capabilities: { resources: {}, tools: {} } }
);

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    { uri: "tapmakerwork://project", name: "Current Maker project", mimeType: "application/json" },
    { uri: "tapmakerwork://ui/snapshot", name: "Live visual UI snapshot", mimeType: "application/json" },
    { uri: "tapmakerwork://runtime/status", name: "Official Maker Runtime status", mimeType: "application/json" },
    { uri: "tapmakerwork://runtime/logs", name: "Official Maker Runtime logs", mimeType: "application/json" },
    { uri: "tapmakerwork://system/info", name: "Bridge system info", mimeType: "application/json" },
    { uri: "tapmakerwork://runtime/adapter", name: "Runtime adapter install status", mimeType: "application/json" },
    { uri: "tapmakerwork://maker/project-meta", name: "Maker project metadata and test QR URL", mimeType: "application/json" },
    { uri: "tapmakerwork://workflow/overview", name: "Delivery workflow, asset binding and evidence overview", mimeType: "application/json" }
  ]
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const routes: Record<string, string> = {
    "tapmakerwork://project": "/api/project",
    "tapmakerwork://ui/snapshot": "/api/ui/snapshot",
    "tapmakerwork://runtime/status": "/api/maker/preview/status",
    "tapmakerwork://runtime/logs": "/api/maker/preview/logs",
    "tapmakerwork://system/info": "/api/system/info",
    "tapmakerwork://runtime/adapter": "/api/runtime/adapter",
    "tapmakerwork://maker/project-meta": "/api/maker/project-meta",
    "tapmakerwork://workflow/overview": "/api/workflow/overview"
  };
  const route = routes[request.params.uri];
  if (!route) throw new Error("resource_not_found");
  const value = await bridge<unknown>(route);
  return { contents: [{ uri: request.params.uri, mimeType: "application/json", text: JSON.stringify(value, null, 2) }] };
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "read_project_file",
      description: "Read a UTF-8 file inside the currently bound Maker project. Project escape and symlink escape are rejected.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "Project-relative path" } },
        required: ["path"],
        additionalProperties: false
      }
    },
    {
      name: "convert_lua_ui",
      description: "Convert a Maker Lua UI file into TapMakerWork visual IR without writing project files.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "Project-relative Lua file" } },
        required: ["path"],
        additionalProperties: false
      }
    },
    {
      name: "ui_apply_patch",
      description: "Apply an in-memory visual property patch to the selected live UI model. This does not write source files.",
      inputSchema: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          props: { type: "object", additionalProperties: true }
        },
        required: ["nodeId", "props"],
        additionalProperties: false
      }
    },
    { name: "ui_undo", description: "Undo the latest in-memory visual patch.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "ui_redo", description: "Redo the latest in-memory visual patch.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    {
      name: "project_search",
      description: "Search text inside the bound Maker project files.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" }, limit: { type: "number" } },
        required: ["query"],
        additionalProperties: false
      }
    },
    { name: "git_status", description: "Read-only git status for the bound Maker project.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "maker_preview_status", description: "Official Maker preview status.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "maker_preview_logs", description: "Official Maker preview / supervisor logs when available.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "maker_preview_start", description: "Start official Maker preview for the bound project.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "maker_preview_stop", description: "Stop official Maker preview for the bound project.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "maker_preview_refresh", description: "Refresh official Maker preview for the bound project.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "maker_doctor", description: "Run official Maker doctor for the bound project.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "maker_build", description: "Run official Maker remote build (maker_build_current_directory equivalent). Does not auto-open preview URLs.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "maker_qrcode", description: "Generate official Maker test QR code for the bound project.", inputSchema: {
      type: "object",
      properties: { confirmedScreenOrientation: { type: "string", enum: ["portrait", "landscape"] } },
      additionalProperties: false
    } },
    { name: "maker_project_meta", description: "Read Maker project.json metadata including test QR URL.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    {
      name: "export_runtime_adapter",
      description: "Export the staged Runtime adapter package into TapMakerWork outputs/runtime-adapter. Does not write the Maker project.",
      inputSchema: {
        type: "object",
        properties: { projectName: { type: "string" } },
        additionalProperties: false
      }
    },
    { name: "runtime_adapter_status", description: "Whether TapMakerWorkBridge.lua is installed in the bound Maker project.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    {
      name: "workflow_set_objective",
      description: "Set the current delivery objective shown in TapMakerWork. This writes only .tapmakerwork/workflow.json in the bound project.",
      inputSchema: {
        type: "object",
        properties: { objective: { type: "string", minLength: 1, maxLength: 500 } },
        required: ["objective"],
        additionalProperties: false
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = (request.params.arguments || {}) as Record<string, unknown>;
  switch (request.params.name) {
    case "read_project_file": {
      const filePath = String(args.path || "");
      return jsonText(await bridge(`/api/project/file?path=${encodeURIComponent(filePath)}`));
    }
    case "convert_lua_ui": {
      const filePath = String(args.path || "");
      return jsonText(await bridge(`/api/ui/convert?path=${encodeURIComponent(filePath)}`));
    }
    case "ui_apply_patch": {
      const snapshot = await bridge<UiSnapshot>("/api/ui/snapshot");
      const patch: UiPatch = {
        requestId: crypto.randomUUID(),
        baseRevision: snapshot.revision,
        nodeId: String(args.nodeId || ""),
        props: (args.props || {}) as Record<string, UiValue | undefined>
      };
      return jsonText(await bridge("/api/ui/patch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch)
      }));
    }
    case "ui_undo": return jsonText(await bridge("/api/ui/undo", { method: "POST" }));
    case "ui_redo": return jsonText(await bridge("/api/ui/redo", { method: "POST" }));
    case "project_search": {
      const query = encodeURIComponent(String(args.query || ""));
      const limit = Number(args.limit || 50);
      return jsonText(await bridge(`/api/project/search?q=${query}&limit=${limit}`));
    }
    case "git_status": return jsonText(await bridge("/api/git/status"));
    case "maker_preview_status": return jsonText(await bridge("/api/maker/preview/status"));
    case "maker_preview_logs": return jsonText(await bridge("/api/maker/preview/logs"));
    case "maker_preview_start":
    case "maker_preview_stop":
    case "maker_preview_refresh": {
      const action = request.params.name.replace("maker_preview_", "");
      return jsonText(await bridge(`/api/maker/preview/${action}`, { method: "POST" }));
    }
    case "maker_doctor": return jsonText(await bridge("/api/maker/doctor"));
    case "maker_build": return jsonText(await bridge("/api/maker/build", { method: "POST" }));
    case "maker_qrcode": {
      return jsonText(await bridge("/api/maker/qrcode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmedScreenOrientation: args.confirmedScreenOrientation
        })
      }));
    }
    case "maker_project_meta": return jsonText(await bridge("/api/maker/project-meta"));
    case "export_runtime_adapter": {
      return jsonText(await bridge("/api/runtime/adapter/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectName: args.projectName })
      }));
    }
    case "runtime_adapter_status": return jsonText(await bridge("/api/runtime/adapter"));
    case "workflow_set_objective": {
      return jsonText(await bridge("/api/workflow/state", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objective: String(args.objective || "") })
      }));
    }
    default: throw new Error(`unknown_tool:${request.params.name}`);
  }
});

await server.connect(new StdioServerTransport());
process.stderr.write(`[TapMakerWork] Project MCP connected to ${bridgeUrl}\n`);
