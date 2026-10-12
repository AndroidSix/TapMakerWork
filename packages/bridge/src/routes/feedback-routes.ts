import { readJson, sendJson } from "../http-json.js";
import {
  buildFeedbackMarkdown,
  feedbackFileName,
  saveFeedbackPack,
  type FeedbackClientInfo,
  type FeedbackPackInput,
  type LogRing
} from "../feedback-pack.js";
import type { BridgeRoute } from "./route-table.js";

const STUDIO_LINES_PER_CHANNEL = 80;
const BRIDGE_LOG_LINES = 200;

export type FeedbackBridgeContext = Omit<FeedbackPackInput, "generatedAt" | "description" | "client" | "runtimeError" | "bridgeLogs" | "studioLogs">;

interface FeedbackRequestBody {
  description?: unknown;
  client?: unknown;
  runtimeError?: unknown;
  studioLogs?: unknown;
  save?: unknown;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseClient(value: unknown): FeedbackClientInfo {
  const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    appVersion: optionalText(record.appVersion),
    desktopVersion: optionalText(record.desktopVersion),
    userAgent: optionalText(record.userAgent),
    screen: optionalText(record.screen)
  };
}

function parseStudioLogs(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
    .map(([channel, lines]) => [channel, lines.filter((line): line is string => typeof line === "string").slice(-STUDIO_LINES_PER_CHANNEL)]));
}

export function createFeedbackRoutes({ bridgeLog, collectContext, outputDir, now = () => new Date() }: {
  bridgeLog: LogRing;
  collectContext: () => FeedbackBridgeContext;
  outputDir: () => string;
  now?: () => Date;
}): BridgeRoute[] {
  return [
    {
      method: "POST",
      path: "/api/feedback/pack",
      async handle({ request, response }) {
        const body = await readJson(request, 2_000_000) as FeedbackRequestBody;
        const generatedAt = now();
        const markdown = buildFeedbackMarkdown({
          ...collectContext(),
          generatedAt,
          description: optionalText(body.description),
          client: parseClient(body.client),
          runtimeError: optionalText(body.runtimeError),
          bridgeLogs: bridgeLog.lines().slice(-BRIDGE_LOG_LINES),
          studioLogs: parseStudioLogs(body.studioLogs)
        });
        const fileName = feedbackFileName(generatedAt);
        const savedPath = body.save === true ? saveFeedbackPack(outputDir(), fileName, markdown) : undefined;
        sendJson(response, 200, { markdown, fileName, ...(savedPath ? { savedPath } : {}) });
      }
    }
  ];
}
