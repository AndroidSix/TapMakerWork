export const API = "http://127.0.0.1:43121";

export const MAX_LOG_LINES_PER_CHANNEL = 1_000;

export function isWebUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const protocol = new URL(url).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

export function isEmbeddablePreviewUrl(url: string | undefined): url is string {
  if (!isWebUrl(url)) return false;
  if (/\.(png|jpe?g|gif|webp|svg|bmp)(\?|#|$)/i.test(url)) return false;
  if (/\/qrco|qrcode|qr-code|test_qrcode|\/qr\//i.test(url)) return false;
  return true;
}

/** 每个日志频道只保留最近的若干行，避免长时间运行后日志数组无限增长拖慢界面。 */
export function capLogChannels<T extends Record<string, string[]>>(logs: T, limit = MAX_LOG_LINES_PER_CHANNEL): T {
  let changed = false;
  const next = { ...logs };
  for (const key of Object.keys(next) as Array<keyof T>) {
    const lines = next[key];
    if (Array.isArray(lines) && lines.length > limit) {
      next[key] = lines.slice(-limit) as T[keyof T];
      changed = true;
    }
  }
  return changed ? next : logs;
}

export async function readJsonResponse<T>(response: Response, fallbackError: string): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `${fallbackError}（HTTP ${response.status}）`);
  return body;
}
