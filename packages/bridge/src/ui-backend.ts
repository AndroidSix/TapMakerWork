import fs from "node:fs";
import path from "node:path";

export type UiBackend = "yoga" | "nanovg";

const YOGA_MARKERS = [
  /\brequire\s*\(\s*["']urhox-libs\/UI["']\s*\)/,
  /\bUI\.Init\s*\(/,
  /\bUI\.GetRoot\s*\(/,
  /\bUI\.(?:Panel|Label|Button|Image|ScrollView|Modal)\s*\{/
];

const NANOVG_MARKERS = [
  /\bnvgBeginFrame\b/,
  /\bnvgEndFrame\b/,
  /\bnvgBeginPath\b/,
  /\bnvgText(?:Box)?\b/,
  /\bnvgRect\b/,
  /\bnvgRoundedRect\b/,
  /\bnvgFill\b/,
  /\bnvgStroke\b/,
  /\bnvgCreate\s*\(/
];

/** Strip TapMakerWork managed bootstrap so prior Yoga installs do not poison NanoVG detection. */
export function stripManagedMarkers(source: string): string {
  const start = source.indexOf("-- >>> TapMakerWork live editor (managed)");
  const end = source.indexOf("-- <<< TapMakerWork live editor (managed)");
  if (start >= 0 && end > start) {
    return `${source.slice(0, start)}${source.slice(end + "-- <<< TapMakerWork live editor (managed)".length)}`;
  }
  return source;
}

function walkLuaFiles(scriptsRoot: string, visit: (relative: string, source: string) => void): void {
  if (!fs.existsSync(scriptsRoot)) return;
  const pending = [scriptsRoot];
  while (pending.length) {
    const directory = pending.pop()!;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "tapmakerwork" || entry.name === "urhox-libs") continue;
        pending.push(filename);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".lua")) continue;
      const fromScripts = path.relative(scriptsRoot, filename).split(path.sep).join("/");
      visit(`scripts/${fromScripts}`, fs.readFileSync(filename, "utf8"));
    }
  }
}

export function scoreUiBackendMarkers(source: string): { yoga: number; nanovg: number } {
  const cleaned = stripManagedMarkers(source);
  let yoga = 0;
  let nanovg = 0;
  for (const pattern of YOGA_MARKERS) {
    if (pattern.test(cleaned)) yoga += 1;
  }
  for (const pattern of NANOVG_MARKERS) {
    if (pattern.test(cleaned)) nanovg += 1;
  }
  return { yoga, nanovg };
}

/**
 * 后端推断要递归读取 scripts/ 下所有 Lua 文件并跑正则，成本随项目规模线性增长。
 * /api/health 每 1.5 秒被轮询一次，若每次都重算会成为常驻 CPU 热点。
 * 用「scripts 目录 mtime 签名」做缓存键：只有增删改文件才会失效。
 */
interface BackendCacheEntry {
  signature: string;
  backend: UiBackend;
}

const backendCache = new Map<string, BackendCacheEntry>();

/** 采样脚本树里最新的 mtime 与文件数；任一 Lua 文件被改动都会改变签名。 */
function scriptsSignature(scriptsRoot: string): string {
  if (!fs.existsSync(scriptsRoot)) return "missing";
  let newest = 0;
  let count = 0;
  const pending = [scriptsRoot];
  while (pending.length) {
    const directory = pending.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "tapmakerwork" || entry.name === "urhox-libs") continue;
        pending.push(filename);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".lua")) continue;
      count += 1;
      try {
        const mtime = fs.statSync(filename).mtimeMs;
        if (mtime > newest) newest = mtime;
      } catch {
        // 文件在遍历期间被删除时忽略，下一轮会重新计算。
      }
    }
  }
  return `${count}:${newest}`;
}

/** Prefer NanoVG when the project draws with nvg* and does not host a Yoga UI tree. */
export function detectUiBackend(projectRoot: string): UiBackend {
  const scriptsRoot = path.join(projectRoot, "scripts");
  const signature = scriptsSignature(scriptsRoot);
  const cached = backendCache.get(projectRoot);
  if (cached && cached.signature === signature) return cached.backend;

  let yoga = 0;
  let nanovg = 0;
  walkLuaFiles(scriptsRoot, (_relative, source) => {
    const score = scoreUiBackendMarkers(source);
    yoga += score.yoga;
    nanovg += score.nanovg;
  });
  const backend: UiBackend = nanovg > 0 && yoga === 0
    ? "nanovg"
    : nanovg > 0 && yoga > 0 && nanovg >= yoga * 2
      ? "nanovg"
      : "yoga";
  // 缓存按项目根分键；正常只会有一两个打开的项目。
  if (backendCache.size >= 8 && !backendCache.has(projectRoot)) {
    const oldest = backendCache.keys().next();
    if (!oldest.done) backendCache.delete(oldest.value);
  }
  backendCache.set(projectRoot, { signature, backend });
  return backend;
}

export function adapterModuleName(backend: UiBackend): string {
  return backend === "nanovg" ? "TapMakerWorkNanoVGBridge" : "TapMakerWorkBridge";
}

export function adapterTemplateFile(backend: UiBackend): string {
  return `${adapterModuleName(backend)}.lua`;
}
