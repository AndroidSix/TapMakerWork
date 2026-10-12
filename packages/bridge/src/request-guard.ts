import type { IncomingHttpHeaders } from "node:http";

export const DEV_STUDIO_ORIGINS = ["http://127.0.0.1:4173", "http://localhost:4173"];

/** Read-only image endpoints that Studio embeds via <img>/CSS, which browsers send without an Origin header. */
export const PASSIVE_IMAGE_PATHS = new Set([
  "/api/project/asset",
  "/api/maker/qrcode/image",
  "/api/tools/new-game-radar/icon",
  "/api/tools/image-compress/preview"
]);

export interface RequestGuardOptions {
  bridgeHost: string;
  allowDevOrigin: boolean;
}

export type RequestGuardResult = { ok: true } | { ok: false; reason: "invalid_host" | "invalid_origin" | "cross_site_request" };

export function isAllowedOrigin(origin: string, allowDevOrigin: boolean): boolean {
  return origin.startsWith("file://") || (allowDevOrigin && DEV_STUDIO_ORIGINS.includes(origin));
}

export function checkBridgeRequest(
  request: { method?: string | undefined; headers: IncomingHttpHeaders; pathname: string },
  options: RequestGuardOptions
): RequestGuardResult {
  if (request.headers.host !== options.bridgeHost) return { ok: false, reason: "invalid_host" };
  const origin = request.headers.origin;
  if (origin) return isAllowedOrigin(origin, options.allowDevOrigin) ? { ok: true } : { ok: false, reason: "invalid_origin" };
  const fetchSite = request.headers["sec-fetch-site"];
  const fromWebPage = fetchSite === "cross-site" || fetchSite === "same-site";
  // Web pages always attach Origin to CORS requests; only Electron's file:// Studio sends them without one.
  const packagedStudioFetch = request.headers["sec-fetch-mode"] === "cors";
  if (fromWebPage && !packagedStudioFetch && !(request.method === "GET" && PASSIVE_IMAGE_PATHS.has(request.pathname))) {
    return { ok: false, reason: "cross_site_request" };
  }
  return { ok: true };
}
