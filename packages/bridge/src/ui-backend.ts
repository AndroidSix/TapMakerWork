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

/** Prefer NanoVG when the project draws with nvg* and does not host a Yoga UI tree. */
export function detectUiBackend(projectRoot: string): UiBackend {
  const scriptsRoot = path.join(projectRoot, "scripts");
  let yoga = 0;
  let nanovg = 0;
  walkLuaFiles(scriptsRoot, (_relative, source) => {
    const score = scoreUiBackendMarkers(source);
    yoga += score.yoga;
    nanovg += score.nanovg;
  });
  if (nanovg > 0 && yoga === 0) return "nanovg";
  if (nanovg > 0 && yoga > 0 && nanovg >= yoga * 2) return "nanovg";
  return "yoga";
}

export function adapterModuleName(backend: UiBackend): string {
  return backend === "nanovg" ? "TapMakerWorkNanoVGBridge" : "TapMakerWorkBridge";
}

export function adapterTemplateFile(backend: UiBackend): string {
  return `${adapterModuleName(backend)}.lua`;
}
