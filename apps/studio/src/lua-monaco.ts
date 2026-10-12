import type * as Monaco from "monaco-editor/editor/editor.api";
import type { LuaDiagnostic, LuaSymbol } from "@tapmakerwork/protocol";
import { API } from "./bridge-api";
import { dottedWordAt, dottedWordBefore, findLuaSymbol, luaCompletions, luaHoverMarkdown, type LuaCompletion } from "./lua-language";

const MARKER_OWNER = "tapmakerwork-lua";
const DIAGNOSE_DELAY_MS = 400;
const SYMBOLS_TTL_MS = 15_000;

let symbolCache: { loadedAt: number; symbols: Promise<LuaSymbol[]> } | undefined;

function projectSymbols(): Promise<LuaSymbol[]> {
  if (!symbolCache || Date.now() - symbolCache.loadedAt > SYMBOLS_TTL_MS) {
    symbolCache = {
      loadedAt: Date.now(),
      symbols: fetch(`${API}/api/lua/symbols`)
        .then((response) => response.ok ? response.json() as Promise<{ symbols: LuaSymbol[] }> : { symbols: [] })
        .then((payload) => payload.symbols)
        .catch(() => [])
    };
  }
  return symbolCache.symbols;
}

async function diagnose(source: string): Promise<LuaDiagnostic[]> {
  try {
    const response = await fetch(`${API}/api/lua/diagnostics`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source })
    });
    return response.ok ? ((await response.json()) as { diagnostics: LuaDiagnostic[] }).diagnostics : [];
  } catch {
    return [];
  }
}

function watchDiagnostics(monaco: typeof Monaco, model: Monaco.editor.ITextModel): void {
  let timer: number | undefined;
  const run = async () => {
    if (model.isDisposed()) return;
    if (model.getLanguageId() !== "lua") {
      monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
      return;
    }
    const version = model.getVersionId();
    const diagnostics = await diagnose(model.getValue());
    if (model.isDisposed() || model.getVersionId() !== version) return;
    monaco.editor.setModelMarkers(model, MARKER_OWNER, diagnostics.map((diagnostic) => ({
      severity: monaco.MarkerSeverity.Error,
      message: `Lua 语法错误：${diagnostic.message}`,
      startLineNumber: diagnostic.line,
      startColumn: diagnostic.column,
      endLineNumber: diagnostic.line,
      endColumn: model.getLineMaxColumn(Math.min(diagnostic.line, model.getLineCount()))
    })));
  };
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(), DIAGNOSE_DELAY_MS);
  };
  schedule();
  model.onDidChangeContent(schedule);
  model.onDidChangeLanguage(schedule);
  model.onWillDispose(() => window.clearTimeout(timer));
}

export function registerLuaLanguageFeatures(monaco: typeof Monaco): void {
  monaco.editor.getModels().forEach((model) => watchDiagnostics(monaco, model));
  monaco.editor.onDidCreateModel((model) => watchDiagnostics(monaco, model));

  const kinds = monaco.languages.CompletionItemKind;
  const kindFor: Record<LuaCompletion["kind"], Monaco.languages.CompletionItemKind> = { function: kinds.Function, field: kinds.Field, namespace: kinds.Module };

  monaco.languages.registerCompletionItemProvider("lua", {
    triggerCharacters: [".", ":"],
    async provideCompletionItems(model, position) {
      const typed = dottedWordBefore(model.getLineContent(position.lineNumber), position.column);
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const suggestions = luaCompletions(await projectSymbols(), typed).map((item) => ({
        label: item.label,
        kind: kindFor[item.kind],
        detail: item.detail,
        ...(item.documentation ? { documentation: { value: item.documentation } } : {}),
        insertText: item.label,
        range
      }));
      return { suggestions };
    }
  });

  monaco.languages.registerHoverProvider("lua", {
    async provideHover(model, position) {
      const dotted = dottedWordAt(model.getLineContent(position.lineNumber), position.column);
      const symbol = findLuaSymbol(await projectSymbols(), dotted);
      if (!symbol) return null;
      return { contents: luaHoverMarkdown(symbol).filter(Boolean).map((value) => ({ value })) };
    }
  });
}
