function parseUrl(value: unknown): URL | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    return new URL(value.trim());
  } catch {
    return undefined;
  }
}

export function isHttpsUrl(value: unknown): value is string {
  return parseUrl(value)?.protocol === "https:";
}

export function isWebUrl(value: unknown): value is string {
  const protocol = parseUrl(value)?.protocol;
  return protocol === "https:" || protocol === "http:";
}

/** 外部浏览器只打开 https，其余协议（file:、自定义 scheme 等）一律回退到 fallback。 */
export function safeExternalUrl(value: unknown, fallback: string): string {
  return isHttpsUrl(value) ? value : fallback;
}

export function bridgeExitMessage(code: number | null, stderrTail: string): string {
  const detail = stderrTail.trim().split(/\r?\n/).slice(-3).join("\n");
  const reason = code === 98
    ? "本地端口 43121 已被占用：可能已有一个 TapMakerWork 在运行，请先完全退出后再打开。"
    : `Bridge 进程意外退出（退出码 ${code ?? "未知"}）。`;
  return detail ? `${reason}\n\n${detail}` : reason;
}
