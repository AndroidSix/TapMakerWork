export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatUptime(startedAt: string | undefined, now: number): string {
  const started = startedAt ? Date.parse(startedAt) : Number.NaN;
  if (!Number.isFinite(started)) return "启动时间未知";
  const minutes = Math.max(0, Math.floor((now - started) / 60_000));
  if (minutes < 1) return "刚刚启动";
  if (minutes < 60) return `已运行 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `已运行 ${hours} 小时 ${minutes % 60} 分` : `已运行 ${Math.floor(hours / 24)} 天`;
}
