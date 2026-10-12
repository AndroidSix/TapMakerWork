import type { IncomingMessage, ServerResponse } from "node:http";

export interface RouteRequest {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
}

export interface BridgeRoute {
  method: "GET" | "POST";
  path: string;
  handle: (context: RouteRequest) => void | Promise<void>;
}

export function findRoute(routes: BridgeRoute[], method: string | undefined, pathname: string): BridgeRoute | undefined {
  return routes.find((route) => route.method === method && route.path === pathname);
}
