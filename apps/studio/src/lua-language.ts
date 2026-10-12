import type { LuaSymbol } from "@tapmakerwork/protocol";

export interface LuaCompletion {
  label: string;
  kind: "function" | "field" | "namespace";
  detail: string;
  documentation?: string;
}

const DOTTED_TAIL = /[A-Za-z_][\w]*(?:[.:][A-Za-z_]\w*)*[.:]?$/;
const DOTTED_HEAD = /^\w*/;

/** Dotted expression ending at the cursor, e.g. `UI.Pa` or `UI.` (column is 1-based like Monaco). */
export function dottedWordBefore(lineText: string, column: number): string {
  return DOTTED_TAIL.exec(lineText.slice(0, column - 1))?.[0] ?? "";
}

/** Full dotted expression under the cursor, e.g. hovering `Panel` in `UI.Panel {` yields `UI.Panel`. */
export function dottedWordAt(lineText: string, column: number): string {
  const before = dottedWordBefore(lineText, column);
  const after = DOTTED_HEAD.exec(lineText.slice(column - 1))?.[0] ?? "";
  return (before + after).replace(/[.:]$/, "");
}

function splitQualifier(typed: string): { qualifier: string; separator: string } {
  const index = Math.max(typed.lastIndexOf("."), typed.lastIndexOf(":"));
  return index < 0 ? { qualifier: "", separator: "" } : { qualifier: typed.slice(0, index), separator: typed[index]! };
}

function documentation(symbol: LuaSymbol): string {
  const markdownDoc = symbol.doc?.split("\n").join("  \n");
  return [markdownDoc, `${symbol.file}:${symbol.line}`].filter(Boolean).join("\n\n");
}

/** Next name segment for every symbol under the typed qualifier; Monaco filters by the partial word itself. */
export function luaCompletions(symbols: LuaSymbol[], typed: string): LuaCompletion[] {
  const { qualifier, separator } = splitQualifier(typed);
  const prefix = qualifier ? `${qualifier}${separator}` : "";
  const byLabel = new Map<string, LuaCompletion>();
  for (const symbol of symbols) {
    if (!symbol.name.startsWith(prefix)) continue;
    const rest = symbol.name.slice(prefix.length);
    const label = /^\w+/.exec(rest)?.[0];
    if (!label) continue;
    if (rest === label) {
      byLabel.set(label, { label, kind: symbol.kind, detail: symbol.signature, documentation: documentation(symbol) });
    } else if (!byLabel.has(label)) {
      byLabel.set(label, { label, kind: "namespace", detail: `${prefix}${label}` });
    }
  }
  return [...byLabel.values()];
}

export function findLuaSymbol(symbols: LuaSymbol[], dotted: string): LuaSymbol | undefined {
  if (!dotted) return undefined;
  const colonVariant = dotted.replace(/\.(\w+)$/, ":$1");
  return symbols.find((symbol) => symbol.name === dotted) ?? symbols.find((symbol) => symbol.name === colonVariant);
}

export function luaHoverMarkdown(symbol: LuaSymbol): string[] {
  return [`\`\`\`lua\n${symbol.signature}\n\`\`\``, documentation(symbol)];
}
