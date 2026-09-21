#!/usr/bin/env node
/**
 * Free local telemetry receiver for TapMakerWork.
 *
 * Usage:
 *   node scripts/telemetry-receiver.mjs
 *   TAPMAKERWORK_TELEMETRY_PORT=8787 TAPMAKERWORK_TELEMETRY_DIR=./logs/telemetry node scripts/telemetry-receiver.mjs
 *
 * Then set the IDE telemetry endpoint to:
 *   http://127.0.0.1:8787/v1/events
 *
 * Events are appended as JSONL under the data directory. No auth, localhost-oriented.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const port = Number(process.env.TAPMAKERWORK_TELEMETRY_PORT || 8787);
const host = process.env.TAPMAKERWORK_TELEMETRY_HOST || "127.0.0.1";
const dataDir = path.resolve(process.env.TAPMAKERWORK_TELEMETRY_DIR || path.join("logs", "telemetry"));

fs.mkdirSync(dataDir, { recursive: true });

function dayFile(): string {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(dataDir, `events-${day}.jsonl`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, dataDir }));
    return;
  }
  if (req.method === "POST" && (req.url === "/v1/events" || req.url === "/")) {
    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || "{}");
      const events = Array.isArray(payload.events) ? payload.events : [];
      if (events.length > 0) {
        fs.appendFileSync(dayFile(), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
      }
      res.writeHead(200, { ...cors, "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, accepted: events.length }));
    } catch (error) {
      res.writeHead(400, { ...cors, "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }
  res.writeHead(404, { ...cors, "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "not_found" }));
});

server.listen(port, host, () => {
  console.log(`[telemetry-receiver] listening on http://${host}:${port}/v1/events`);
  console.log(`[telemetry-receiver] writing JSONL to ${dataDir}`);
});
