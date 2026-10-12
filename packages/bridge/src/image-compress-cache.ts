import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFileAtomic } from "./project.js";

const MAX_CACHE_ENTRIES = 50_000;

export interface CompressCache {
  has(hash: string): boolean;
  remember(hash: string): void;
  save(): void;
}

export function hashBytes(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hashFile(filePath: string): string {
  return hashBytes(fs.readFileSync(filePath));
}

export function defaultCompressCachePath(): string {
  return path.join(os.homedir(), ".tapmakerwork", "image-compress-cache.json");
}

function readHashes(cachePath: string): Map<string, string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8")) as { hashes?: Record<string, string> };
    return new Map(Object.entries(parsed.hashes ?? {}));
  } catch {
    return new Map();
  }
}

export function openCompressCache(cachePath = defaultCompressCachePath()): CompressCache {
  const hashes = readHashes(cachePath);
  let dirty = false;
  return {
    has: (hash) => hashes.has(hash),
    remember(hash) {
      hashes.delete(hash);
      hashes.set(hash, new Date().toISOString());
      dirty = true;
    },
    save() {
      if (!dirty) return;
      const newest = [...hashes].slice(-MAX_CACHE_ENTRIES);
      writeFileAtomic(cachePath, `${JSON.stringify({ version: 1, hashes: Object.fromEntries(newest) })}\n`);
      dirty = false;
    }
  };
}

export function memoryCompressCache(): CompressCache {
  const hashes = new Set<string>();
  return { has: (hash) => hashes.has(hash), remember: (hash) => void hashes.add(hash), save: () => undefined };
}
