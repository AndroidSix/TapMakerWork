import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

type CacheScan = (directory: string) => string[];

function loadNativeIndex(): CacheScan | undefined {
  if (process.platform !== "darwin" && process.platform !== "linux") return undefined;
  const load = createRequire(import.meta.url);
  const artifact = `runtime-index-${process.platform}-${process.arch}.node`;
  for (const folder of ["./native/", "../dist-app/native/"]) {
    try {
      const { makerCacheEntries } = load(fileURLToPath(new URL(folder + artifact, import.meta.url))) as { makerCacheEntries?: CacheScan };
      if (typeof makerCacheEntries === "function") return makerCacheEntries;
    } catch {
      continue;
    }
  }
  return undefined;
}

export const nativeMakerCacheNames = loadNativeIndex();

export function listMakerCacheNames(directory: string): string[] {
  const readWithNode = () => fs.readdirSync(directory).filter((name) => name.startsWith("maker-cache"));
  if (!nativeMakerCacheNames) return readWithNode();
  try {
    return nativeMakerCacheNames(directory);
  } catch {
    return readWithNode();
  }
}
