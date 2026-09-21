export interface RuntimeErrorReport {
  fingerprint: string;
  errorText: string;
  clipboardText: string;
}

function cleanLine(line: string): string {
  return line.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "").trimEnd();
}

function isErrorLine(line: string): boolean {
  if (/\b(?:0|no)\s+errors?\b/i.test(line)) return false;
  return /(\[error\]|\berror\s*:|\bfatal\b|uncaught|unhandled|stack traceback|runtime error|lua error|assertion failed|syntax error|attempt to (?:index|call|perform|concatenate|compare)|module ['"].+['"] not found)/i.test(line);
}

function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function extractRuntimeErrorReport(lines: string[]): RuntimeErrorReport | undefined {
  const cleaned = lines.map(cleanLine).filter(Boolean);
  let marker = -1;
  for (let index = cleaned.length - 1; index >= 0; index -= 1) {
    if (isErrorLine(cleaned[index]!)) {
      marker = index;
      break;
    }
  }
  if (marker < 0) return undefined;
  const start = Math.max(0, marker - 1);
  const end = Math.min(cleaned.length, marker + 18);
  const errorText = cleaned.slice(start, end).join("\n").slice(0, 12_000);
  return {
    fingerprint: fingerprint(errorText),
    errorText,
    clipboardText: [
      "请修复游戏中的以下错误。请定位根因并修改代码，完成后验证游戏不再报错。",
      "",
      "TapTap Maker - Error Report",
      errorText
    ].join("\n")
  };
}
