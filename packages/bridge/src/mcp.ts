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
  { name: "tapmakerwork-project", version: "0.1.0" },
  { capabilities: { resources: {}, tools: {} } }
);

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    { uri: "tapmakerwork://project", name: "Current Maker project", mimeType: "application/json" },
    { uri: "tapmakerwork://ui/snapshot", name: "Live visual UI snapshot", mimeType: "application/json" },
    { uri: "tapmakerwork://runtime/status", name: "Official Maker Runtime status", mimeType: "application/json" },
    { uri: "tapmakerwork://runtime/logs", name: "Official Maker Runtime logs", mimeType: "application/json" }
  ]
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const routes: Record<string, string> = {
    "tapmakerwork://project": "/api/project",
    "tapmakerwork://ui/snapshot": "/api/ui/snapshot",
    "tapmakerwork://runtime/status": "/api/maker/preview/status",
    "tapmakerwork://runtime/logs": "/api/maker/preview/logs"
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
    { name: "ui_redo", description: "Redo the latest in-memory visual patch.", inputSchema: { type: "object", properties: {}, additionalProperties: false } }
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
    default: throw new Error(`unknown_tool:${request.params.name}`);
  }
});

await server.connect(new StdioServerTransport());
process.stderr.write(`[TapMakerWork] Project MCP connected to ${bridgeUrl}\n`);
