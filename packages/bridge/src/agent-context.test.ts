import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_FILE_ACTIONS,
  listAgentInboxRequests,
  looksLikeFailureLine,
  markAgentContextOffline,
  parseAgentFileRequest,
  publishAgentContext,
  pushAgentError,
  upsertAgentsMdPointer,
  writeAgentOutbox,
  writeAgentPreviewFrame
} from "./agent-context.js";

const temps: string[] = [];

function tempProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-context-"));
  temps.push(root);
  return root;
}

afterEach(() => {
  for (const root of temps.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("agent-context file channel", () => {
  it("parses expanded inbox requests", () => {
    expect(parseAgentFileRequest({ id: "1", action: "maker_build" })).toMatchObject({ id: "1", action: "maker_build" });
    expect(parseAgentFileRequest({
      id: "2",
      action: "open_terminal",
      channel: "runtime"
    })).toMatchObject({ channel: "runtime" });
    expect(parseAgentFileRequest({ id: "1", action: "shell" })).toBeUndefined();
    expect(AGENT_FILE_ACTIONS).toContain("capture_frame");
  });

  it("publishes STATUS / errors / snapshot under .tapmakerwork/ai", () => {
    const root = tempProject();
    publishAgentContext({
      projectRoot: root,
      projectName: "demo",
      bridgeUrl: "http://127.0.0.1:43121",
      snapshot: {
        revision: 3,
        selectedId: "n1",
        root: { id: "n1", type: "Panel", name: "root", props: {}, children: [] }
      },
      snapshotSource: "runtime",
      runtimeScene: "live",
      runtimeSessionId: "sess-1",
      activeUiEntry: "scripts/ui/HomePage.lua",
      errors: [{ at: "2026-10-06T00:00:00.000Z", channel: "runtime", message: "预览失败" }],
      recentLogs: { runtime: ["ok", "预览失败"] }
    });
    const ai = path.join(root, ".tapmakerwork", "ai");
    expect(fs.existsSync(path.join(ai, "STATUS.md"))).toBe(true);
    expect(fs.existsSync(path.join(ai, "CONTEXT.md"))).toBe(true);
    expect(fs.existsSync(path.join(ai, "errors.json"))).toBe(true);
    expect(fs.existsSync(path.join(ai, "logs-summary.json"))).toBe(true);
    const status = JSON.parse(fs.readFileSync(path.join(ai, "runtime-status.json"), "utf8")) as {
      alive: boolean;
      httpApi: string;
      errorCount: number;
    };
    expect(status.alive).toBe(true);
    expect(status.httpApi).toContain("/api/agent");
    expect(status.errorCount).toBe(1);
    expect(fs.readFileSync(path.join(ai, "STATUS.md"), "utf8")).toContain("改完必须再读");
    expect(fs.readFileSync(path.join(ai, "CONTEXT.md"), "utf8")).toContain("/api/agent/command");
  });

  it("writes preview.png from data URL", () => {
    const root = tempProject();
    // 1x1 PNG
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const written = writeAgentPreviewFrame(root, `data:image/png;base64,${png}`);
    expect(written.bytes).toBeGreaterThan(30);
    expect(fs.existsSync(path.join(root, ".tapmakerwork", "ai", "preview.png"))).toBe(true);
  });

  it("upserts AGENTS.md closed-loop instructions", () => {
    const root = tempProject();
    fs.writeFileSync(path.join(root, "AGENTS.md"), "# Maker\n\nhello\n", "utf8");
    upsertAgentsMdPointer(root);
    upsertAgentsMdPointer(root);
    const text = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
    expect(text.match(/tapmakerwork-ai-begin/g)?.length).toBe(1);
    expect(text).toContain("每次改动后必须再读");
  });

  it("lists inbox requests and writes outbox", () => {
    const root = tempProject();
    const inbox = path.join(root, ".tapmakerwork", "ai", "inbox");
    fs.mkdirSync(inbox, { recursive: true });
    const file = path.join(inbox, "a.json");
    fs.writeFileSync(file, JSON.stringify({ id: "a", action: "publish_now" }), "utf8");
    expect(listAgentInboxRequests(root)).toHaveLength(1);
    writeAgentOutbox(root, {
      id: "a",
      ok: true,
      action: "publish_now",
      finishedAt: new Date().toISOString()
    }, file);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.join(root, ".tapmakerwork", "ai", "outbox", "a.json"))).toBe(true);
  });

  it("tracks failure lines into error buffer", () => {
    expect(looksLikeFailureLine("Maker preview start 失败")).toBe(true);
    expect(looksLikeFailureLine("完成")).toBe(false);
    const next = pushAgentError([], "runtime", "失败了");
    expect(next).toHaveLength(1);
  });

  it("marks offline without throwing when ai dir missing", () => {
    const root = tempProject();
    markAgentContextOffline(root, "demo", "http://127.0.0.1:43121");
    expect(fs.existsSync(path.join(root, ".tapmakerwork", "ai"))).toBe(false);
  });
});
