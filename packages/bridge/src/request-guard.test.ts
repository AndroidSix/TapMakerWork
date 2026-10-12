import { describe, expect, it } from "vitest";
import { checkBridgeRequest } from "./request-guard.js";

const bridgeHost = "127.0.0.1:43121";
const packaged = { bridgeHost, allowDevOrigin: false };
const dev = { bridgeHost, allowDevOrigin: true };

function request(headers: Record<string, string>, pathname = "/api/health", method = "GET") {
  return { method, pathname, headers: { host: bridgeHost, ...headers } };
}

describe("checkBridgeRequest", () => {
  it("rejects a foreign Host header (DNS rebinding)", () => {
    expect(checkBridgeRequest({ method: "GET", pathname: "/api/health", headers: { host: "evil.test:43121" } }, dev))
      .toEqual({ ok: false, reason: "invalid_host" });
  });

  it("allows the packaged Studio file:// origin", () => {
    expect(checkBridgeRequest(request({ origin: "file://" }), packaged)).toEqual({ ok: true });
  });

  it("allows the Vite dev origin only in development", () => {
    expect(checkBridgeRequest(request({ origin: "http://127.0.0.1:4173" }), dev)).toEqual({ ok: true });
    expect(checkBridgeRequest(request({ origin: "http://127.0.0.1:4173" }), packaged)).toEqual({ ok: false, reason: "invalid_origin" });
  });

  it("rejects other web origins", () => {
    expect(checkBridgeRequest(request({ origin: "https://evil.test" }), dev)).toEqual({ ok: false, reason: "invalid_origin" });
  });

  it("allows local tools without browser fetch metadata (agents, curl, Runtime)", () => {
    expect(checkBridgeRequest(request({}, "/api/agent/command", "POST"), packaged)).toEqual({ ok: true });
  });

  it("blocks cross-site browser requests without Origin except passive image GETs", () => {
    expect(checkBridgeRequest(request({ "sec-fetch-site": "cross-site" }, "/api/runtime/commands"), packaged))
      .toEqual({ ok: false, reason: "cross_site_request" });
    expect(checkBridgeRequest(request({ "sec-fetch-site": "cross-site" }, "/api/project/asset"), packaged)).toEqual({ ok: true });
    expect(checkBridgeRequest(request({ "sec-fetch-site": "same-site" }, "/api/project/asset", "POST"), packaged))
      .toEqual({ ok: false, reason: "cross_site_request" });
  });
});
