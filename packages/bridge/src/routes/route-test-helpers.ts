import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { findRoute, type BridgeRoute } from "./route-table.js";

export interface CapturedResponse {
  status: number;
  headers: Record<string, unknown>;
  json: () => unknown;
}

export async function callRoute(routes: BridgeRoute[], method: "GET" | "POST", target: string, body?: unknown): Promise<CapturedResponse> {
  const url = new URL(target, "http://127.0.0.1:43121");
  const route = findRoute(routes, method, url.pathname);
  if (!route) throw new Error(`route_not_found ${method} ${url.pathname}`);
  const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
  const captured = { status: 0, headers: {} as Record<string, unknown>, body: "" };
  const response = {
    writeHead(status: number, headers: Record<string, unknown> = {}) {
      captured.status = status;
      captured.headers = headers;
      return this;
    },
    end(chunk?: string | Buffer) {
      if (chunk) captured.body += chunk.toString();
      return this;
    }
  } as unknown as ServerResponse;
  await route.handle({ request, response, url });
  return { status: captured.status, headers: captured.headers, json: () => JSON.parse(captured.body) };
}
