import luaparse, {
  type Expression,
  type Statement,
  type TableConstructorExpression,
  type TableKeyString
} from "luaparse";
import fs from "node:fs";
import path from "node:path";
import type { UiNode, UiValue } from "@tapmakerwork/protocol";
import { readProjectSource, writeProjectText } from "./project.js";
import type { UiSidecarOverride } from "./ui-sidecar.js";

export type LuaWritebackOverride = UiSidecarOverride & {
  previousProps?: Record<string, UiValue>;
};

type Located = {
  loc?: { start: { line: number; column: number }; end: { line: number; column: number } } | undefined;
  range?: [number, number] | undefined;
};

export interface LuaPropWritebackSkip {
  key: string;
  reason: string;
}

export interface LuaPropWritebackResult {
  applied: string[];
  skipped: LuaPropWritebackSkip[];
  text: string;
  changed: boolean;
}

export interface LuaPropWritebackOptions {
  /** User-edited concrete values may replace style/theme expressions in Lua. */
  replaceExpressions?: boolean;
  /** Insert missing writable fields before the widget table's closing brace. */
  insertMissingFields?: boolean;
}

export interface LuaOverridesWritebackSummary {
  overrides: UiSidecarOverride[];
  filesTouched: string[];
  appliedCount: number;
  skippedCount: number;
  details: Array<{ sourceFile: string; line: number; type: string; applied: string[]; skipped: LuaPropWritebackSkip[] }>;
}

const WRITABLE_KEYS = new Set([
  "text", "title", "visible", "width", "height", "left", "top", "right", "bottom",
  "fontSize", "fontColor", "textColor", "backgroundColor", "borderColor",
  "borderRadius", "borderWidth", "opacity", "zIndex", "position",
  "flexGrow", "flexShrink", "flexDirection", "justifyContent", "alignItems",
  "alignSelf", "gap", "padding", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight",
  "margin", "marginTop", "marginBottom", "marginLeft", "marginRight",
  "minWidth", "minHeight", "maxWidth", "maxHeight", "overflow", "display",
  // UiStyle kit call-site keys
  "bg", "rim", "color", "fontWeight"
]);

function calleeName(expression: Expression): string {
  if (expression.type === "Identifier") return expression.name;
  if (expression.type === "MemberExpression") return `${calleeName(expression.base)}${expression.indexer}${expression.identifier.name}`;
  if (expression.type === "IndexExpression") return `${calleeName(expression.base)}[]`;
  return expression.type;
}

function widgetType(callee: Expression): string {
  const name = calleeName(callee);
  const leaf = name.split(/[.:]/).at(-1) || "Widget";
  if (/button$/i.test(leaf)) return "Button";
  if (/label|text$/i.test(leaf)) return "Label";
  if (/image|sprite|icon$/i.test(leaf)) return "Image";
  if (/panel|container|view|card|chip|dialog|bar$/i.test(leaf)) return "Panel";
  return leaf;
}

function widgetTable(expression: Expression): { callee: Expression; table: TableConstructorExpression; call: Located } | undefined {
  if (expression.type === "TableCallExpression" && expression.arguments.type === "TableConstructorExpression") {
    return { callee: expression.base, table: expression.arguments, call: expression };
  }
  if (expression.type === "CallExpression") {
    const first = expression.arguments[0];
    if (first?.type === "TableConstructorExpression") return { callee: expression.base, table: first, call: expression };
  }
  return undefined;
}

function isSafeLiteralAst(expression: Expression): boolean {
  switch (expression.type) {
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
    case "NilLiteral":
      return true;
    case "UnaryExpression":
      return expression.operator === "-" && expression.argument.type === "NumericLiteral";
    case "TableConstructorExpression": {
      if (!expression.fields.length) return true;
      return expression.fields.every((field) => {
        if (field.type === "TableValue") return isSafeLiteralAst(field.value);
        if (field.type === "TableKeyString") return isSafeLiteralAst(field.value);
        return false;
      });
    }
    default:
      return false;
  }
}

function isExpressionUiValue(value: UiValue): value is { $expression: string } {
  return value !== null && typeof value === "object" && !Array.isArray(value) && "$expression" in value;
}

function escapeLuaString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function serializeLiteral(value: UiValue): string | undefined {
  if (value === null) return "nil";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (typeof value === "string") return `"${escapeLuaString(value)}"`;
  if (Array.isArray(value)) {
    if (!value.every((item) => typeof item === "number" || typeof item === "string" || typeof item === "boolean" || item === null)) {
      return undefined;
    }
    const parts = value.map((item) => serializeLiteral(item as UiValue));
    if (parts.some((part) => part === undefined)) return undefined;
    return `{ ${parts.join(", ")} }`;
  }
  if (typeof value === "object") {
    if (isExpressionUiValue(value)) return undefined;
    const entries = Object.entries(value);
    if (!entries.length) return "{}";
    const parts: string[] = [];
    for (const [key, entry] of entries) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return undefined;
      const serialized = serializeLiteral(entry);
      if (serialized === undefined) return undefined;
      parts.push(`${key} = ${serialized}`);
    }
    return `{ ${parts.join(", ")} }`;
  }
  return undefined;
}

function walkExpression(expression: Expression, visit: (expression: Expression) => void): void {
  visit(expression);
  const call = widgetTable(expression);
  if (call) {
    for (const field of call.table.fields) {
      if (field.type === "TableKeyString" || field.type === "TableValue") walkExpression(field.value, visit);
      else if (field.type === "TableKey") {
        walkExpression(field.key, visit);
        walkExpression(field.value, visit);
      }
    }
    return;
  }
  switch (expression.type) {
    case "MemberExpression":
      walkExpression(expression.base, visit);
      break;
    case "IndexExpression":
      walkExpression(expression.base, visit);
      walkExpression(expression.index, visit);
      break;
    case "CallExpression":
      walkExpression(expression.base, visit);
      for (const argument of expression.arguments) walkExpression(argument, visit);
      break;
    case "TableCallExpression":
      walkExpression(expression.base, visit);
      walkExpression(expression.arguments, visit);
      break;
    case "BinaryExpression":
    case "LogicalExpression":
      walkExpression(expression.left, visit);
      walkExpression(expression.right, visit);
      break;
    case "UnaryExpression":
      walkExpression(expression.argument, visit);
      break;
    case "TableConstructorExpression":
      for (const field of expression.fields) {
        if (field.type === "TableValue") walkExpression(field.value, visit);
        else if (field.type === "TableKeyString") walkExpression(field.value, visit);
        else if (field.type === "TableKey") {
          walkExpression(field.key, visit);
          walkExpression(field.value, visit);
        }
      }
      break;
    case "FunctionDeclaration":
      for (const statement of expression.body) walkStatement(statement, visit);
      break;
    default:
      break;
  }
}

function walkStatement(statement: Statement, visit: (expression: Expression) => void): void {
  switch (statement.type) {
    case "LocalStatement":
    case "AssignmentStatement":
      for (const init of statement.init) {
        if (init) walkExpression(init, visit);
      }
      break;
    case "CallStatement":
      walkExpression(statement.expression, visit);
      break;
    case "ReturnStatement":
      for (const argument of statement.arguments) walkExpression(argument, visit);
      break;
    case "IfStatement":
      for (const clause of statement.clauses) {
        if ("condition" in clause && clause.condition) walkExpression(clause.condition, visit);
        for (const body of clause.body) walkStatement(body, visit);
      }
      break;
    case "WhileStatement":
    case "RepeatStatement":
      walkExpression(statement.condition, visit);
      for (const body of statement.body) walkStatement(body, visit);
      break;
    case "ForNumericStatement":
      walkExpression(statement.start, visit);
      walkExpression(statement.end, visit);
      if (statement.step) walkExpression(statement.step, visit);
      for (const body of statement.body) walkStatement(body, visit);
      break;
    case "ForGenericStatement":
      for (const iterator of statement.iterators) walkExpression(iterator, visit);
      for (const body of statement.body) walkStatement(body, visit);
      break;
    case "DoStatement":
      for (const body of statement.body) walkStatement(body, visit);
      break;
    case "FunctionDeclaration":
      for (const body of statement.body) walkStatement(body, visit);
      break;
    default:
      break;
  }
}

function findWidgetTables(source: string): Array<{ line: number; type: string; table: TableConstructorExpression; call: Located }> {
  let body: Statement[];
  try {
    // Maker / UrhoX scripts use Lua 5.3 bitwise ops (`enc ~ _XK`); 5.1 mode rejects `~`.
    const ast = luaparse.parse(source, { locations: true, ranges: true, luaVersion: "5.3", encodingMode: "none" });
    body = ast.body;
  } catch {
    return [];
  }
  const matches: Array<{ line: number; type: string; table: TableConstructorExpression; call: Located }> = [];
  const visit = (expression: Expression) => {
    const call = widgetTable(expression);
    if (!call) return;
    const line = call.call.loc?.start.line ?? 0;
    if (line <= 0) return;
    matches.push({ line, type: widgetType(call.callee), table: call.table, call: call.call });
  };
  for (const statement of body) walkStatement(statement, visit);
  return matches;
}

function fieldByKey(table: TableConstructorExpression, key: string): TableKeyString | undefined {
  return table.fields.find((field): field is TableKeyString => field.type === "TableKeyString" && field.key.name === key);
}

function expressionLooksLikeOptsPassthrough(source: string, expression: Expression): boolean {
  const located = expression as Expression & Located;
  if (!located.range) return false;
  return /\bopts\.|\boptions\.|\bprops\./.test(source.slice(located.range[0], located.range[1]));
}

/** UiStyle-style shared factory body (`opts.text`), not call-site `options.onStart`. */
function isFactoryTemplateTable(source: string, table: TableConstructorExpression): boolean {
  return table.fields.some((field) => {
    if (field.type !== "TableKeyString" && field.type !== "TableValue") return false;
    const located = field.value as Expression & Located;
    if (!located.range) return false;
    return /\bopts\./.test(source.slice(located.range[0], located.range[1]));
  });
}

function planFieldInsertion(
  source: string,
  table: TableConstructorExpression,
  key: string,
  literal: string
): { start: number; end: number; text: string } | undefined {
  const tableLocated = table as Located;
  if (!tableLocated.range) return undefined;
  const open = tableLocated.range[0];
  const close = tableLocated.range[1] - 1;
  if (close < open || source[close] !== "}") return undefined;
  const body = source.slice(open, close);
  const multiline = body.includes("\n");
  if (!multiline) {
    const inner = body.replace(/^\{/, "");
    const trimmed = inner.trim();
    const needsComma = trimmed.length > 0 && !trimmed.endsWith(",");
    return { start: close, end: close, text: `${needsComma ? "," : ""} ${key} = ${literal} ` };
  }

  const indentMatch = body.match(/\n([ \t]*)\S[^\n]*$/);
  const indent = indentMatch?.[1] ?? "  ";
  const closeIndentMatch = body.match(/\n([ \t]*)$/);
  const closeIndent = closeIndentMatch?.[1] ?? (indent.length >= 2 ? indent.slice(0, -2) : "");
  const bodyTrimmed = body.replace(/\s+$/, "");
  const needsComma = !bodyTrimmed.endsWith("{") && !bodyTrimmed.endsWith(",");
  const text = `${needsComma ? "," : ""}\n${indent}${key} = ${literal},\n${closeIndent}`;
  return { start: open + bodyTrimmed.length, end: close, text };
}

type WidgetMatch = {
  line: number;
  type: string;
  table: TableConstructorExpression;
  call: Located;
  match: "exact" | "nested" | "nearby";
};

function findTargetWidget(
  source: string,
  selector: { line: number; type: string }
): WidgetMatch | undefined {
  const widgets = findWidgetTables(source);
  const exact = widgets.filter((item) => item.line === selector.line && item.type === selector.type);
  if (exact.length === 1) return { ...exact[0]!, match: "exact" };
  if (exact.length > 1) return undefined;

  // PrimaryButton { } is typed Button, but runtime often tags the outer kit panel as Panel
  // at the same call-site line — accept the alternate type on an exact line hit.
  const altType = selector.type === "Panel" ? "Button" : selector.type === "Button" ? "Panel" : "";
  if (altType) {
    const altExact = widgets.filter((item) => item.line === selector.line && item.type === altType);
    if (altExact.length === 1) return { ...altExact[0]!, match: "exact" };
  }

  // Runtime AddChild often records a parent Panel line while the edited node is a
  // nested Label/Button a few lines below — search inside that anchor's range.
  const anchors = widgets.filter((item) => item.line === selector.line);
  for (const anchor of anchors) {
    const range = (anchor.table as Located).range ?? anchor.call.range;
    if (!range) continue;
    const nested = widgets.filter((item) => {
      if (item.type !== selector.type || item === anchor) return false;
      const itemRange = item.call.range;
      return Boolean(itemRange && itemRange[0] >= range[0] && itemRange[1] <= range[1]);
    });
    if (nested.length === 1) return { ...nested[0]!, match: "nested" };
  }

  // Runtime AddChild line can drift slightly from the table-call start.
  // Keep the window tight — a wide window previously matched neighboring Panels
  // (e.g. PrimaryButton line → staminaRow) and corrupted them.
  const nearby = widgets
    .filter((item) => item.type === selector.type && Math.abs(item.line - selector.line) <= 6)
    .sort((left, right) => Math.abs(left.line - selector.line) - Math.abs(right.line - selector.line));
  if (nearby.length === 1) return { ...nearby[0]!, match: "nearby" };
  if (nearby.length > 1 && nearby[0] && nearby[1]
    && Math.abs(nearby[0].line - selector.line) < Math.abs(nearby[1].line - selector.line)) {
    return { ...nearby[0], match: "nearby" };
  }
  return undefined;
}

/** Map factory expressions onto call-site keys (PrimaryButton/Chip/CaptionBar/…). */
function factoryCallSitePropKey(expression: Expression): string | undefined {
  if (expression.type === "Identifier") {
    if (expression.name === "rim") return "rim";
    if (expression.name === "core" || expression.name === "bg") return "bg";
    if (expression.name === "textColor") return "color";
    if (expression.name === "radius") return "borderRadius";
    return undefined;
  }
  if (expression.type === "MemberExpression" && expression.indexer === ".") {
    const base = expression.base;
    const leaf = expression.identifier.name;
    if (base.type === "Identifier" && (base.name === "opts" || base.name === "options" || base.name === "props")) {
      if (leaf === "fontColor") return "color";
      if (leaf === "backgroundColor") return "bg";
      if (leaf === "title") return "title";
      if (leaf === "confirmText" || leaf === "cancelText" || leaf === "message") return leaf;
      // Direct passthrough of common opts.* fields onto the call table.
      if ([
        "text", "bg", "rim", "color", "fontSize", "fontWeight",
        "width", "height", "left", "top", "right", "bottom",
        "borderRadius", "padding", "margin", "visible"
      ].includes(leaf)) {
        return leaf;
      }
    }
  }
  // Binary `opts.x or default` — luaparse uses LogicalExpression for `or`.
  if (expression.type === "LogicalExpression" || expression.type === "BinaryExpression") {
    return factoryCallSitePropKey(expression.left) || factoryCallSitePropKey(expression.right);
  }
  return undefined;
}

function expressionLooksLikeFactoryLocal(expression: Expression): boolean {
  return factoryCallSitePropKey(expression) !== undefined
    || (expression.type === "Identifier" && /^(rim|core|bg|radius|textColor)$/.test(expression.name));
}

/** Assets/Colors refs must not be frozen into shared UI factories. */
function expressionLooksLikeSharedConstant(expression: Expression): boolean {
  if (expression.type !== "MemberExpression" || expression.indexer !== ".") return false;
  let base: Expression = expression;
  while (base.type === "MemberExpression") base = base.base;
  // Keep `style.x` / `theme.x` freezable — Studio intentionally writes concrete values over them.
  return base.type === "Identifier" && /^(Assets|Colors)$/.test(base.name);
}

/** Remap inspector props onto factory call-site field names when the table uses bg/rim. */
function remapPropsForCallSiteTable(
  props: Record<string, UiValue>,
  table?: TableConstructorExpression,
  preferredColorKey?: string
): Record<string, UiValue> {
  const usesKitColors = Boolean(
    table && (fieldByKey(table, "bg") || fieldByKey(table, "rim") || fieldByKey(table, "title"))
  );
  const next: Record<string, UiValue> = { ...props };
  if (usesKitColors || preferredColorKey) {
    if (next.backgroundColor !== undefined && next.bg === undefined && next.rim === undefined) {
      const key = preferredColorKey === "rim" ? "rim" : "bg";
      next[key] = next.backgroundColor;
      delete next.backgroundColor;
    }
  }
  if (next.fontColor !== undefined && next.color === undefined) {
    next.color = next.fontColor;
    delete next.fontColor;
  }
  return next;
}

export function patchLuaWidgetLiterals(
  source: string,
  selector: { line: number; type: string },
  props: Record<string, UiValue>,
  options: LuaPropWritebackOptions = {}
): LuaPropWritebackResult {
  const replaceExpressions = options.replaceExpressions === true;
  const insertMissingFields = options.insertMissingFields !== false;
  const skipped: LuaPropWritebackSkip[] = [];
  const applied: string[] = [];
  const widget = findTargetWidget(source, selector);
  if (!widget) {
    for (const key of Object.keys(props)) skipped.push({ key, reason: "widget_not_found" });
    return { applied, skipped, text: source, changed: false };
  }
  // Shared factory bodies (opts.text / opts.color / …) must not gain per-instance
  // fields like fontColor — that pollutes every PrimaryButton call site.
  const factoryTemplate = isFactoryTemplateTable(source, widget.table);
  // nearby may be a different sibling widget — never insert new fields there.
  const allowInsert = insertMissingFields && !factoryTemplate && widget.match !== "nearby";
  // Kit call tables (PrimaryButton/UpgradeCard/Chip) use bg/rim/title —
  // remap inspector backgroundColor/fontColor onto those keys.
  const remappedProps = (fieldByKey(widget.table, "bg") || fieldByKey(widget.table, "rim") || fieldByKey(widget.table, "title") || widget.type === "Button")
    ? remapPropsForCallSiteTable(props, widget.table, undefined)
    : props;
  const replacements: Array<{ start: number; end: number; text: string; key: string }> = [];

  for (const [key, value] of Object.entries(remappedProps)) {
    if (!WRITABLE_KEYS.has(key) || key.startsWith("$")) {
      skipped.push({ key, reason: "key_not_writable" });
      continue;
    }
    if (value === undefined || isExpressionUiValue(value as UiValue)) {
      skipped.push({ key, reason: "value_not_literal" });
      continue;
    }
    const serialized = serializeLiteral(
      // UI text must stay a Lua string even when the user types digits only.
      key === "text" && typeof value === "number" && Number.isFinite(value) ? String(value) : value
    );
    if (serialized === undefined) {
      skipped.push({ key, reason: "serialize_failed" });
      continue;
    }

    const field = fieldByKey(widget.table, key);
    if (!field) {
      if (!allowInsert) {
        skipped.push({
          key,
          reason: factoryTemplate ? "opts_passthrough" : widget.match === "nearby" ? "nearby_no_insert" : "field_missing"
        });
        continue;
      }
      const insertion = planFieldInsertion(source, widget.table, key, serialized);
      if (!insertion) {
        skipped.push({ key, reason: "insert_failed" });
        continue;
      }
      replacements.push({ ...insertion, key });
      continue;
    }

    const valueNode = field.value as Expression & Located;
    if (!valueNode.range) {
      skipped.push({ key, reason: "missing_range" });
      continue;
    }
    const literalAst = isSafeLiteralAst(field.value);
    if (!literalAst && !replaceExpressions) {
      skipped.push({ key, reason: "ast_not_literal" });
      continue;
    }
    if (!literalAst && replaceExpressions) {
      // Factory passthrough / shared Assets|Colors refs must stay dynamic.
      if (
        expressionLooksLikeOptsPassthrough(source, field.value)
        || expressionLooksLikeFactoryLocal(field.value)
        || expressionLooksLikeSharedConstant(field.value)
      ) {
        skipped.push({ key, reason: "opts_passthrough" });
        continue;
      }
      // nearby + non-literal on a sibling widget is too risky to freeze.
      if (widget.match === "nearby") {
        skipped.push({ key, reason: "nearby_skip" });
        continue;
      }
    }
    const preferArray = field.value.type === "TableConstructorExpression"
      && field.value.fields.every((item) => item.type === "TableValue");
    const nextText = preferArray && Array.isArray(value) ? serializeLiteral(value)! : serialized;
    const [start, end] = valueNode.range;
    const current = source.slice(start, end);
    if (current === nextText) {
      skipped.push({ key, reason: "unchanged" });
      continue;
    }
    replacements.push({ start, end, text: nextText, key });
  }

  replacements.sort((left, right) => right.start - left.start || right.end - left.end);
  let text = source;
  for (const replacement of replacements) {
    text = `${text.slice(0, replacement.start)}${replacement.text}${text.slice(replacement.end)}`;
    applied.push(replacement.key);
  }
  return { applied, skipped, text, changed: applied.length > 0 };
}

function normalizeSourceFile(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

export type CallSiteTextWritebackResult = {
  filesTouched: string[];
  appliedCount: number;
  reason: "ok" | "unchanged" | "no_match" | "ambiguous" | "empty";
};

function listLuaFilesUnder(projectRoot: string, relativeDir: string): string[] {
  const scriptsRoot = path.join(projectRoot, relativeDir);
  if (!fs.existsSync(scriptsRoot)) return [];
  const files: string[] = [];
  const stack = [scriptsRoot];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith(".lua")) {
        files.push(path.relative(projectRoot, full).split(path.sep).join("/"));
      }
    }
  }
  return files;
}

function listUiLuaFiles(projectRoot: string): string[] {
  return listLuaFilesUnder(projectRoot, path.join("scripts", "ui"));
}

function listScriptLuaFiles(projectRoot: string): string[] {
  return listLuaFilesUnder(projectRoot, "scripts");
}

function collectStringLiteralHits(
  projectRoot: string,
  files: string[],
  needle: string
): Array<{ file: string; start: number; end: number }> {
  const hits: Array<{ file: string; start: number; end: number }> = [];
  for (const relative of files) {
    let source: string;
    try {
      source = readProjectSource(projectRoot, relative).text;
    } catch {
      continue;
    }
    let body: Statement[];
    try {
      const ast = luaparse.parse(source, { locations: true, ranges: true, luaVersion: "5.3", encodingMode: "none" });
      body = ast.body;
    } catch {
      continue;
    }
    const visit = (expression: Expression) => {
      if (expression.type !== "StringLiteral") return;
      const located = expression as Expression & Located;
      if (!located.range) return;
      if (source.slice(located.range[0], located.range[1]) !== needle) return;
      hits.push({ file: relative, start: located.range[0], end: located.range[1] });
    };
    for (const statement of body) walkStatement(statement, visit);
  }
  return hits;
}

/**
 * Replace unique call-site text field literals in UI Lua.
 * Does **not** rewrite shared `Assets.X = "…"` assignments — those often feed
 * multiple widgets (e.g. title banner `Title .. Subtitle`); widget edits must
 * freeze the call site via `writeBackMatchingCallSiteText` instead.
 */
export function writeBackMatchingTextLiterals(
  projectRoot: string,
  previousText: string,
  nextText: string
): CallSiteTextWritebackResult {
  if (!previousText) return { filesTouched: [], appliedCount: 0, reason: "empty" };
  if (previousText === nextText) return { filesTouched: [], appliedCount: 0, reason: "unchanged" };
  const uiFiles = listUiLuaFiles(projectRoot);
  if (!uiFiles.length) return { filesTouched: [], appliedCount: 0, reason: "no_match" };

  const needle = serializeLiteral(previousText);
  const replacement = serializeLiteral(nextText);
  if (!needle || !replacement) return { filesTouched: [], appliedCount: 0, reason: "empty" };

  type Hit = { file: string; start: number; end: number };
  const fieldHits: Hit[] = [];
  for (const relative of uiFiles) {
    let source: string;
    try {
      source = readProjectSource(projectRoot, relative).text;
    } catch {
      continue;
    }
    for (const widget of findWidgetTables(source)) {
      if (isFactoryTemplateTable(source, widget.table)) continue;
      for (const key of ["text", "title"] as const) {
        const field = fieldByKey(widget.table, key);
        const valueNode = field?.value as (Expression & Located) | undefined;
        if (!valueNode?.range || !isSafeLiteralAst(field!.value)) continue;
        const [start, end] = valueNode.range;
        if (source.slice(start, end) !== needle) continue;
        fieldHits.push({ file: relative, start, end });
      }
    }
  }

  const pickUnique = (hits: Hit[]): CallSiteTextWritebackResult | undefined => {
    if (hits.length === 0) return undefined;
    if (hits.length !== 1) return { filesTouched: [], appliedCount: 0, reason: "ambiguous" };
    const hit = hits[0]!;
    const loaded = readProjectSource(projectRoot, hit.file);
    const next = `${loaded.text.slice(0, hit.start)}${replacement}${loaded.text.slice(hit.end)}`;
    writeProjectText(projectRoot, hit.file, next);
    return { filesTouched: [hit.file], appliedCount: 1, reason: "ok" };
  };

  const fromFields = pickUnique(fieldHits);
  if (fromFields) return fromFields;

  const fromLiteral = pickUnique(collectStringLiteralHits(projectRoot, uiFiles, needle).filter((hit) => (
    !/Assets\.lua$/i.test(hit.file) && !/[\\/]data[\\/]/i.test(hit.file)
  )));
  if (fromLiteral) return fromLiteral;

  return { filesTouched: [], appliedCount: 0, reason: "no_match" };
}

function memberPath(expression: Expression): string | undefined {
  if (expression.type === "Identifier") return expression.name;
  if (expression.type === "MemberExpression" && expression.indexer === ".") {
    const base = memberPath(expression.base);
    if (!base) return undefined;
    return `${base}.${expression.identifier.name}`;
  }
  return undefined;
}

const assetStringCache = new Map<string, Map<string, string>>();

function loadAssetStringAssignments(projectRoot: string): Map<string, string> {
  const cached = assetStringCache.get(projectRoot);
  if (cached) return cached;
  const map = new Map<string, string>();
  for (const relative of listScriptLuaFiles(projectRoot)) {
    let source: string;
    try {
      source = readProjectSource(projectRoot, relative).text;
    } catch {
      continue;
    }
    let body: Statement[];
    try {
      const ast = luaparse.parse(source, { locations: true, ranges: true, luaVersion: "5.3", encodingMode: "none" });
      body = ast.body;
    } catch {
      continue;
    }
    const walk = (statement: Statement) => {
      if (statement.type === "AssignmentStatement") {
        for (let index = 0; index < statement.variables.length; index += 1) {
          const variable = statement.variables[index];
          const init = statement.init[index];
          if (!variable || !init || init.type !== "StringLiteral") continue;
          const pathName = memberPath(variable as Expression);
          if (!pathName || !pathName.includes(".")) continue;
          const located = init as Expression & Located;
          if (!located.range) continue;
          const raw = source.slice(located.range[0], located.range[1]);
          if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
            map.set(pathName, raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, "\n"));
          }
        }
      }
      switch (statement.type) {
        case "IfStatement":
          for (const clause of statement.clauses) for (const bodyStmt of clause.body) walk(bodyStmt);
          break;
        case "WhileStatement":
        case "RepeatStatement":
        case "DoStatement":
        case "FunctionDeclaration":
          for (const bodyStmt of statement.body) walk(bodyStmt);
          break;
        case "ForNumericStatement":
        case "ForGenericStatement":
          for (const bodyStmt of statement.body) walk(bodyStmt);
          break;
        default:
          break;
      }
    };
    for (const statement of body) walk(statement);
  }
  assetStringCache.set(projectRoot, map);
  return map;
}

/** Drop cached Assets.* strings after a write so the next color route sees fresh values. */
function invalidateAssetStringCache(projectRoot: string): void {
  assetStringCache.delete(projectRoot);
}

export type CallSiteIdentityHints = {
  width?: UiValue;
  height?: UiValue;
  left?: UiValue;
  top?: UiValue;
};

function literalFieldEquals(
  source: string,
  table: TableConstructorExpression,
  key: string,
  expected: UiValue | undefined
): boolean {
  if (expected === undefined) return false;
  const field = fieldByKey(table, key);
  const valueNode = field?.value as (Expression & Located) | undefined;
  if (!valueNode?.range || !isSafeLiteralAst(field!.value)) return false;
  const serialized = serializeLiteral(expected);
  return Boolean(serialized && source.slice(valueNode.range[0], valueNode.range[1]) === serialized);
}

function callSiteIdentityMatch(
  projectRoot: string,
  source: string,
  table: TableConstructorExpression,
  previousText: string,
  hints?: CallSiteIdentityHints,
  options?: { allowLayoutOnly?: boolean }
): boolean {
  let textMatched = false;
  const needle = serializeLiteral(previousText);
  if (needle) {
    for (const key of ["text", "title"] as const) {
      const field = fieldByKey(table, key);
      if (!field) continue;
      const valueNode = field.value as Expression & Located;
      if (!valueNode.range) continue;
      if (isSafeLiteralAst(field.value) && source.slice(valueNode.range[0], valueNode.range[1]) === needle) {
        textMatched = true;
        break;
      }
      const ref = memberPath(field.value);
      if (ref) {
        const resolved = loadAssetStringAssignments(projectRoot).get(ref);
        if (resolved === previousText) {
          textMatched = true;
          break;
        }
      }
    }
  }
  const checks: Array<keyof CallSiteIdentityHints> = ["width", "height", "left", "top"];
  const active = (hints ? checks.filter((key) => hints[key] !== undefined) : []);
  const layoutMatched = active.length > 0
    && Boolean(fieldByKey(table, "bg") || fieldByKey(table, "rim") || fieldByKey(table, "text") || fieldByKey(table, "title"))
    && active.every((key) => literalFieldEquals(source, table, key, hints![key]));

  if (textMatched) return true;
  // Stale identityText after a prior text edit: fall back to unique layout among kit call sites.
  if (options?.allowLayoutOnly && layoutMatched) return true;
  return false;
}

/**
 * Freeze `text`/`title` on a unique kit call site (including `text = Assets.Subtitle`).
 * Prefer this over rewriting shared Assets.* so one button edit does not change the banner.
 */
export function writeBackMatchingCallSiteText(
  projectRoot: string,
  previousText: string,
  nextText: string,
  hints?: CallSiteIdentityHints
): CallSiteTextWritebackResult {
  if (!previousText || previousText === nextText) {
    return { filesTouched: [], appliedCount: 0, reason: previousText === nextText ? "unchanged" : "empty" };
  }
  const replacement = serializeLiteral(nextText);
  if (!replacement) return { filesTouched: [], appliedCount: 0, reason: "empty" };

  type Hit = { file: string; table: TableConstructorExpression; source: string; key: "text" | "title" };
  const collect = (allowLayoutOnly: boolean): Hit[] => {
    const hits: Hit[] = [];
    for (const relative of listUiLuaFiles(projectRoot)) {
      let source: string;
      try {
        source = readProjectSource(projectRoot, relative).text;
      } catch {
        continue;
      }
      for (const widget of findWidgetTables(source)) {
        if (isFactoryTemplateTable(source, widget.table)) continue;
        if (!callSiteIdentityMatch(projectRoot, source, widget.table, previousText, hints, { allowLayoutOnly })) {
          continue;
        }
        const textField = fieldByKey(widget.table, "text");
        const titleField = fieldByKey(widget.table, "title");
        const key: "text" | "title" | undefined = textField ? "text" : titleField ? "title" : undefined;
        if (!key) continue;
        hits.push({ file: relative, table: widget.table, source, key });
      }
    }
    return hits;
  };
  let hits = collect(false);
  if (hits.length === 0) hits = collect(true);
  if (hits.length > 1 && hints) {
    // Prefer the unique text+layout hit over layout-only false friends.
    const tight = hits.filter((hit) => callSiteIdentityMatch(
      projectRoot, hit.source, hit.table, previousText, hints, { allowLayoutOnly: false }
    ));
    if (tight.length === 1) hits = tight;
  }
  if (hits.length > 1) {
    const byFile = new Map<string, Hit[]>();
    for (const hit of hits) {
      const list = byFile.get(hit.file) || [];
      list.push(hit);
      byFile.set(hit.file, list);
    }
    const singletons = [...byFile.values()].filter((list) => list.length === 1);
    if (singletons.length === 1) hits = singletons[0]!;
    else {
      const mainHud = byFile.get("scripts/ui/MainHUD.lua");
      if (mainHud?.length === 1) hits = mainHud;
    }
  }
  if (hits.length === 0) return { filesTouched: [], appliedCount: 0, reason: "no_match" };
  if (hits.length !== 1) return { filesTouched: [], appliedCount: 0, reason: "ambiguous" };

  const hit = hits[0]!;
  let next = hit.source;
  // Patch the chosen table directly — do not re-find with allowLayoutOnly (same
  // left/width/height on sibling PrimaryButtons would pick the wrong first match).
  const hitRange = (hit.table as Located).range;
  const live = hitRange
    ? findWidgetTables(next).find((widget) => {
      const range = (widget.table as Located).range;
      return Boolean(range && range[0] === hitRange[0] && range[1] === hitRange[1]);
    })
    : undefined;
  if (!live) return { filesTouched: [], appliedCount: 0, reason: "no_match" };
  const field = fieldByKey(live.table, hit.key);
  const valueNode = field?.value as (Expression & Located) | undefined;
  if (!valueNode?.range) return { filesTouched: [], appliedCount: 0, reason: "no_match" };
  const [start, end] = valueNode.range;
  if (next.slice(start, end) === replacement) {
    return { filesTouched: [], appliedCount: 0, reason: "unchanged" };
  }
  next = `${next.slice(0, start)}${replacement}${next.slice(end)}`;
  writeProjectText(projectRoot, hit.file, next);
  return { filesTouched: [hit.file], appliedCount: 1, reason: "ok" };
}

/**
 * Write style props onto the unique UiStyle.* call site identified by text/title
 * (including `text = Assets.Subtitle` when the resolved asset string matches).
 */
export function writeBackMatchingCallSiteProps(
  projectRoot: string,
  previousText: string,
  props: Record<string, UiValue>,
  hints?: CallSiteIdentityHints
): CallSiteTextWritebackResult {
  if (!previousText || !Object.keys(props).length) {
    return { filesTouched: [], appliedCount: 0, reason: "empty" };
  }

  const normalized: Record<string, UiValue> = { ...props };
  if (normalized.backgroundColor !== undefined && normalized.bg === undefined) {
    normalized.bg = normalized.backgroundColor;
    delete normalized.backgroundColor;
  }
  if (normalized.fontColor !== undefined && normalized.color === undefined) {
    normalized.color = normalized.fontColor;
    delete normalized.fontColor;
  }
  if (normalized.textColor !== undefined && normalized.color === undefined) {
    normalized.color = normalized.textColor;
    delete normalized.textColor;
  }

  type Hit = { file: string; range: [number, number] };
  const collectHits = (allowLayoutOnly: boolean): Hit[] => {
    const hits: Hit[] = [];
    for (const relative of listUiLuaFiles(projectRoot)) {
      let source: string;
      try {
        source = readProjectSource(projectRoot, relative).text;
      } catch {
        continue;
      }
      for (const widget of findWidgetTables(source)) {
        if (isFactoryTemplateTable(source, widget.table)) continue;
        if (!callSiteIdentityMatch(projectRoot, source, widget.table, previousText, hints, { allowLayoutOnly })) {
          continue;
        }
        const range = (widget.table as Located).range;
        if (!range) continue;
        hits.push({ file: relative, range: [range[0], range[1]] });
      }
    }
    return hits;
  };
  let hits = collectHits(false);
  if (hits.length === 0) hits = collectHits(true);
  if (hits.length > 1 && hints) {
    const tight = collectHits(false);
    if (tight.length === 1) hits = tight;
  }
  let chosen = hits;
  if (hits.length > 1) {
    const byFile = new Map<string, Hit[]>();
    for (const hit of hits) {
      const list = byFile.get(hit.file) || [];
      list.push(hit);
      byFile.set(hit.file, list);
    }
    const singletons = [...byFile.values()].filter((list) => list.length === 1);
    if (singletons.length === 1) chosen = singletons[0]!;
    else {
      const mainHud = byFile.get("scripts/ui/MainHUD.lua");
      if (mainHud?.length === 1) chosen = mainHud;
    }
  }
  if (chosen.length === 0) return { filesTouched: [], appliedCount: 0, reason: "no_match" };
  if (chosen.length !== 1) return { filesTouched: [], appliedCount: 0, reason: "ambiguous" };

  const relative = chosen[0]!.file;
  const anchorRange = chosen[0]!.range;
  let next = readProjectSource(projectRoot, relative).text;
  let appliedCount = 0;
  for (const [key, value] of Object.entries(normalized)) {
    if (!WRITABLE_KEYS.has(key) || value === undefined || isExpressionUiValue(value)) continue;
    const fresh = findWidgetTables(next).find((widget) => {
      const range = (widget.table as Located).range;
      return Boolean(range && range[0] === anchorRange[0] && range[1] === anchorRange[1]);
    });
    if (!fresh) continue;
    const remapped = remapPropsForCallSiteTable({ [key]: value }, fresh.table);
    for (const [mappedKey, mappedValue] of Object.entries(remapped)) {
      if (!WRITABLE_KEYS.has(mappedKey) || mappedValue === undefined || isExpressionUiValue(mappedValue)) continue;
      if (mappedKey === "backgroundColor" && (fieldByKey(fresh.table, "bg") || fieldByKey(fresh.table, "rim"))) {
        continue;
      }
      const mappedSerialized = serializeLiteral(mappedValue);
      if (!mappedSerialized) continue;
      const live = findWidgetTables(next).find((widget) => {
        const range = (widget.table as Located).range;
        return Boolean(range && range[0] === anchorRange[0] && range[1] === anchorRange[1]);
      });
      if (!live) continue;
      const field = fieldByKey(live.table, mappedKey);
      if (field) {
        const valueNode = field.value as Expression & Located;
        if (!valueNode.range) continue;
        const [start, end] = valueNode.range;
        if (next.slice(start, end) === mappedSerialized) continue;
        next = `${next.slice(0, start)}${mappedSerialized}${next.slice(end)}`;
        appliedCount += 1;
      } else {
        const insertion = planFieldInsertion(next, live.table, mappedKey, mappedSerialized);
        if (!insertion) continue;
        next = `${next.slice(0, insertion.start)}${insertion.text}${next.slice(insertion.end)}`;
        appliedCount += 1;
        // Insertion shifts subsequent ranges; re-anchor by text identity on next keys.
        const refreshed = findWidgetTables(next).find((widget) => (
          !isFactoryTemplateTable(next, widget.table)
          && callSiteIdentityMatch(projectRoot, next, widget.table, previousText, hints, { allowLayoutOnly: false })
        )) || findWidgetTables(next).find((widget) => (
          !isFactoryTemplateTable(next, widget.table)
          && callSiteIdentityMatch(projectRoot, next, widget.table, previousText, hints, { allowLayoutOnly: true })
        ));
        const refreshedRange = refreshed ? (refreshed.table as Located).range : undefined;
        if (refreshedRange) {
          anchorRange[0] = refreshedRange[0];
          anchorRange[1] = refreshedRange[1];
        }
      }
    }
  }
  if (!appliedCount) return { filesTouched: [], appliedCount: 0, reason: "unchanged" };
  writeProjectText(projectRoot, relative, next);
  return { filesTouched: [relative], appliedCount, reason: "ok" };
}

function resolveFactoryCallSiteProps(
  source: string,
  selector: { line: number; type: string },
  props: Record<string, UiValue>
): Record<string, UiValue> {
  const widget = findTargetWidget(source, selector);
  const out: Record<string, UiValue> = {};
  for (const [key, value] of Object.entries(props)) {
    if (widget) {
      const field = fieldByKey(widget.table, key);
      if (field) {
        const mapped = factoryCallSitePropKey(field.value);
        if (mapped) {
          out[mapped] = value;
          continue;
        }
      }
    }
    if (key === "backgroundColor") out.bg = value;
    else if (key === "fontColor" || key === "textColor") out.color = value;
    else if (WRITABLE_KEYS.has(key)) out[key] = value;
  }
  return out;
}

const CALL_SITE_ROUTE_KEYS = new Set([
  "text", "title", "backgroundColor", "fontColor", "textColor", "color",
  "bg", "rim", "fontSize", "fontWeight", "width", "height", "borderRadius",
  "left", "top", "padding", "margin", "visible"
]);



export function writeBackUiOverridesToLua(
  projectRoot: string,
  overrides: LuaWritebackOverride[]
): LuaOverridesWritebackSummary {
  const byFile = new Map<string, LuaWritebackOverride[]>();
  for (const override of overrides) {
    const sourceFile = normalizeSourceFile(override.selector.sourceFile);
    const list = byFile.get(sourceFile) || [];
    list.push(override);
    byFile.set(sourceFile, list);
  }

  const remaining: UiSidecarOverride[] = [];
  const filesTouched: string[] = [];
  const details: LuaOverridesWritebackSummary["details"] = [];
  let appliedCount = 0;
  let skippedCount = 0;

  for (const [sourceFile, fileOverrides] of byFile) {
    let resolvedPath: string;
    let source: string;
    try {
      const loaded = readProjectSource(projectRoot, sourceFile);
      resolvedPath = loaded.path;
      source = loaded.text;
    } catch {
      remaining.push(...fileOverrides.map(({ previousProps: _p, ...rest }) => rest));
      skippedCount += fileOverrides.reduce((sum, item) => sum + Object.keys(item.props).length, 0);
      continue;
    }

    let nextSource = source;
    let fileChanged = false;
    for (const override of fileOverrides) {
      const result = patchLuaWidgetLiterals(nextSource, {
        line: override.selector.line,
        type: override.selector.type
      }, override.props, { replaceExpressions: true, insertMissingFields: true });
      let applied = [...result.applied];
      let skipped = [...result.skipped];
      if (result.changed) {
        nextSource = result.text;
        fileChanged = true;
      }

      const textBlocked = skipped.find((item) => (
        (item.key === "text" || item.key === "title")
        && item.reason === "opts_passthrough"
      ));
      // previousProps.text = first pre-edit label (find old Assets/literal)
      // identityText = latest on-screen label (color routing after text already changed)
      const previousTextOriginal = override.previousProps?.text;
      const identityTextLatest = typeof override.identityText === "string" && override.identityText
        ? override.identityText
        : previousTextOriginal;
      const previousText = previousTextOriginal ?? identityTextLatest;
      const nextTextValue = override.props.text ?? override.props.title;
      const identityHints: CallSiteIdentityHints = {
        ...(override.previousProps?.width !== undefined ? { width: override.previousProps.width } : {}),
        ...(override.previousProps?.height !== undefined ? { height: override.previousProps.height } : {}),
        ...(override.previousProps?.left !== undefined ? { left: override.previousProps.left } : {}),
        ...(override.previousProps?.top !== undefined ? { top: override.previousProps.top } : {})
      };
      if (textBlocked && nextTextValue != null) {
        if (previousText == null) {
          skipped = skipped.map((item) => (
            (item.key === "text" || item.key === "title") && item.reason === "opts_passthrough"
              ? { key: item.key, reason: "call_site_no_previous" }
              : item
          ));
        } else {
          // 1) Freeze the unique kit call site (Assets.Subtitle → "123123" on that button only)
          // 2) Else rewrite shared Assets.X = "…" / unique literal
          const callSiteText = writeBackMatchingCallSiteText(
            projectRoot,
            String(previousTextOriginal ?? previousText),
            String(nextTextValue),
            identityHints
          );
          const callSite = callSiteText.appliedCount > 0 || callSiteText.reason === "unchanged"
            ? callSiteText
            : writeBackMatchingTextLiterals(
              projectRoot,
              String(previousTextOriginal ?? previousText),
              String(nextTextValue)
            );
          if (callSite.appliedCount > 0 || callSite.reason === "unchanged") {
            applied.push(textBlocked.key);
            skipped = skipped.filter((item) => item.key !== textBlocked.key);
            if (callSite.appliedCount > 0) {
              appliedCount += callSite.appliedCount;
              for (const file of callSite.filesTouched) {
                if (!filesTouched.includes(file)) filesTouched.push(file);
              }
            }
          } else {
            const reason = callSite.reason === "ambiguous"
              ? "call_site_ambiguous"
              : "call_site_no_match";
            skipped = skipped.map((item) => (
              item.key === textBlocked.key && item.reason === "opts_passthrough"
                ? { key: item.key, reason }
                : item
            ));
          }
        }
      }

      const routedBlocked = skipped.filter((item) => (
        (item.reason === "opts_passthrough" || item.reason === "nearby_no_insert" || item.reason === "field_missing")
        && CALL_SITE_ROUTE_KEYS.has(item.key)
        && item.key !== "text"
        && item.key !== "title"
      ));
      if (routedBlocked.length && previousText != null) {
        const routedProps = resolveFactoryCallSiteProps(nextSource, {
          line: override.selector.line,
          type: override.selector.type
        }, Object.fromEntries(
          routedBlocked
            .map((item) => [item.key, override.props[item.key]])
            .filter((entry): entry is [string, UiValue] => entry[1] !== undefined)
        ));
        const identityText = nextTextValue != null
          ? String(nextTextValue)
          : String(identityTextLatest ?? previousText);
        const routedSite = writeBackMatchingCallSiteProps(
          projectRoot,
          identityText,
          routedProps,
          identityHints
        );
        if (routedSite.appliedCount > 0 || routedSite.reason === "unchanged") {
          for (const item of routedBlocked) {
            applied.push(item.key);
          }
          skipped = skipped.filter((item) => !routedBlocked.some((blocked) => blocked.key === item.key));
          if (routedSite.appliedCount > 0) {
            appliedCount += routedSite.appliedCount;
            for (const file of routedSite.filesTouched) {
              if (!filesTouched.includes(file)) filesTouched.push(file);
            }
          }
        } else {
          skipped = skipped.map((item) => {
            if (!routedBlocked.some((blocked) => blocked.key === item.key)) return item;
            return {
              key: item.key,
              reason: routedSite.reason === "ambiguous" ? "call_site_ambiguous" : "call_site_no_match"
            };
          });
        }
      }

      if (routedBlocked.length && previousText == null) {
        skipped = skipped.map((item) => (
          routedBlocked.some((blocked) => blocked.key === item.key)
            ? { key: item.key, reason: "call_site_no_previous" }
            : item
        ));
      }

      appliedCount += result.applied.length;
      skippedCount += skipped.filter((item) => item.reason !== "unchanged").length;
      details.push({
        sourceFile: resolvedPath,
        line: override.selector.line,
        type: override.selector.type,
        applied,
        skipped
      });
      const dropped = new Set([
        ...applied,
        ...skipped.filter((item) => item.reason === "unchanged").map((item) => item.key)
      ]);
      const kept = Object.fromEntries(
        Object.entries(override.props).filter(([key]) => !dropped.has(key))
      ) as Record<string, UiValue>;
      if (Object.keys(kept).length) {
        const identityText = (identityTextLatest != null ? String(identityTextLatest) : undefined)
          || (previousText != null ? String(previousText) : undefined)
          || (typeof override.identityText === "string" ? override.identityText : undefined);
        remaining.push({
          selector: { ...override.selector, sourceFile: resolvedPath },
          scope: "template",
          props: kept,
          ...(identityText ? { identityText } : {})
        });
      }
    }

    if (fileChanged && nextSource !== source) {
      writeProjectText(projectRoot, resolvedPath, nextSource);
      if (!filesTouched.includes(resolvedPath)) filesTouched.push(resolvedPath);
    }
  }

  return { overrides: remaining, filesTouched, appliedCount, skippedCount, details };
}

export function valuesEqualForWriteback(left: UiValue | undefined, right: UiValue | undefined): boolean {
  if (left === right) return true;
  if (left == null || right == null) return left === right;
  if (typeof left !== typeof right) return false;
  if (typeof left !== "object") return left === right;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function visitUiNodes(node: UiNode, visit: (node: UiNode) => void): void {
  visit(node);
  for (const child of node.children || []) visitUiNodes(child, visit);
}

/**
 * Diff an edited snapshot against a baseline (usually fresh Lua conversion).
 * Emits overrides only for concrete writable props that actually changed —
 * safe to freeze into project Lua without collapsing untouched `style.x or 12` defaults.
 * Nodes are matched by stable id first; file:line:type is used only when unique.
 */
export function collectDirtyLiteralOverrides(
  editedRoot: UiNode,
  baselineRoot: UiNode | undefined
): UiSidecarOverride[] {
  if (!baselineRoot) return [];
  const baselineById = new Map<string, UiNode>();
  const baselineBySelector = new Map<string, UiNode | null>();
  visitUiNodes(baselineRoot, (node) => {
    baselineById.set(node.id, node);
    const sourceFile = node.source?.file ? normalizeSourceFile(node.source.file) : "";
    const line = Number(node.source?.line || 0);
    if (!sourceFile || sourceFile === "runtime" || line <= 0) return;
    const key = `${sourceFile}:${line}:${node.type}`;
    if (baselineBySelector.has(key)) baselineBySelector.set(key, null);
    else baselineBySelector.set(key, node);
  });

  const overrides: UiSidecarOverride[] = [];
  visitUiNodes(editedRoot, (node) => {
    let baseline = baselineById.get(node.id);
    let selectorSource = node.source?.file ? normalizeSourceFile(node.source.file) : "";
    let selectorLine = Number(node.source?.line || 0);
    let selectorType = node.type;
    if (!baseline) {
      if (!selectorSource || selectorSource === "runtime" || selectorLine <= 0) {
        const idMatch = /^(.*?\.lua):(\d+):([A-Za-z_][A-Za-z0-9_]*):/i.exec(node.id);
        if (!idMatch?.[1] || !idMatch[2]) return;
        selectorSource = normalizeSourceFile(idMatch[1]);
        selectorLine = Number(idMatch[2]);
      }
      if (!Number.isInteger(selectorLine) || selectorLine <= 0) return;
      const key = `${selectorSource}:${selectorLine}:${selectorType}`;
      const candidate = baselineBySelector.get(key);
      if (!candidate) return;
      baseline = candidate;
    } else {
      if (!selectorSource || selectorSource === "runtime" || selectorLine <= 0) {
        selectorSource = baseline.source?.file ? normalizeSourceFile(baseline.source.file) : selectorSource;
        selectorLine = Number(baseline.source?.line || selectorLine);
      }
    }
    if (!selectorSource || selectorSource === "runtime" || selectorLine <= 0) return;

    const props: Record<string, UiValue> = {};
    for (const [propKey, value] of Object.entries(node.props || {})) {
      if (!WRITABLE_KEYS.has(propKey) || propKey.startsWith("$")) continue;
      if (value === undefined || isExpressionUiValue(value)) continue;
      const baselineValue = baseline.props?.[propKey];
      if (valuesEqualForWriteback(baselineValue, value)) continue;
      // Do not freeze expression-backed baselines unless the user set a concrete value
      // that differs — already ensured by valuesEqual (expression ≠ number).
      props[propKey] = value;
    }
    if (!Object.keys(props).length) return;
    overrides.push({
      selector: { sourceFile: selectorSource, line: selectorLine, type: selectorType },
      scope: "template",
      props
    });
  });
  return overrides;
}

export function collectLiteralPropsFromNode(node: UiNode): Record<string, UiValue> {
  const props: Record<string, UiValue> = {};
  for (const [key, value] of Object.entries(node.props || {})) {
    if (!WRITABLE_KEYS.has(key) || key.startsWith("$")) continue;
    if (value === undefined || isExpressionUiValue(value)) continue;
    props[key] = value;
  }
  return props;
}

export function writeBackUiTreeLiteralsToLua(
  projectRoot: string,
  root: UiNode
): { filesTouched: string[]; appliedCount: number; skippedCount: number } {
  const queue: UiNode[] = [root];
  const grouped = new Map<string, Array<{ line: number; type: string; props: Record<string, UiValue> }>>();
  while (queue.length) {
    const node = queue.shift()!;
    queue.push(...node.children);
    const sourceFile = node.source?.file ? normalizeSourceFile(node.source.file) : "";
    const line = Number(node.source?.line || 0);
    let resolvedFile = sourceFile;
    let resolvedLine = line;
    if (!resolvedFile || resolvedFile === "runtime" || !Number.isInteger(resolvedLine) || resolvedLine <= 0) {
      const idMatch = /^(.*?\.lua):(\d+):([A-Za-z_][A-Za-z0-9_]*):/i.exec(node.id);
      if (!idMatch?.[1] || !idMatch[2]) continue;
      resolvedFile = normalizeSourceFile(idMatch[1]);
      resolvedLine = Number(idMatch[2]);
      if (!Number.isInteger(resolvedLine) || resolvedLine <= 0) continue;
    }
    const props = collectLiteralPropsFromNode(node);
    if (!Object.keys(props).length) continue;
    const list = grouped.get(resolvedFile) || [];
    list.push({ line: resolvedLine, type: node.type, props });
    grouped.set(resolvedFile, list);
  }

  const filesTouched: string[] = [];
  let appliedCount = 0;
  let skippedCount = 0;

  for (const [sourceFile, patches] of grouped) {
    let resolvedPath: string;
    let source: string;
    try {
      const loaded = readProjectSource(projectRoot, sourceFile);
      resolvedPath = loaded.path;
      source = loaded.text;
    } catch {
      skippedCount += patches.reduce((sum, item) => sum + Object.keys(item.props).length, 0);
      continue;
    }
    let nextSource = source;
    let changed = false;
    for (const patch of patches) {
      // Tree walk must stay literals-only: IR may have folded `style.x or 12` → 12.
      const result = patchLuaWidgetLiterals(nextSource, { line: patch.line, type: patch.type }, patch.props, {
        replaceExpressions: false,
        insertMissingFields: false
      });
      appliedCount += result.applied.length;
      skippedCount += result.skipped.filter((item) => item.reason !== "unchanged").length;
      if (result.changed) {
        nextSource = result.text;
        changed = true;
      }
    }
    if (changed && nextSource !== source) {
      writeProjectText(projectRoot, resolvedPath, nextSource);
      filesTouched.push(resolvedPath);
    }
  }

  return { filesTouched, appliedCount, skippedCount };
}
