import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { Jimp } from "jimp";

const execFileAsync = promisify(execFile);

export interface LocalEngineStatus {
  pngquant: boolean;
  jpegoptim: boolean;
  cwebp: boolean;
  jimp: boolean;
  label: string;
}

function whichSync(command: string): string | undefined {
  const pathEnv = process.env.PATH || "";
  const parts = pathEnv.split(path.delimiter);
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of parts) {
    for (const ext of extensions) {
      const candidate = path.join(dir, `${command}${ext}`);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // continue
      }
    }
  }
  return undefined;
}

let cachedStatus: LocalEngineStatus | undefined;

export function detectLocalEngines(): LocalEngineStatus {
  if (cachedStatus) return cachedStatus;
  const pngquant = Boolean(whichSync("pngquant"));
  const jpegoptim = Boolean(whichSync("jpegoptim"));
  const cwebp = Boolean(whichSync("cwebp"));
  const parts = [
    pngquant ? "pngquant" : "",
    jpegoptim ? "jpegoptim" : "",
    cwebp ? "cwebp" : "",
    "内置 Jimp"
  ].filter(Boolean);
  cachedStatus = {
    pngquant,
    jpegoptim,
    cwebp,
    jimp: true,
    label: parts.join(" · ")
  };
  return cachedStatus;
}

function tempSibling(filePath: string, suffix: string): string {
  return path.join(path.dirname(filePath), `.tapmakerwork-compress-${process.pid}-${Date.now()}${suffix}`);
}

async function replaceIfSmaller(source: string, candidate: string, engine: string): Promise<{
  ok: boolean;
  skipped?: boolean;
  engine?: string;
  error?: string;
  bytes?: Buffer;
}> {
  try {
    const before = fs.statSync(source).size;
    const after = fs.statSync(candidate).size;
    if (after <= 0 || after >= before) {
      fs.rmSync(candidate, { force: true });
      return { ok: false, skipped: true };
    }
    const bytes = fs.readFileSync(candidate);
    fs.rmSync(candidate, { force: true });
    return { ok: true, engine, bytes };
  } catch (error) {
    fs.rmSync(candidate, { force: true });
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function compressWithPngquant(filePath: string): Promise<{
  ok: boolean;
  skipped?: boolean;
  engine?: string;
  error?: string;
  bytes?: Buffer;
}> {
  const bin = whichSync("pngquant");
  if (!bin) return { ok: false, error: "pngquant_unavailable" };
  const out = tempSibling(filePath, ".png");
  try {
    await execFileAsync(bin, ["--quality=65-80", "--skip-if-larger", "--force", "--output", out, filePath], {
      timeout: 60_000,
      windowsHide: true
    });
    return replaceIfSmaller(filePath, out, "pngquant");
  } catch (error) {
    fs.rmSync(out, { force: true });
    const message = error instanceof Error ? error.message : String(error);
    if (/quality|not worth|skip/i.test(message)) return { ok: false, skipped: true };
    return { ok: false, error: `pngquant 失败: ${message}` };
  }
}

async function compressWithJpegoptim(filePath: string): Promise<{
  ok: boolean;
  skipped?: boolean;
  engine?: string;
  error?: string;
  bytes?: Buffer;
}> {
  const bin = whichSync("jpegoptim");
  if (!bin) return { ok: false, error: "jpegoptim_unavailable" };
  const out = tempSibling(filePath, path.extname(filePath) || ".jpg");
  try {
    fs.copyFileSync(filePath, out);
    await execFileAsync(bin, ["--max=72", "--strip-all", "--quiet", out], {
      timeout: 60_000,
      windowsHide: true
    });
    return replaceIfSmaller(filePath, out, "jpegoptim");
  } catch (error) {
    fs.rmSync(out, { force: true });
    return { ok: false, error: `jpegoptim 失败: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function compressWithCwebp(filePath: string): Promise<{
  ok: boolean;
  skipped?: boolean;
  engine?: string;
  error?: string;
  bytes?: Buffer;
}> {
  const bin = whichSync("cwebp");
  if (!bin) return { ok: false, error: "cwebp_unavailable" };
  const out = tempSibling(filePath, ".webp");
  try {
    await execFileAsync(bin, ["-q", "80", filePath, "-o", out], {
      timeout: 60_000,
      windowsHide: true
    });
    return replaceIfSmaller(filePath, out, "cwebp");
  } catch (error) {
    fs.rmSync(out, { force: true });
    return { ok: false, error: `cwebp 失败: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function compressWithJimp(filePath: string): Promise<{
  ok: boolean;
  skipped?: boolean;
  engine?: string;
  error?: string;
  bytes?: Buffer;
}> {
  const ext = path.extname(filePath).toLowerCase();
  try {
    const image = await Jimp.read(filePath);
    if (ext === ".jpg" || ext === ".jpeg") {
      const bytes = Buffer.from(await image.getBuffer("image/jpeg", { quality: 72 }));
      const before = fs.statSync(filePath).size;
      if (bytes.length <= 0 || bytes.length >= before) return { ok: false, skipped: true };
      return { ok: true, engine: "Jimp", bytes };
    }
    if (ext === ".png") {
      const bytes = Buffer.from(await image.getBuffer("image/png"));
      const before = fs.statSync(filePath).size;
      if (bytes.length <= 0 || bytes.length >= before) return { ok: false, skipped: true };
      return { ok: true, engine: "Jimp", bytes };
    }
    if (ext === ".webp") {
      return { ok: false, error: "未安装 cwebp，无法本地压缩 WebP（可 brew install webp）" };
    }
    return { ok: false, error: `不支持的格式: ${ext}` };
  } catch (error) {
    return { ok: false, error: `本地压缩失败: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function compressLocal(filePath: string): Promise<{
  ok: boolean;
  skipped?: boolean;
  engine?: string;
  error?: string;
  bytes?: Buffer;
}> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") {
    const pngquant = await compressWithPngquant(filePath);
    if (pngquant.ok || pngquant.skipped) return pngquant;
    return compressWithJimp(filePath);
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    const jpegoptim = await compressWithJpegoptim(filePath);
    if (jpegoptim.ok || jpegoptim.skipped) return jpegoptim;
    return compressWithJimp(filePath);
  }
  if (ext === ".webp") {
    const webp = await compressWithCwebp(filePath);
    if (webp.ok || webp.skipped) return webp;
    return compressWithJimp(filePath);
  }
  return { ok: false, error: `不支持的格式: ${ext}` };
}

export function localInstallHint(): string {
  if (process.platform === "darwin") {
    return "可选安装更强本地引擎：brew install pngquant jpegoptim webp（未安装时自动用内置 Jimp）";
  }
  if (process.platform === "win32") {
    return "可选安装 pngquant / jpegoptim 以获得更好的本地压缩；未安装时使用内置 Jimp。";
  }
  return "可选安装 pngquant jpegoptim webp；未安装时使用内置 Jimp。";
}
