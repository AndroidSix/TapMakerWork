import fs from "node:fs";
import path from "node:path";
import luaparse, { type Chunk, type Comment, type Expression, type FunctionDeclaration, type Statement } from "luaparse";
import type { LuaDiagnostic, LuaSymbol } from "@tapmakerwork/protocol";
import { listLuaFilesUnder } from "./lua-prop-writeback.js";


const SYMBOL_DIRS = ["scripts", "urhox-libs"];
const MAX_FILE_BYTES = 1_000_000;
const MAX_SYMBOLS = 20_000;
const FIELD_PREVIEW_CHARS = 60;

/** luaparse only speaks Lua 5.3; blank out 5.4 `<const>` / `<close>` attributes (same length) so positions stay exact. */
function maskLua54Attributes(source: string): string {
  return source.replace(/<(const|close)>/g, (match) => " ".repeat(match.length));
}

export function diagnoseLuaSource(source: string): LuaDiagnostic[] {
  try {
    luaparse.parse(maskLua54Attributes(source), { luaVersion: "5.3", encodingMode: "none" });
    return [];
  } catch (error) {
    const parseError = error as { message?: string; line?: number; column?: number };
    if (typeof parseError.line !== "number") return [];
    return [{
      line: parseError.line,
      column: (parseError.column ?? 0) + 1,
      message: String(parseError.message || "syntax error").replace(/^\[\d+:\d+\]\s*/, "")
    }];
  }
}

function dottedName(expression: Expression): string | undefined {
  if (expression.type === "Identifier") return expression.name;
  if (expression.type === "MemberExpression") {
    const base = dottedName(expression.base);
    return base ? `${base}${expression.indexer}${expression.identifier.name}` : undefined;
  }
  return undefined;
}

function parameterList(fn: FunctionDeclaration): string {
  return fn.parameters.map((parameter) => parameter.type === "Identifier" ? parameter.name : "...").join(", ");
}

function docAbove(commentsByLine: Map<number, string>, line: number): string | undefined {
  const lines: string[] = [];
  for (let current = line - 1; commentsByLine.has(current); current -= 1) lines.unshift(commentsByLine.get(current)!);
  return lines.length ? lines.join("\n") : undefined;
}

export function extractLuaSymbols(source: string, file: string): LuaSymbol[] {
  let ast: Chunk;
  try {
    ast = luaparse.parse(maskLua54Attributes(source), { luaVersion: "5.3", encodingMode: "none", comments: true, locations: true, ranges: true });
  } catch {
    return [];
  }
  const commentsByLine = new Map<number, string>();
  for (const comment of (ast.comments ?? []) as Comment[]) {
    if (comment.loc && !comment.raw.startsWith("--[[")) commentsByLine.set(comment.loc.start.line, comment.value.replace(/^-+\s?/, "").trimEnd());
  }
  const symbols: LuaSymbol[] = [];
  const add = (name: string, kind: LuaSymbol["kind"], signature: string, statement: Statement) => {
    const line = statement.loc?.start.line ?? 1;
    const doc = docAbove(commentsByLine, line);
    symbols.push({ name, kind, signature, file, line, ...(doc ? { doc } : {}) });
  };
  for (const statement of ast.body) {
    if (statement.type === "FunctionDeclaration" && statement.identifier && !statement.isLocal) {
      const name = dottedName(statement.identifier);
      if (name) add(name, "function", `${name}(${parameterList(statement)})`, statement);
    } else if (statement.type === "AssignmentStatement") {
      statement.variables.forEach((variable, index) => {
        const name = dottedName(variable as Expression);
        const value = statement.init[index];
        if (!name || !value) return;
        if (value.type === "FunctionDeclaration") {
          add(name, "function", `${name}(${parameterList(value)})`, statement);
        } else if (variable.type === "MemberExpression") {
          const range = (value as { range?: [number, number] }).range;
          const raw = range ? source.slice(range[0], range[1]).replace(/\s+/g, " ") : "";
          add(name, "field", `${name} = ${raw.length > FIELD_PREVIEW_CHARS ? `${raw.slice(0, FIELD_PREVIEW_CHARS)}…` : raw}`, statement);
        }
      });
    }
  }
  return symbols;
}

const symbolCache = new Map<string, { signature: string; symbols: LuaSymbol[] }>();

function listSymbolFiles(projectRoot: string): string[] {
  return SYMBOL_DIRS.flatMap((dir) => listLuaFilesUnder(projectRoot, dir));
}

export function indexProjectLuaSymbols(projectRoot: string): LuaSymbol[] {
  const files = listSymbolFiles(projectRoot).map((relative) => {
    try {
      const stat = fs.statSync(path.join(projectRoot, relative));
      return { relative, stat };
    } catch {
      return undefined;
    }
  }).filter((entry): entry is { relative: string; stat: fs.Stats } => Boolean(entry && entry.stat.size <= MAX_FILE_BYTES));
  const signature = files.map(({ relative, stat }) => `${relative}:${stat.mtimeMs}:${stat.size}`).join("|");
  const cached = symbolCache.get(projectRoot);
  if (cached?.signature === signature) return cached.symbols;
  const symbols: LuaSymbol[] = [];
  for (const { relative } of files) {
    if (symbols.length >= MAX_SYMBOLS) break;
    symbols.push(...extractLuaSymbols(fs.readFileSync(path.join(projectRoot, relative), "utf8"), relative));
  }
  const capped = symbols.slice(0, MAX_SYMBOLS);
  symbolCache.set(projectRoot, { signature, symbols: capped });
  return capped;
}
