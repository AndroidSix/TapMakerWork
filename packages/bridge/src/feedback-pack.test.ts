import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  buildFeedbackMarkdown,
  captureStreamLines,
  createLogRing,
  feedbackFileName,
  readProjectGameVersion,
  redactSensitive,
  saveFeedbackPack,
  type FeedbackPackInput
} from "./feedback-pack.js";

const FIXED_TIME = new Date("2026-10-12T08:30:15.123Z");

function packInput(overrides: Partial<FeedbackPackInput> = {}): FeedbackPackInput {
  return {
    generatedAt: FIXED_TIME,
    client: { appVersion: "0.1.7" },
    environment: { platform: "win32", arch: "x64", osRelease: "10.0.22631", node: "v22.12.0", makerVersion: "0.0.34", protocolVersion: 1 },
    project: { name: "proj", root: "/home/dev/games/proj", gameVersion: "0.6.7" },
    recentErrors: [],
    runtimeLogs: ["[lua] main.lua loaded"],
    bridgeLogs: [],
    studioLogs: {},
    ...overrides
  };
}

describe("log ring", () => {
  it("keeps only the newest lines with timestamps and skips blanks", () => {
    const ring = createLogRing(2, () => FIXED_TIME);
    for (const line of ["a", "  ", "b", "c"]) ring.push(line);
    expect(ring.lines()).toEqual([`${FIXED_TIME.toISOString()} b`, `${FIXED_TIME.toISOString()} c`]);
  });

  it("records every line written to a captured stream while still forwarding it", () => {
    const ring = createLogRing(10, () => FIXED_TIME);
    const stream = new PassThrough() as unknown as NodeJS.WriteStream;
    const forwarded: string[] = [];
    (stream as unknown as PassThrough).on("data", (chunk: Buffer) => forwarded.push(chunk.toString("utf8")));
    captureStreamLines(stream, ring);
    stream.write("first\nsecond\n");
    expect(ring.lines().map((line) => line.split(" ")[1])).toEqual(["first", "second"]);
    expect(forwarded.join("")).toBe("first\nsecond\n");
  });
});

describe("redactSensitive", () => {
  it("masks tokens and replaces the home directory", () => {
    const text = [
      "Authorization: Bearer abc.def",
      "{\"access_token\":\"xyz\",\"ok\":true}",
      "GET https://x.test/a?token=123&page=2",
      "C:\\Users\\dev\\proj and C:/Users/dev/proj"
    ].join("\n");
    expect(redactSensitive(text, "C:\\Users\\dev")).toBe([
      "Authorization: Bearer ***",
      "{\"access_token\":\"***\",\"ok\":true}",
      "GET https://x.test/a?token=***&page=2",
      "~\\proj and ~/proj"
    ].join("\n"));
  });
});

describe("buildFeedbackMarkdown", () => {
  it("includes environment, project and logs with the home directory hidden", () => {
    const markdown = buildFeedbackMarkdown(packInput({
      description: "点击启动后黑屏",
      runtimeError: "main.lua:12: attempt to index nil",
      studioLogs: { runtime: ["启动预览"], build: [] }
    }), "/home/dev");
    expect(markdown).toContain("点击启动后黑屏");
    expect(markdown).toContain("- TapMakerWork：0.1.7");
    expect(markdown).toContain("- 系统：win32 x64 10.0.22631");
    expect(markdown).toContain("- 目录：~/games/proj");
    expect(markdown).toContain("- 游戏版本：0.6.7");
    expect(markdown).toContain("main.lua:12: attempt to index nil");
    expect(markdown).toContain("## Studio 终端：runtime");
    expect(markdown).not.toContain("## Studio 终端：build");
    expect(markdown).not.toContain("/home/dev");
  });

  it("asks for a description and handles a closed project", () => {
    const markdown = buildFeedbackMarkdown(packInput({ project: undefined, runtimeLogs: [] }), "/home/dev");
    expect(markdown).toContain("（请补充：");
    expect(markdown).toContain("- 未打开项目");
    expect(markdown).toContain("没有可读的 Runtime 日志");
  });

  it("keeps log lines from breaking out of code fences", () => {
    const markdown = buildFeedbackMarkdown(packInput({ runtimeLogs: ["```", "# 标题"] }), "/home/dev");
    expect(markdown.match(/^```/gm)?.length).toBe(markdown.match(/^```text$/gm)!.length * 2);
  });
});

describe("feedback files", () => {
  it("names the file after the generation time and saves it", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tmw-feedback-"));
    const fileName = feedbackFileName(FIXED_TIME);
    expect(fileName).toBe("tapmakerwork-feedback-20261012-083015.md");
    const saved = saveFeedbackPack(path.join(directory, "nested"), fileName, "# 反馈");
    expect(fs.readFileSync(saved, "utf8")).toBe("# 反馈");
  });

  it("reads the game version from the Maker project file", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tmw-feedback-project-"));
    expect(readProjectGameVersion(projectRoot)).toBeUndefined();
    fs.mkdirSync(path.join(projectRoot, ".project"));
    fs.writeFileSync(path.join(projectRoot, ".project", "project.json"), JSON.stringify({ version: "0.6.7" }));
    expect(readProjectGameVersion(projectRoot)).toBe("0.6.7");
  });
});
