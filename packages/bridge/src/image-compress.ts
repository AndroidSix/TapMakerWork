import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import { compressLocal, detectLocalEngines, localInstallHint } from "./local-compress.js";
import { writeFileAtomic } from "./project.js";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const TINYPNG_API_HOST = "api.tinify.com";
const TINYPNG_WEB_HOST = "tinypng.com";
const TINYPNG_WEB_PATH = "/backend/opt/shrink";
const TINYPNG_API_MAX = 4 * 1024 * 1024;
const TINYPNG_WEB_MAX = 5_200_000;
const MONTHLY_LIMIT = 500;

export interface ImageCompressSettings {
  tinyEnabled: boolean;
  tinyKeys: string[];
  useWebFallback: boolean;
}

export interface ImageCompressFileResult {
  path: string;
  success: boolean;
  skipped?: boolean;
  engine?: string;
  beforeBytes?: number;
  afterBytes?: number;
  durationMs?: number;
  error?: string;
}

export type ImageCompressJobState = "running" | "done" | "failed" | "cancelled";

export interface ImageCompressProgress {
  ok: boolean;
  state: ImageCompressJobState;
  target: string;
  total: number;
  processed: number;
  /** 正在压缩的文件绝对路径。 */
  current?: string;
  compressed: number;
  skipped: number;
  failed: number;
  savedBytes: number;
  tinyEnabled: boolean;
  keyCount: number;
  engine: string;
  files: ImageCompressFileResult[];
  aiCopyText: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

function configDir(): string {
  return path.join(os.homedir(), ".tapmakerwork");
}

function settingsPath(): string {
  return path.join(configDir(), "image-compress.json");
}

function keysPath(): string {
  return path.join(configDir(), "tiny_keys.txt");
}

export function defaultImageCompressSettings(): ImageCompressSettings {
  return { tinyEnabled: false, tinyKeys: [], useWebFallback: true };
}

function parseKeysText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

export function readImageCompressSettings(): ImageCompressSettings {
  const defaults = defaultImageCompressSettings();
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as Partial<ImageCompressSettings>;
    defaults.tinyEnabled = Boolean(raw.tinyEnabled);
    defaults.useWebFallback = raw.useWebFallback !== false;
  } catch {
    // keep defaults
  }
  try {
    if (fs.existsSync(keysPath())) {
      defaults.tinyKeys = parseKeysText(fs.readFileSync(keysPath(), "utf8"));
    }
  } catch {
    // keep empty keys
  }
  return defaults;
}

export function writeImageCompressSettings(patch: Partial<ImageCompressSettings>): ImageCompressSettings {
  const current = readImageCompressSettings();
  const next: ImageCompressSettings = {
    tinyEnabled: patch.tinyEnabled ?? current.tinyEnabled,
    tinyKeys: patch.tinyKeys ?? current.tinyKeys,
    useWebFallback: patch.useWebFallback ?? current.useWebFallback
  };
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(
    settingsPath(),
    `${JSON.stringify({ tinyEnabled: next.tinyEnabled, useWebFallback: next.useWebFallback }, null, 2)}\n`,
    "utf8"
  );
  if (patch.tinyKeys !== undefined) {
    const cleaned = next.tinyKeys.map((key) => key.trim()).filter((key) => key && !key.startsWith("#"));
    next.tinyKeys = cleaned;
    const body = [
      "# TinyPNG API keys（本地用户配置，勿提交到游戏仓库）",
      "# 申请地址：https://tinypng.com/developers",
      ...cleaned
    ].join("\n");
    fs.writeFileSync(keysPath(), `${body}\n`, { encoding: "utf8", mode: 0o600 });
  }
  return readImageCompressSettings();
}

export function imageCompressPublicSettings(): {
  tinyEnabled: boolean;
  useWebFallback: boolean;
  keyCount: number;
  keysConfigured: boolean;
  configDir: string;
  tinypngDevelopersUrl: string;
  localEngines: ReturnType<typeof detectLocalEngines>;
  localInstallHint: string;
} {
  const settings = readImageCompressSettings();
  return {
    tinyEnabled: settings.tinyEnabled,
    useWebFallback: settings.useWebFallback,
    keyCount: settings.tinyKeys.length,
    keysConfigured: settings.tinyKeys.length > 0,
    configDir: configDir(),
    tinypngDevelopersUrl: "https://tinypng.com/developers",
    localEngines: detectLocalEngines(),
    localInstallHint: localInstallHint()
  };
}

function collectImages(target: string, recursive: boolean): string[] {
  const root = path.resolve(target);
  if (!fs.existsSync(root)) return [];
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    return IMAGE_EXTS.has(path.extname(root).toLowerCase()) ? [root] : [];
  }
  const results: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (recursive) walk(full);
        continue;
      }
      if (IMAGE_EXTS.has(path.extname(entry.name).toLowerCase())) results.push(full);
    }
  };
  walk(root);
  return results;
}

function httpsRequest(
  options: https.RequestOptions,
  body?: Buffer
): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => {
        resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          body: Buffer.concat(chunks)
        });
      });
    });
    req.on("error", reject);
    req.setTimeout(120_000, () => {
      req.destroy(new Error("request_timeout"));
    });
    if (body) req.write(body);
    req.end();
  });
}

function randomIp(): string {
  return Array.from({ length: 4 }, () => Math.floor(Math.random() * 254) + 1).join(".");
}

class TinySession {
  private keyIndex = 0;
  private compressionCount = 0;

  constructor(
    private keys: string[],
    private useWebFallback: boolean
  ) {}

  get available(): boolean {
    return this.keys.length > 0 || this.useWebFallback;
  }

  currentLabel(): string {
    if (!this.keys.length || this.keyIndex >= this.keys.length) return "未激活";
    const key = this.keys[this.keyIndex]!;
    return `...${key.slice(-6)} (${this.compressionCount}/${MONTHLY_LIMIT})`;
  }

  async compress(filePath: string): Promise<{ ok: boolean; skipped?: boolean; engine?: string; error?: string; bytes?: Buffer }> {
    const raw = fs.readFileSync(filePath);
    if (raw.length > TINYPNG_WEB_MAX) {
      return { ok: false, error: `文件超过 Tiny 限制 (${Math.floor(TINYPNG_WEB_MAX / 1024 / 1024)}MB)` };
    }

    if (this.keys.length && raw.length <= TINYPNG_API_MAX) {
      const api = await this.compressApi(raw);
      if (api.ok || api.skipped) return api;
    }

    if (this.useWebFallback && /\.(png|jpe?g)$/i.test(filePath)) {
      return this.compressWeb(raw);
    }

    if (this.keys.length && raw.length > TINYPNG_API_MAX) {
      return { ok: false, error: "大图超出 Tiny API 限制" };
    }
    return { ok: false, error: "Tiny 压缩失败（请配置 API Key 或开启 Web 回退）" };
  }

  private async compressApi(raw: Buffer): Promise<{ ok: boolean; skipped?: boolean; engine?: string; error?: string; bytes?: Buffer }> {
    while (this.keyIndex < this.keys.length) {
      const key = this.keys[this.keyIndex]!;
      const auth = Buffer.from(`api:${key}`).toString("base64");
      try {
        const shrink = await httpsRequest(
          {
            hostname: TINYPNG_API_HOST,
            path: "/shrink",
            method: "POST",
            headers: {
              authorization: `Basic ${auth}`,
              "content-type": "application/octet-stream",
              "content-length": raw.length
            }
          },
          raw
        );
        const countHeader = shrink.headers["compression-count"];
        this.compressionCount = Number(Array.isArray(countHeader) ? countHeader[0] : countHeader) || this.compressionCount;
        if (shrink.status === 401 || shrink.status === 429) {
          this.keyIndex += 1;
          continue;
        }
        if (shrink.status < 200 || shrink.status >= 300) {
          return { ok: false, error: `Tiny API 失败: HTTP ${shrink.status}` };
        }
        const location = shrink.headers.location;
        if (!location || typeof location !== "string") {
          return { ok: false, error: "Tiny API 未返回下载地址" };
        }
        const outputUrl = new URL(location);
        const download = await httpsRequest({
          hostname: outputUrl.hostname,
          path: `${outputUrl.pathname}${outputUrl.search}`,
          method: "GET",
          headers: { authorization: `Basic ${auth}` }
        });
        if (download.status < 200 || download.status >= 300) {
          return { ok: false, error: `Tiny API 下载失败: HTTP ${download.status}` };
        }
        if (this.compressionCount >= MONTHLY_LIMIT) this.keyIndex += 1;
        if (download.body.length >= raw.length) return { ok: false, skipped: true };
        return { ok: true, engine: "Tiny API", bytes: download.body };
      } catch (error) {
        return { ok: false, error: `Tiny API 失败: ${error instanceof Error ? error.message : String(error)}` };
      }
    }
    return { ok: false, error: "无可用 Tiny API key" };
  }

  private async compressWeb(raw: Buffer): Promise<{ ok: boolean; skipped?: boolean; engine?: string; error?: string; bytes?: Buffer }> {
    try {
      const upload = await httpsRequest(
        {
          hostname: TINYPNG_WEB_HOST,
          path: TINYPNG_WEB_PATH,
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "user-agent": "Mozilla/5.0 (compatible; TapMakerWork/1.0)",
            "x-forwarded-for": randomIp(),
            "content-length": raw.length
          }
        },
        raw
      );
      if (upload.status < 200 || upload.status >= 300) {
        return { ok: false, error: `Tiny Web 失败: HTTP ${upload.status}` };
      }
      const payload = JSON.parse(upload.body.toString("utf8")) as {
        error?: string;
        message?: string;
        output?: { url?: string; ratio?: number };
      };
      if (payload.error) return { ok: false, error: payload.message || payload.error };
      if (!payload.output?.url) return { ok: false, error: "Tiny Web 未返回结果" };
      if ((payload.output.ratio ?? 1) > 0.9) return { ok: false, skipped: true };
      const outputUrl = new URL(payload.output.url);
      const download = await httpsRequest({
        hostname: outputUrl.hostname,
        path: `${outputUrl.pathname}${outputUrl.search}`,
        method: "GET"
      });
      if (download.status < 200 || download.status >= 300) {
        return { ok: false, error: `Tiny Web 下载失败: HTTP ${download.status}` };
      }
      if (download.body.length >= raw.length) return { ok: false, skipped: true };
      return { ok: true, engine: "Tiny Web", bytes: download.body };
    } catch (error) {
      return { ok: false, error: `Tiny Web 失败: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
}

export function isTooBroadCompressTarget(target: string): boolean {
  const resolved = path.resolve(target);
  return resolved === path.parse(resolved).root || resolved === path.resolve(os.homedir());
}

export function resolveDefaultCompressTarget(projectRoot: string): string {
  const assets = path.join(projectRoot, "assets");
  if (fs.existsSync(assets) && fs.statSync(assets).isDirectory()) return assets;
  return projectRoot;
}

type CompressAttempt = { ok: boolean; skipped?: boolean; engine?: string; error?: string; bytes?: Buffer };

async function compressOne(filePath: string, tiny: TinySession | null): Promise<CompressAttempt> {
  if (!tiny?.available) return compressLocal(filePath);
  const result = await tiny.compress(filePath);
  if (result.ok || result.skipped) return result;
  const local = await compressLocal(filePath);
  return local.ok || local.skipped ? local : result;
}

export async function runImageCompress(options: {
  target: string;
  projectRoot?: string;
  recursive?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: ImageCompressProgress) => void;
  compress?: (filePath: string) => Promise<CompressAttempt>;
}): Promise<ImageCompressProgress> {
  const settings = readImageCompressSettings();
  const target = path.resolve(options.target);
  const recursive = options.recursive !== false;
  const progress: ImageCompressProgress = {
    ok: false,
    state: "running",
    target,
    total: 0,
    processed: 0,
    compressed: 0,
    skipped: 0,
    failed: 0,
    savedBytes: 0,
    tinyEnabled: settings.tinyEnabled,
    keyCount: settings.tinyKeys.length,
    engine: settings.tinyEnabled ? "TinyPNG 优先，失败回退本地" : `本地压缩（${detectLocalEngines().label}）`,
    files: [],
    aiCopyText: "我将游戏内图片压缩了一遍，你分批次多次的提交上去吧，我怕一次性提交太多太大被拦截了",
    startedAt: new Date().toISOString()
  };
  const emit = () => options.onProgress?.({ ...progress, files: [...progress.files] });
  const finish = (state: ImageCompressJobState, error?: string): ImageCompressProgress => {
    delete progress.current;
    progress.state = state;
    progress.ok = state === "done" && progress.failed === 0;
    progress.finishedAt = new Date().toISOString();
    if (error) progress.error = error;
    emit();
    return progress;
  };

  const targetError = !fs.existsSync(target)
    ? `路径不存在：${target}`
    : isTooBroadCompressTarget(target)
      ? `目录范围过大，请选择具体的图片目录：${target}`
      : undefined;
  if (targetError) return finish("failed", targetError);

  const files = collectImages(target, recursive);
  progress.total = files.length;
  emit();
  const tiny = settings.tinyEnabled ? new TinySession(settings.tinyKeys, settings.useWebFallback) : null;
  const compress = options.compress ?? ((filePath: string) => compressOne(filePath, tiny));

  for (const filePath of files) {
    if (options.signal?.aborted) return finish("cancelled");
    progress.current = filePath;
    emit();
    const startedAt = Date.now();
    const beforeBytes = fs.statSync(filePath).size;
    let result: CompressAttempt;
    try {
      result = await compress(filePath);
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    const timing = { beforeBytes, durationMs: Date.now() - startedAt };

    if (result.ok && result.bytes) {
      writeFileAtomic(filePath, result.bytes, fs.statSync(filePath).mode);
      progress.compressed += 1;
      progress.savedBytes += Math.max(0, beforeBytes - result.bytes.length);
      progress.files.push({ path: filePath, success: true, ...(result.engine ? { engine: result.engine } : {}), ...timing, afterBytes: result.bytes.length });
    } else if (result.skipped) {
      progress.skipped += 1;
      progress.files.push({ path: filePath, success: false, skipped: true, ...(result.engine ? { engine: result.engine } : {}), ...timing, afterBytes: beforeBytes });
    } else {
      progress.failed += 1;
      progress.files.push({ path: filePath, success: false, ...timing, error: result.error || "压缩失败" });
    }
    progress.processed += 1;
    emit();
  }

  return finish("done");
}
