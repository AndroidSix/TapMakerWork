import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adoptWindowsMimeForFile,
  assetMimeType,
  resolveProjectAsset,
  sendProjectAsset
} from "./asset-handler.js";

const temporary: string[] = [];

function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-asset-"));
  temporary.push(root);
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  return root;
}

function writePng(root: string, relative: string): string {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  // 8-byte PNG signature: 够 bridge 拼 content-type，但不发完整内容用于响应流测试
  fs.writeFileSync(full, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return full;
}

afterEach(() => {
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("assetMimeType", () => {
  it("returns mime for supported extensions (case-insensitive)", () => {
    expect(assetMimeType(".png")).toBe("image/png");
    expect(assetMimeType(".PNG")).toBe("image/png");
    expect(assetMimeType(".jpg")).toBe("image/jpeg");
    expect(assetMimeType(".svg")).toBe("image/svg+xml");
  });

  it("returns undefined for unsupported extensions", () => {
    expect(assetMimeType(".exe")).toBeUndefined();
    expect(assetMimeType("")).toBeUndefined();
  });
});

describe("adoptWindowsMimeForFile", () => {
  it("returns undefined outside Windows regardless of path shape", () => {
    if (process.platform === "win32") return; // 环境本身是 Windows，下面的 case 会盖掉
    const root = makeProject();
    const target = writePng(root, "seed.png");
    expect(adoptWindowsMimeForFile(root, target)).toBeUndefined();
    expect(adoptWindowsMimeForFile(root, "@image:" + target)).toBeUndefined();
  });

  it("strips @image: prefix and validates file existence on Windows", () => {
    if (process.platform !== "win32") return;
    const root = makeProject();
    const source = writePng(root, path.join("seed", "external.png"));
    // 走盘符风格路径：vitest 在 Windows 上 process.cwd() 通常是仓库根
    const drivePath = source.replace(/\\/g, "\\\\");
    const adopted = adoptWindowsMimeForFile(root, "@image:" + drivePath);
    expect(adopted).toBeTruthy();
    expect(path.basename(adopted!)).toBe("external.png");
    expect(fs.existsSync(adopted!)).toBe(true);
  });

  it("throws when Windows absolute path does not exist", () => {
    if (process.platform !== "win32") return;
    const root = makeProject();
    expect(() => adoptWindowsMimeForFile(root, "C:\\nonexistent\\missing.png"))
      .toThrowError(/project_asset_not_found/);
  });
});

describe("resolveProjectAsset", () => {
  it("returns project-relative path when assets/foo.png exists", () => {
    const root = makeProject();
    const created = writePng(root, path.join("assets", "hero.png"));
    const resolved = resolveProjectAsset(root, "hero.png");
    expect(path.resolve(resolved)).toBe(path.resolve(created));
  });

  it("falls back to project root when asset is not under assets/", () => {
    const root = makeProject();
    const created = writePng(root, "logo.png");
    expect(path.resolve(resolveProjectAsset(root, "logo.png"))).toBe(path.resolve(created));
  });

  it("delegates to adoptWindowsMimeForFile when the path is Windows absolute", () => {
    if (process.platform !== "win32") return;
    const root = makeProject();
    const source = writePng(root, path.join("seed", "external.png"));
    const drivePath = source.replace(/\\/g, "\\\\");
    const resolved = resolveProjectAsset(root, "@image:" + drivePath);
    expect(resolved).toBeTruthy();
    expect(path.basename(resolved)).toBe("external.png");
    expect(path.dirname(resolved)).toBe(path.join(root, "assets", "_external"));
  });
});

describe("sendProjectAsset", () => {
  function mockResponse(): ServerResponse & { headers: Record<string, unknown> } {
    const captured: { value: Record<string, unknown> } = { value: {} };
    const stream = new PassThrough() as unknown as ServerResponse & { headers: Record<string, unknown> };
    (stream as unknown as { writeHead: (status: number, h: Record<string, unknown>) => typeof stream }).writeHead = (status, h) => {
      captured.value = { ...captured.value, status, ...h };
      return stream;
    };
    Object.defineProperty(stream, "headers", { get: () => captured.value });
    return stream;
  }

  // 把 fs.createReadStream 替换成 no-op，避免 afterEach 把目录删掉之后还在异步 open。
  let createReadStreamSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    createReadStreamSpy = vi.spyOn(fs, "createReadStream").mockReturnValue(new PassThrough() as unknown as fs.ReadStream);
  });
  afterEach(() => {
    createReadStreamSpy.mockRestore();
  });

  it("writes content-type and adopted-path header for adopted Windows files", () => {
    const root = makeProject();
    const adopted = path.join(root, "assets", "_external", "sample.png");
    fs.mkdirSync(path.dirname(adopted), { recursive: true });
    fs.writeFileSync(adopted, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const response = mockResponse();
    sendProjectAsset(response, adopted, root);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["x-adopted-path"]).toBe("assets/_external/sample.png");
    expect(response.headers["status"]).toBe(200);
  });

  it("omits x-adopted-path when the file lives outside the project", () => {
    const root = makeProject();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-outside-"));
    temporary.push(outside);
    const png = path.join(outside, "stranger.png");
    fs.writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const response = mockResponse();
    sendProjectAsset(response, png, root);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["x-adopted-path"]).toBeUndefined();
    expect(response.headers["status"]).toBe(200);
  });

  it("normalizes backslashes to forward slashes in x-adopted-path on Windows", () => {
    if (process.platform !== "win32") return;
    const root = makeProject();
    const nested = path.join(root, "assets", "_external", "deep", "nested.png");
    fs.mkdirSync(path.dirname(nested), { recursive: true });
    fs.writeFileSync(nested, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const response = mockResponse();
    sendProjectAsset(response, nested, root);
    expect(response.headers["x-adopted-path"]).toBe("assets/_external/deep/nested.png");
    expect(response.headers["x-adopted-path"]).not.toMatch(/\\/);
  });

  it("throws unsupported_asset_type for non-image mime", () => {
    const root = makeProject();
    const file = path.join(root, "payload.exe");
    fs.writeFileSync(file, "MZ");
    const response = mockResponse();
    expect(() => sendProjectAsset(response, file, root)).toThrowError(/unsupported_asset_type/);
  });

  it("throws asset_not_found when target disappeared", () => {
    const root = makeProject();
    const ghost = path.join(root, "ghost.png");
    const response = mockResponse();
    expect(() => sendProjectAsset(response, ghost, root)).toThrowError(/asset_not_found/);
  });

  it("never lets header construction errors break the response status", () => {
    const root = makeProject();
    const target = writePng(root, path.join("assets", "_external", "ok.png"));
    // 故意构造一个不寻常的 projectRoot 让 path.relative 出错 — 用 spyOn 拦截
    const spy = vi.spyOn(path, "relative").mockImplementationOnce(() => {
      throw new Error("mock");
    });
    try {
      const response = mockResponse();
      expect(() => sendProjectAsset(response, target, root)).not.toThrow();
      expect(response.headers["status"]).toBe(200);
      expect(response.headers["x-adopted-path"]).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});