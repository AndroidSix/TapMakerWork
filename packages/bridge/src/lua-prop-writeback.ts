import luaparse, {
  type Expression,
  type Statement,
  type TableConstructorExpression,
  type TableKeyString
} from "luaparse";
import fs from "node:fs";
import path from "node:path";
import { isUiKitSourceFile, type UiNode, type UiValue } from "@tapmakerwork/protocol";
import { readProjectSource, writeProjectText } from "./project.js";
import type { UiSidecarOverride } from "./ui-sidecar.js";

export type LuaWritebackOverride = UiSidecarOverride & {
  previousProps?: Record<string, UiValue>;
  /** Editor node that produced this override — lets the Bridge revert live patches. */
  nodeId?: string;
  /** Pre-edit prop values per key; `null` = the prop was unset before the edit. */
  revertProps?: Record<string, UiValue | null>;
  /** Stable runtime identity (`props.$path`). Instance overrides replay through this. */
  instancePath?: string;
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
  /** Pre-edit props (evaluated). Used to rewrite `contentTop + N` by delta. */
  previousProps?: Record<string, UiValue>;
}

export interface LuaOverridesWritebackDetail {
  sourceFile: string;
  line: number;
  type: string;
  applied: string[];
  skipped: LuaPropWritebackSkip[];
  nodeId?: string;
  /** Stable runtime identity copied from the live widget, when the snapshot had one. */
  instancePath?: string;
  /** Live values to restore for props that could not be persisted (`null` = was unset). */
  revert?: Record<string, UiValue | null>;
}

export interface LuaOverridesWritebackSummary {
  overrides: UiSidecarOverride[];
  filesTouched: string[];
  appliedCount: number;
  skippedCount: number;
  details: LuaOverridesWritebackDetail[];
}

/** Skip reasons that leave the live Runtime ahead of game Lua — must never be replayed. */
export const UNDURABLE_SKIP_REASONS = new Set([
  "opts_passthrough",
  "geometry_no_insert",
  "measured_geometry",
  "layout_expression",
  "container_forbidden",
  "font_overflow",
  "widget_not_found",
  "nearby_no_insert",
  "nearby_skip",
  "field_missing",
  "insert_failed",
  "call_site_no_match",
  "call_site_ambiguous",
  "call_site_no_previous",
  "kit_internal_geometry",
  "syntax_rejected"
]);

const WRITABLE_KEYS = new Set([
  "text", "title", "visible", "width", "height", "left", "top", "right", "bottom",
  "fontSize", "fontColor", "textColor", "backgroundColor", "borderColor",
  "backgroundImage", "backgroundFit", "path",
  "borderRadius", "borderWidth", "opacity", "zIndex", "position",
  "flexGrow", "flexShrink", "flexDirection", "flexWrap", "flexBasis",
  "justifyContent", "alignItems", "alignSelf", "gap",
  "padding", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight",
  "margin", "marginTop", "marginBottom", "marginLeft", "marginRight",
  "minWidth", "minHeight", "maxWidth", "maxHeight", "overflow", "display",
  // Inspector + canvas transform tools (must persist — same class as backgroundImage)
  "rotate", "transform",
  // Common Label/layout props present in project Lua
  "textAlign", "verticalAlign", "whiteSpace", "pointerEvents", "boxShadow",
  // UiStyle kit call-site keys
  "bg", "rim", "color", "fontWeight"
]);

/** Props the Studio inspector / canvas tools can edit — must stay ⊆ WRITABLE_KEYS. */
export const INSPECTOR_EDITABLE_KEYS = [
  "position", "left", "top", "width", "height", "rotate", "transform",
  "gap", "flexDirection",
  "text", "fontSize", "backgroundImage", "color", "fontColor", "textColor",
  "opacity", "backgroundColor", "borderRadius"
] as const;

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

/**
 * Layout roots like lobbyBlock / attrUI / metaBar — many children, no kit face.
 * Writing backgroundImage/color here paints the whole screen and "gaps get worse".
 */
function isLayoutContainerTable(table: TableConstructorExpression): boolean {
  const children = fieldByKey(table, "children");
  if (!children || children.value.type !== "TableConstructorExpression") return false;
  const childCount = children.value.fields.filter((field) => field.type === "TableValue").length;
  if (childCount < 2) return false;
  const hasKitFace = Boolean(
    fieldByKey(table, "bg")
    || fieldByKey(table, "rim")
    || fieldByKey(table, "title")
    || fieldByKey(table, "text")
    || fieldByKey(table, "onClick")
  );
  return !hasKitFace;
}

const CONTAINER_FORBIDDEN_KEYS = new Set([
  "backgroundImage", "backgroundFit", "path",
  "color", "fontColor", "textColor", "fontSize", "fontWeight",
  "rotate", "transform"
]);

/** Value Label fontSize larger than its box overflows onto sibling lines in UpgradeCard. */
function looksLikeFontOverflow(
  key: string,
  value: UiValue,
  previousProps: Record<string, UiValue> | undefined,
  table: TableConstructorExpression
): boolean {
  if (key !== "fontSize" || typeof value !== "number" || !Number.isFinite(value)) return false;
  const heightField = fieldByKey(table, "height");
  let height: number | undefined;
  if (heightField && isSafeLiteralAst(heightField.value) && heightField.value.type === "NumericLiteral") {
    height = heightField.value.value;
  } else if (typeof previousProps?.height === "number") {
    height = previousProps.height;
  }
  if (typeof height === "number" && value > height) return true;
  const previous = previousProps?.fontSize;
  if (typeof previous === "number" && value - previous >= 12 && (height == null || value > height * 0.85)) {
    return true;
  }
  return false;
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
  const typeAliases = (type: string): string[] => {
    if (type === "Panel") return ["Panel", "Button"];
    if (type === "Button") return ["Button", "Panel"];
    return [type];
  };
  const wanted = typeAliases(selector.type);

  const exact = widgets.filter((item) => item.line === selector.line && wanted.includes(item.type));
  if (exact.length === 1) return { ...exact[0]!, match: "exact" };
  // Prefer kit Button/Panel call site when a raw Panel and Button share the line.
  if (exact.length > 1) {
    const kit = exact.filter((item) => item.type === "Button" || /card|chip|bar$/i.test(item.type));
    if (kit.length === 1) return { ...kit[0]!, match: "exact" };
    return undefined;
  }

  // Runtime AddChild often records a parent Panel line while the edited node is a
  // nested Label/Button a few lines below — search inside that anchor's range.
  const anchors = widgets.filter((item) => item.line === selector.line);
  for (const anchor of anchors) {
    const range = (anchor.table as Located).range ?? anchor.call.range;
    if (!range) continue;
    const nested = widgets.filter((item) => {
      if (!wanted.includes(item.type) || item === anchor) return false;
      const itemRange = item.call.range;
      return Boolean(itemRange && itemRange[0] >= range[0] && itemRange[1] <= range[1]);
    });
    if (nested.length === 1) return { ...nested[0]!, match: "nested" };
  }

  // Line numbers drift when earlier edits insert/delete lines (e.g. color = …).
  // Match kit call sites (PrimaryButton→Button) within a tight window — including
  // Panel↔Button alias — so ad-button fills are not stranded in .ui.json overrides.
  const nearby = widgets
    .filter((item) => wanted.includes(item.type) && Math.abs(item.line - selector.line) <= 6)
    .sort((left, right) => {
      const lineDelta = Math.abs(left.line - selector.line) - Math.abs(right.line - selector.line);
      if (lineDelta !== 0) return lineDelta;
      // Prefer kit buttons/cards over generic absolute Panels (staminaRow, etc.).
      const score = (item: typeof left) => (
        item.type === "Button" || fieldByKey(item.table, "bg") || fieldByKey(item.table, "rim") ? 0 : 1
      );
      return score(left) - score(right);
    });
  if (nearby.length === 1) return { ...nearby[0]!, match: "nearby" };
  if (nearby.length > 1 && nearby[0]) {
    const best = nearby[0];
    const second = nearby[1];
    const bestDist = Math.abs(best.line - selector.line);
    const secondDist = second ? Math.abs(second.line - selector.line) : Infinity;
    // Unique closest, or unique kit-colored among closest distance.
    if (bestDist < secondDist) return { ...best, match: "nearby" };
    const sameDist = nearby.filter((item) => Math.abs(item.line - selector.line) === bestDist);
    const kitish = sameDist.filter((item) => (
      item.type === "Button" || fieldByKey(item.table, "bg") || fieldByKey(item.table, "rim")
    ));
    if (kitish.length === 1) return { ...kitish[0]!, match: "nearby" };
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
        "borderRadius", "padding", "margin", "visible",
        "backgroundImage", "backgroundFit", "path",
        "rotate", "transform", "opacity", "textAlign", "verticalAlign", "whiteSpace"
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

/**
 * Live Yoga often reports parent-relative left/top (0, -4) while Lua stores design math
 * (`contentTop + 470`, `CARD_LEFT + …`). Freezing those into literals breaks restart layout.
 */
const LAYOUT_GEOMETRY_KEYS = new Set([
  "left", "top", "right", "bottom", "width", "height", "position"
]);

function expressionLooksLikeLayoutMath(expression: Expression): boolean {
  if (isSafeLiteralAst(expression)) return false;
  if (expressionLooksLikeFactoryLocal(expression)) return false;
  // style.x / theme.x are design tokens users intentionally freeze in the inspector.
  if (expression.type === "MemberExpression" && expression.indexer === ".") {
    let base: Expression = expression;
    while (base.type === "MemberExpression") base = base.base;
    if (base.type === "Identifier" && /^(style|theme|options|opts)$/.test(base.name)) {
      return false;
    }
  }
  switch (expression.type) {
    case "BinaryExpression":
    case "LogicalExpression":
    case "Identifier":
    case "MemberExpression":
    case "CallExpression":
    case "IndexExpression":
      return true;
    case "UnaryExpression":
      return !(expression.operator === "-" && expression.argument.type === "NumericLiteral");
    default:
      return false;
  }
}

/** `contentTop + 470` / `attrTop - 7` / `470 + contentTop` — adjustable design offsets. */
function parseAdditiveLayoutOffset(expression: Expression): {
  id: string;
  offset: number;
  idFirst: boolean;
} | undefined {
  if (expression.type !== "BinaryExpression") return undefined;
  if (expression.operator !== "+" && expression.operator !== "-") return undefined;
  const sign = expression.operator === "-" ? -1 : 1;
  const { left, right } = expression;
  if (left.type === "Identifier" && right.type === "NumericLiteral" && Number.isFinite(right.value)) {
    return { id: left.name, offset: sign * right.value, idFirst: true };
  }
  if (expression.operator === "+" && right.type === "Identifier" && left.type === "NumericLiteral" && Number.isFinite(left.value)) {
    return { id: right.name, offset: left.value, idFirst: false };
  }
  return undefined;
}

function formatLayoutOffset(id: string, offset: number, idFirst: boolean): string {
  if (offset === 0) return id;
  const magnitude = Math.abs(offset);
  if (!idFirst) return offset >= 0 ? `${offset} + ${id}` : `${id} - ${magnitude}`;
  return offset >= 0 ? `${id} + ${magnitude}` : `${id} - ${magnitude}`;
}

/** `(expr) ± N` from a previous save. Replace N instead of wrapping again. */
function peelWrappedDelta(sourceSlice: string): { inner: string; offset: number } | undefined {
  const match = /^\(([\s\S]+)\)\s*([+-])\s*(\d+)$/.exec(sourceSlice.trim());
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  let depth = 0;
  for (const char of match[1]) {
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth < 0) return undefined;
    }
  }
  if (depth !== 0) return undefined;
  const offset = (match[2] === "-" ? -1 : 1) * Number(match[3]);
  if (!Number.isFinite(offset)) return undefined;
  return { inner: match[1], offset };
}

/**
 * Keep `contentTop + N` form: shift N by (newAbsolute - previousAbsolute).
 * Also used so Layout()'s `local pvpTop = contentTop + 546` stays in sync.
 * Pure identifiers (`CARD_LEFT`) become `CARD_LEFT + Δ`. Complex trees get `(expr) ± Δ`.
 */
function rewriteLayoutMathExpression(
  expression: Expression,
  sourceSlice: string,
  newAbsolute: number,
  previousAbsolute: number | undefined
): string | undefined {
  if (typeof newAbsolute !== "number" || !Number.isFinite(newAbsolute)) return undefined;
  if (typeof previousAbsolute !== "number" || !Number.isFinite(previousAbsolute)) return undefined;
  const delta = Math.round(newAbsolute - previousAbsolute);
  if (delta === 0) return undefined;

  const parsed = parseAdditiveLayoutOffset(expression);
  if (parsed) return formatLayoutOffset(parsed.id, parsed.offset + delta, parsed.idFirst);
  if (expression.type === "Identifier") {
    return formatLayoutOffset(expression.name, delta, true);
  }
  const wrapped = peelWrappedDelta(sourceSlice);
  if (wrapped) return formatLayoutOffset(`(${wrapped.inner})`, wrapped.offset + delta, true);
  // CARD_LEFT + CARD_W + … — keep tree, append delta.
  if (expressionLooksLikeLayoutMath(expression) && sourceSlice.trim()) {
    return formatLayoutOffset(`(${sourceSlice.trim()})`, delta, true);
  }
  return undefined;
}

/** @deprecated use rewriteLayoutMathExpression */
function rewriteAdditiveLayoutOffset(
  expression: Expression,
  newAbsolute: number,
  previousAbsolute: number | undefined
): string | undefined {
  return rewriteLayoutMathExpression(expression, "", newAbsolute, previousAbsolute);
}

/**
 * Copy a rewritten expression onto the same text elsewhere (Layout aliases).
 * Bare names are also declarations (`local topPad = ...`). Replacing those
 * yields `local topPad + 18 = ...` and the game will not start.
 */
function replaceExpressionAlias(source: string, from: string, to: string): string {
  const needle = from.trim();
  const replacement = to.trim();
  if (!needle || needle === replacement) return source;
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(needle)) return source;
  let result = "";
  let index = 0;
  while (index < source.length) {
    const found = source.indexOf(needle, index);
    if (found < 0) {
      result += source.slice(index);
      break;
    }
    const before = found > 0 ? source[found - 1] ?? "" : "";
    const after = source[found + needle.length] ?? "";
    const boundaryBefore = before === "" || /[^A-Za-z0-9_]/.test(before);
    const boundaryAfter = after === "" || /[^A-Za-z0-9_]/.test(after);
    if (boundaryBefore && boundaryAfter) result += source.slice(index, found) + replacement;
    else result += source.slice(index, found + needle.length);
    index = found + needle.length;
  }
  return result;
}

function luaSourceParses(source: string): boolean {
  try {
    luaparse.parse(source, { luaVersion: "5.1" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parent-relative drag / Yoga chrome measurements must not overwrite design literals.
 * e.g. left 80→3, width 560→554, height 64→58.
 */
function looksLikeMeasuredGeometry(
  key: string,
  next: UiValue,
  previous: UiValue | undefined
): boolean {
  if (typeof next !== "number" || typeof previous !== "number") return false;
  if (!Number.isFinite(next) || !Number.isFinite(previous)) return false;
  if (key === "left" || key === "top" || key === "right" || key === "bottom") {
    if (Math.abs(next) <= 16 && Math.abs(previous) >= 40) return true;
  }
  if (key === "width" || key === "height") {
    const shrink = previous - next;
    if (shrink > 0 && shrink <= 12) return true;
  }
  return false;
}

/**
 * A card drag must not shrink the row that holds every card.
 * 720→190 and left 0→277 is one child's box landing on the parent.
 */
function looksLikeContainerBoxOverwrite(
  key: string,
  next: UiValue,
  previous: UiValue | undefined,
  table: TableConstructorExpression
): boolean {
  if (!isLayoutContainerTable(table)) return false;
  if (typeof next !== "number" || !Number.isFinite(next)) return false;
  if (typeof previous !== "number" || !Number.isFinite(previous)) return false;
  if (key === "width" || key === "height") return previous >= 200 && next > 0 && next <= previous * 0.6;
  if (key === "left" || key === "right") return Math.abs(previous) <= 8 && Math.abs(next) >= 40;
  return false;
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
  // UpgradeCard call sites expose `title`, not `text` — inspector "文字" must map over.
  if (
    table
    && next.text !== undefined
    && next.title === undefined
    && fieldByKey(table, "title")
    && !fieldByKey(table, "text")
  ) {
    next.title = next.text;
    delete next.text;
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
  const previousProps = options.previousProps;
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
    : (
      // Even without bg/rim, UpgradeCard-style tables with title need text→title.
      fieldByKey(widget.table, "title") && !fieldByKey(widget.table, "text")
        ? remapPropsForCallSiteTable(props, widget.table, undefined)
        : props
    );
  const replacements: Array<{ start: number; end: number; text: string; key: string }> = [];
  const expressionAliases: Array<{ from: string; to: string }> = [];

  for (const [key, value] of Object.entries(remappedProps)) {
    if (!WRITABLE_KEYS.has(key) || key.startsWith("$")) {
      skipped.push({ key, reason: "key_not_writable" });
      continue;
    }
    if (value === undefined || isExpressionUiValue(value as UiValue)) {
      skipped.push({ key, reason: "value_not_literal" });
      continue;
    }
    // Reject Yoga chrome / parent-relative measurements (80→3, 560→554).
    if (
      LAYOUT_GEOMETRY_KEYS.has(key)
      && looksLikeMeasuredGeometry(key, value, previousProps?.[key])
    ) {
      skipped.push({ key, reason: "measured_geometry" });
      continue;
    }
    // Never paint backgroundImage/color onto lobbyBlock-style containers,
    // and never shrink that row down to a single child's box.
    if (
      (CONTAINER_FORBIDDEN_KEYS.has(key) && isLayoutContainerTable(widget.table))
      || looksLikeContainerBoxOverwrite(key, value, previousProps?.[key], widget.table)
    ) {
      skipped.push({ key, reason: "container_forbidden" });
      continue;
    }
    if (looksLikeFontOverflow(key, value, previousProps, widget.table)) {
      skipped.push({ key, reason: "font_overflow" });
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
      // Never invent absolute geometry on widgets that never had any —
      // Yoga parent-relative coords otherwise freeze into flex Labels forever.
      // If the table (or previousProps) already has position/left/top, allow
      // completing the set (e.g. relative → absolute + left/top).
      if (LAYOUT_GEOMETRY_KEYS.has(key)) {
        const tableHasGeom = Boolean(
          fieldByKey(widget.table, "position")
          || fieldByKey(widget.table, "left")
          || fieldByKey(widget.table, "top")
        );
        const previousHadGeom = Boolean(
          previousProps
          && (previousProps.position !== undefined
            || previousProps.left !== undefined
            || previousProps.top !== undefined)
        );
        if (!tableHasGeom && !previousHadGeom) {
          skipped.push({ key, reason: "geometry_no_insert" });
          continue;
        }
      }
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
      // Factory passthrough / kit locals must stay dynamic.
      if (
        expressionLooksLikeOptsPassthrough(source, field.value)
        || expressionLooksLikeFactoryLocal(field.value)
      ) {
        skipped.push({ key, reason: "opts_passthrough" });
        continue;
      }
      // Shared Assets/Colors refs: freeze on instance tables, never inside factories.
      if (expressionLooksLikeSharedConstant(field.value) && factoryTemplate) {
        skipped.push({ key, reason: "opts_passthrough" });
        continue;
      }
      // Rewrite `contentTop + N` by drag delta; sync Layout() aliases later.
      if (LAYOUT_GEOMETRY_KEYS.has(key) && expressionLooksLikeLayoutMath(field.value)) {
        const previousAbsolute = previousProps?.[key];
        const [start, end] = valueNode.range;
        const from = source.slice(start, end);
        const rewritten = typeof value === "number"
          ? rewriteLayoutMathExpression(
            field.value,
            from,
            value,
            typeof previousAbsolute === "number" ? previousAbsolute : undefined
          )
          : undefined;
        if (!rewritten) {
          skipped.push({ key, reason: "layout_expression" });
          continue;
        }
        if (from === rewritten) {
          skipped.push({ key, reason: "unchanged" });
          continue;
        }
        expressionAliases.push({ from, to: rewritten });
        replacements.push({ start, end, text: rewritten, key });
        continue;
      }
      // nearby + non-literal: only freeze Assets.* on the matched instance Label/Panel.
      if (widget.match === "nearby" && !literalAst) {
        if (expressionLooksLikeOptsPassthrough(source, field.value) || expressionLooksLikeFactoryLocal(field.value)) {
          skipped.push({ key, reason: "opts_passthrough" });
          continue;
        }
        if (!expressionLooksLikeSharedConstant(field.value)) {
          skipped.push({ key, reason: "nearby_skip" });
          continue;
        }
      }
    } else if (literalAst === false && LAYOUT_GEOMETRY_KEYS.has(key) && expressionLooksLikeLayoutMath(field.value)) {
      skipped.push({ key, reason: "layout_expression" });
      continue;
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
  // Keep Layout() `local pvpTop = contentTop + 546` in sync with Build() call sites.
  // Never rewrite a bare identifier: that also rewrites `local topPad = ...`.
  for (const alias of expressionAliases) {
    if (alias.from && alias.to && alias.from !== alias.to) {
      text = replaceExpressionAlias(text, alias.from, alias.to);
    }
  }
  if (!luaSourceParses(text) && luaSourceParses(source)) {
    const rejected = [...new Set(applied)];
    return {
      applied: [],
      skipped: [
        ...skipped,
        ...rejected.map((key) => ({ key, reason: "syntax_rejected" }))
      ],
      text: source,
      changed: false
    };
  }
  return { applied, skipped, text, changed: applied.length > 0 || text !== source };
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
  nextText: string,
  preferredFile?: string
): CallSiteTextWritebackResult {
  if (!previousText) return { filesTouched: [], appliedCount: 0, reason: "empty" };
  if (previousText === nextText) return { filesTouched: [], appliedCount: 0, reason: "unchanged" };
  const preferred = preferredFile && !isKitDefinitionFile(preferredFile)
    ? normalizeSourceFile(preferredFile)
    : undefined;
  const uiFiles = listUiLuaFiles(projectRoot).filter((relative) => (
    !preferred || filePathMatches(relative, preferred)
  ));
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
  id?: UiValue;
  /** Prefer this UI lua file when Assets.* matches multiple screens. */
  preferredFile?: string;
  /** Disambiguate sibling PrimaryButtons that share left/width/height. */
  bg?: UiValue;
  backgroundColor?: UiValue;
};

function filePathMatches(relative: string, filter?: string): boolean {
  if (!filter) return true;
  const a = normalizeSourceFile(relative);
  const b = normalizeSourceFile(filter);
  return a === b || a.endsWith("/" + b) || b.endsWith("/" + a);
}

/** UiStyle.lua (and similar) only define factories — never use them as instance preferredFile. */
function isKitDefinitionFile(relative: string): boolean {
  return isUiKitSourceFile(normalizeSourceFile(relative));
}

/**
 * Kit-internal parts (UiStyle Label inside PrimaryButton / UpgradeCard) have no
 * per-instance Lua table: geometry written into the factory would move every
 * button in the game. Labels with an explicit `id` are real instances and stay.
 */
function splitKitInternalGeometry(
  sourceFile: string,
  override: LuaWritebackOverride
): { props: Record<string, UiValue>; skipped: LuaPropWritebackSkip[] } {
  const hasInstanceId = typeof override.previousProps?.id === "string" && override.previousProps.id !== "";
  if (!isKitDefinitionFile(sourceFile) || hasInstanceId) return { props: override.props, skipped: [] };
  const props: Record<string, UiValue> = {};
  const skipped: LuaPropWritebackSkip[] = [];
  for (const [key, value] of Object.entries(override.props)) {
    if (LAYOUT_GEOMETRY_KEYS.has(key)) skipped.push({ key, reason: "kit_internal_geometry" });
    else props[key] = value;
  }
  return { props, skipped };
}

function pickUniqueCallSiteHits<T extends { file: string; kitScore: number }>(
  hits: T[],
  preferred?: string
): T[] {
  let next = hits;
  if (next.length > 1) {
    const maxKit = Math.max(...next.map((hit) => hit.kitScore));
    if (maxKit > 0) {
      const kitHits = next.filter((hit) => hit.kitScore === maxKit);
      if (kitHits.length >= 1) next = kitHits;
    }
  }
  if (next.length > 1 && preferred && !isKitDefinitionFile(preferred)) {
    const scoped = next.filter((hit) => filePathMatches(hit.file, preferred));
    if (scoped.length >= 1) next = scoped;
  }
  if (next.length > 1) {
    const byFile = new Map<string, T[]>();
    for (const hit of next) {
      const list = byFile.get(hit.file) || [];
      list.push(hit);
      byFile.set(hit.file, list);
    }
    const singletons = [...byFile.values()].filter((list) => list.length === 1);
    if (singletons.length === 1) return singletons[0]!;
    const mainHud = byFile.get("scripts/ui/MainHUD.lua");
    if (mainHud?.length === 1) return mainHud;
  }
  return next;
}

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
  if (hints?.id !== undefined && literalFieldEquals(source, table, "id", hints.id)) {
    return true;
  }
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
  const bgHint = hints?.bg ?? hints?.backgroundColor;
  const bgMatched = bgHint === undefined
    || literalFieldEquals(source, table, "bg", bgHint)
    || literalFieldEquals(source, table, "rim", bgHint);

  if (textMatched) return true;
  // Stale identityText after a prior text edit: fall back to unique layout among kit call sites.
  // Require bg when present so sibling PrimaryButtons (same left/width/height) do not collide.
  if (options?.allowLayoutOnly && layoutMatched && bgMatched) return true;
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

  type Hit = {
    file: string;
    table: TableConstructorExpression;
    source: string;
    key: "text" | "title";
    kitScore: number;
  };
  const kitScore = (table: TableConstructorExpression) => (
    (fieldByKey(table, "bg") || fieldByKey(table, "rim") ? 2 : 0)
    + (fieldByKey(table, "title") ? 1 : 0)
    + (fieldByKey(table, "onClick") ? 1 : 0)
  );
  const collect = (allowLayoutOnly: boolean, fileFilter?: string): Hit[] => {
    const hits: Hit[] = [];
    for (const relative of listUiLuaFiles(projectRoot)) {
      if (fileFilter && normalizeSourceFile(relative) !== normalizeSourceFile(fileFilter)
        && !normalizeSourceFile(relative).endsWith("/" + normalizeSourceFile(fileFilter))
        && !normalizeSourceFile(fileFilter).endsWith("/" + normalizeSourceFile(relative))) {
        continue;
      }
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
        hits.push({ file: relative, table: widget.table, source, key, kitScore: kitScore(widget.table) });
      }
    }
    return hits;
  };
  const preferredRaw = hints?.preferredFile ? normalizeSourceFile(hints.preferredFile) : undefined;
  const preferred = preferredRaw && !isKitDefinitionFile(preferredRaw) ? preferredRaw : undefined;
  let hits = preferred ? collect(false, preferred) : [];
  if (hits.length === 0) hits = collect(false);
  if (hits.length === 0 && preferred) hits = collect(true, preferred);
  if (hits.length === 0) hits = collect(true);
  if (hits.length > 1 && hints) {
    const tight = hits.filter((hit) => callSiteIdentityMatch(
      projectRoot, hit.source, hit.table, previousText, hints, { allowLayoutOnly: false }
    ));
    if (tight.length >= 1) hits = tight;
  }
  hits = pickUniqueCallSiteHits(hits, preferred ?? preferredRaw);
  if (hits.length === 0) return { filesTouched: [], appliedCount: 0, reason: "no_match" };
  if (hits.length !== 1) return { filesTouched: [], appliedCount: 0, reason: "ambiguous" };

  const hit = hits[0]!;
  let next = hit.source;
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
 * Title / HUD labels are often built earlier (`UI.Label { id = "hudLevel" }`) then
 * parented via `children = { levelLabel }` — runtime source points at the parent line
 * (Label@316) so direct table match fails. Display text is also refreshed with
 * `refs.levelLabel:SetText(Assets.Title .. " · " .. Assets.Subtitle)`.
 * Persist by freezing the Label table (id/text) and rewriting matching SetText args.
 */
export function writeBackLabelDisplayText(
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

  const assets = loadAssetStringAssignments(projectRoot);
  const evalConcat = (expression: Expression): string | undefined => {
    const walk = (node: Expression): string | undefined => {
      if (node.type === "StringLiteral") {
        const anyNode = node as { value?: string; raw?: string };
        if (typeof anyNode.value === "string") return anyNode.value;
        if (typeof anyNode.raw === "string" && anyNode.raw.length >= 2) {
          return anyNode.raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, "\n");
        }
        return undefined;
      }
      if (node.type === "NumericLiteral") return String((node as { value?: number }).value ?? "");
      const ref = memberPath(node);
      if (ref) return assets.get(ref);
      if (node.type === "BinaryExpression" && node.operator === "..") {
        const left = walk(node.left);
        const right = walk(node.right);
        if (left === undefined || right === undefined) return undefined;
        return left + right;
      }
      return undefined;
    };
    return walk(expression);
  };

  let appliedCount = 0;
  const filesTouched: string[] = [];
  const preferredRaw = hints?.preferredFile ? normalizeSourceFile(hints.preferredFile) : undefined;
  const preferred = preferredRaw && !isKitDefinitionFile(preferredRaw) ? preferredRaw : undefined;
  // Factory-sourced edits must not rewrite SetText on every screen.
  const softPreferred = preferred
    ?? (preferredRaw && isKitDefinitionFile(preferredRaw) ? "scripts/ui/MainHUD.lua" : undefined);
  const fileMatches = (relative: string) => filePathMatches(relative, softPreferred);

  type PendingFile = { file: string; next: string; applied: number };
  const pendingFiles: PendingFile[] = [];

  for (const relative of listUiLuaFiles(projectRoot)) {
    // Title/Subtitle labels are shared across screens — never broadcast one edit project-wide
    // unless preferred is unset (and then we uniquify after the scan).
    if (softPreferred && !fileMatches(relative)) continue;
    let source: string;
    try {
      source = readProjectSource(projectRoot, relative).text;
    } catch {
      continue;
    }
    let next = source;
    let fileApplied = 0;

    // 1) Freeze UI.Label { id = … } / unique text match
    const titleDotSubtitle = (() => {
      const title = assets.get("Assets.Title");
      const subtitle = assets.get("Assets.Subtitle");
      if (title == null || subtitle == null) return undefined;
      return `${title} · ${subtitle}`;
    })();
    const labelHits = findWidgetTables(next).filter((widget) => {
      if (widget.type !== "Label" || isFactoryTemplateTable(next, widget.table)) return false;
      if (hints?.id !== undefined && literalFieldEquals(next, widget.table, "id", hints.id)) return true;
      if (callSiteIdentityMatch(projectRoot, next, widget.table, previousText, hints)) return true;
      // Runtime shows Title · Subtitle while the table still has text = Assets.Title
      if (titleDotSubtitle && previousText === titleDotSubtitle) {
        const field = fieldByKey(widget.table, "text");
        const ref = field ? memberPath(field.value) : undefined;
        if (ref === "Assets.Title" && (hints?.id !== undefined || softPreferred)) return true;
      }
      return false;
    });
    // Prefer id hit; else unique text hit in this file only
    let labelHit = hints?.id !== undefined
      ? labelHits.find((widget) => literalFieldEquals(next, widget.table, "id", hints.id))
      : undefined;
    if (!labelHit && labelHits.length === 1) labelHit = labelHits[0];
    if (labelHit) {
      const field = fieldByKey(labelHit.table, "text");
      const valueNode = field?.value as (Expression & Located) | undefined;
      if (valueNode?.range) {
        const [start, end] = valueNode.range;
        if (next.slice(start, end) !== replacement) {
          next = `${next.slice(0, start)}${replacement}${next.slice(end)}`;
          fileApplied += 1;
        }
      }
    }

    // 2) Rewrite SetText(…) whose evaluated arg equals previousText (Title · Subtitle)
    let body: Statement[];
    try {
      const ast = luaparse.parse(next, { locations: true, ranges: true, luaVersion: "5.3", encodingMode: "none" });
      body = ast.body;
    } catch {
      body = [];
    }
    const setTextHits: Array<{ start: number; end: number }> = [];
    const visitExpr = (expression: Expression) => {
      if (expression.type === "CallExpression" || expression.type === "TableCallExpression") {
        const callee = expression.type === "CallExpression" ? expression.base : expression.base;
        const name = calleeName(callee);
        if (/\.SetText$|:SetText$|SetText$/i.test(name) || (callee.type === "MemberExpression" && callee.indexer === ":" && callee.identifier.name === "SetText")) {
          const args = expression.type === "CallExpression" ? expression.arguments : [expression.arguments];
          const first = args[0];
          if (first && (first as Expression & Located).range) {
            const evaluated = evalConcat(first as Expression);
            if (evaluated === previousText) {
              const range = (first as Expression & Located).range!;
              setTextHits.push({ start: range[0], end: range[1] });
            }
          }
        }
      }
      switch (expression.type) {
        case "CallExpression":
          for (const arg of expression.arguments) visitExpr(arg);
          visitExpr(expression.base);
          break;
        case "TableCallExpression":
          visitExpr(expression.base);
          if (expression.arguments.type === "TableConstructorExpression") {
            for (const field of expression.arguments.fields) {
              if (field.type === "TableKeyString" || field.type === "TableValue") visitExpr(field.value);
              else if (field.type === "TableKey") {
                visitExpr(field.key);
                visitExpr(field.value);
              }
            }
          }
          break;
        case "MemberExpression":
          visitExpr(expression.base);
          break;
        case "BinaryExpression":
        case "LogicalExpression":
          visitExpr(expression.left);
          visitExpr(expression.right);
          break;
        case "UnaryExpression":
          visitExpr(expression.argument);
          break;
        case "TableConstructorExpression":
          for (const field of expression.fields) {
            if (field.type === "TableKeyString" || field.type === "TableValue") visitExpr(field.value);
            else if (field.type === "TableKey") {
              visitExpr(field.key);
              visitExpr(field.value);
            }
          }
          break;
        default:
          break;
      }
    };
    const visitStmt = (statement: Statement) => {
      switch (statement.type) {
        case "CallStatement":
          visitExpr(statement.expression);
          break;
        case "AssignmentStatement":
          for (const init of statement.init) if (init) visitExpr(init);
          break;
        case "LocalStatement":
          for (const init of statement.init) if (init) visitExpr(init);
          break;
        case "ReturnStatement":
          for (const arg of statement.arguments) visitExpr(arg);
          break;
        case "IfStatement":
          for (const clause of statement.clauses) {
            if ("condition" in clause && clause.condition) visitExpr(clause.condition);
            for (const bodyStmt of clause.body) visitStmt(bodyStmt);
          }
          break;
        case "WhileStatement":
        case "RepeatStatement":
          visitExpr(statement.condition);
          for (const bodyStmt of statement.body) visitStmt(bodyStmt);
          break;
        case "DoStatement":
        case "FunctionDeclaration":
          for (const bodyStmt of statement.body) visitStmt(bodyStmt);
          break;
        case "ForNumericStatement":
        case "ForGenericStatement":
          for (const bodyStmt of statement.body) visitStmt(bodyStmt);
          break;
        default:
          break;
      }
    };
    for (const statement of body) visitStmt(statement);

    if (setTextHits.length === 1) {
      const hit = setTextHits[0]!;
      if (next.slice(hit.start, hit.end) !== replacement) {
        next = `${next.slice(0, hit.start)}${replacement}${next.slice(hit.end)}`;
        fileApplied += 1;
      }
    }

    if (fileApplied > 0) {
      pendingFiles.push({ file: relative, next, applied: fileApplied });
    }
  }

  if (pendingFiles.length === 0) {
    return { filesTouched: [], appliedCount: 0, reason: "no_match" };
  }
  let chosen = pendingFiles;
  if (chosen.length > 1) {
    if (preferred) {
      return { filesTouched: [], appliedCount: 0, reason: "ambiguous" };
    }
    const mainHud = chosen.filter((item) => normalizeSourceFile(item.file) === "scripts/ui/MainHUD.lua");
    if (mainHud.length !== 1) {
      return { filesTouched: [], appliedCount: 0, reason: "ambiguous" };
    }
    chosen = mainHud;
  }
  for (const item of chosen) {
    writeProjectText(projectRoot, item.file, item.next);
    filesTouched.push(item.file);
    appliedCount += item.applied;
  }

  if (appliedCount > 0) return { filesTouched, appliedCount, reason: "ok" };
  return { filesTouched: [], appliedCount: 0, reason: "no_match" };
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
  // Will remap text→title per-table in the write loop via remapPropsForCallSiteTable.

  type Hit = { file: string; range: [number, number]; kitScore: number };
  const kitScore = (table: TableConstructorExpression) => (
    (fieldByKey(table, "bg") || fieldByKey(table, "rim") ? 2 : 0)
    + (fieldByKey(table, "title") ? 1 : 0)
    + (fieldByKey(table, "onClick") ? 1 : 0)
  );
  const fileMatches = (relative: string, filter?: string) => {
    if (!filter) return true;
    const a = normalizeSourceFile(relative);
    const b = normalizeSourceFile(filter);
    return a === b || a.endsWith("/" + b) || b.endsWith("/" + a);
  };
  const collectHits = (allowLayoutOnly: boolean, fileFilter?: string): Hit[] => {
    const hits: Hit[] = [];
    for (const relative of listUiLuaFiles(projectRoot)) {
      if (!fileMatches(relative, fileFilter)) continue;
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
        hits.push({ file: relative, range: [range[0], range[1]], kitScore: kitScore(widget.table) });
      }
    }
    return hits;
  };
  const preferredRaw = hints?.preferredFile ? normalizeSourceFile(hints.preferredFile) : undefined;
  const preferred = preferredRaw && !isKitDefinitionFile(preferredRaw) ? preferredRaw : undefined;
  // When preferred is UiStyle (factory), skip it — instance edits belong on call sites.
  let hits = preferred ? collectHits(false, preferred) : [];
  if (hits.length === 0) hits = collectHits(false);
  if (hits.length === 0 && preferred) hits = collectHits(true, preferred);
  if (hits.length === 0) hits = collectHits(true);
  if (hits.length > 1 && hints) {
    const filtered = hits.filter((hit) => {
      const source = readProjectSource(projectRoot, hit.file).text;
      const table = findWidgetTables(source).find((widget) => {
        const range = (widget.table as Located).range;
        return Boolean(range && range[0] === hit.range[0] && range[1] === hit.range[1]);
      })?.table;
      return table && callSiteIdentityMatch(projectRoot, source, table, previousText, hints, { allowLayoutOnly: false });
    });
    if (filtered.length >= 1) hits = filtered;
  }
  const chosen = pickUniqueCallSiteHits(hits, preferred ?? preferredRaw);
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
        // Protect `top = contentTop + 470` from live relative coords.
        if (LAYOUT_GEOMETRY_KEYS.has(mappedKey) && expressionLooksLikeLayoutMath(field.value)) {
          continue;
        }
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
  const touched = [relative];
  if (normalized.backgroundImage !== undefined) {
    for (const file of ensureKitOptsPassthrough(projectRoot, "backgroundImage")) {
      if (!touched.includes(file)) touched.push(file);
    }
  }
  if (normalized.color !== undefined || normalized.fontColor !== undefined) {
    for (const file of ensureKitOptsPassthrough(projectRoot, "color", {
      leaves: ["UpgradeCard", "CaptionBar", "Chip", "PrimaryButton", "SecondaryButton"],
      preferAnchor: /(?:fontColor|color)\s*=/
    })) {
      if (!touched.includes(file)) touched.push(file);
    }
  }
  for (const kitField of ["rotate", "transform", "opacity"] as const) {
    if (normalized[kitField] === undefined) continue;
    for (const file of ensureKitOptsPassthrough(projectRoot, kitField, {
      leaves: ["UpgradeCard", "Chip", "PrimaryButton", "SecondaryButton", "CaptionBar"],
      preferAnchor: /(?:left|top|width|height|position)\s*=\s*opts\./
    })) {
      if (!touched.includes(file)) touched.push(file);
    }
  }
  return { filesTouched: touched, appliedCount, reason: "ok" };
}

/**
 * Live SetStyle can paint kit panels, but factories only survive restart when they
 * read `opts.<field>`. Wire the passthrough once per kit function.
 */
export function ensureKitBackgroundImagePassthrough(projectRoot: string): string[] {
  return ensureKitOptsPassthrough(projectRoot, "backgroundImage");
}

export function ensureKitOptsPassthrough(
  projectRoot: string,
  field: string,
  options?: { leaves?: string[]; preferAnchor?: RegExp }
): string[] {
  const leaves = options?.leaves ?? ["UpgradeCard", "Chip", "Dialog", "PrimaryButton", "SecondaryButton", "CaptionBar"];
  const filesTouched: string[] = [];
  for (const relative of listUiLuaFiles(projectRoot)) {
    let source: string;
    try {
      source = readProjectSource(projectRoot, relative).text;
    } catch {
      continue;
    }
    let next = source;
    let changed = false;
    for (const leaf of leaves) {
      const patched = ensureOptsFieldInFactorySource(next, leaf, field, options?.preferAnchor);
      if (patched && patched !== next) {
        next = patched;
        changed = true;
      }
    }
    if (changed) {
      writeProjectText(projectRoot, relative, next);
      filesTouched.push(relative);
    }
  }
  return filesTouched;
}

function ensureOptsFieldInFactorySource(
  source: string,
  factoryLeaf: string,
  field: string,
  preferAnchor?: RegExp
): string | undefined {
  const header = new RegExp(`function\\s+UiStyle\\.${factoryLeaf}\\b`);
  const start = source.search(header);
  if (start < 0) return undefined;
  const after = source.slice(start + 1);
  const nextFn = after.search(/\nfunction\s+/);
  const end = nextFn >= 0 ? start + 1 + nextFn : source.length;
  const block = source.slice(start, end);
  if (new RegExp(`${field}\\s*=\\s*opts\\.${field}\\b`).test(block)) return undefined;
  // CaptionBar already uses opts.fontColor or opts.color — treat as wired.
  if (field === "color" && /opts\.(?:fontColor|color)\b/.test(block)) return undefined;

  if (field === "color") {
    // Turn the first hardcoded title/body color into an opts-aware expression.
    const colorLit = /\bcolor\s*=\s*(\{[^}]+\})/.exec(block);
    if (colorLit && colorLit.index != null && !/opts\./.test(colorLit[0])) {
      const absolute = start + colorLit.index;
      const next = `${source.slice(0, absolute)}color = opts.color or opts.fontColor or ${colorLit[1]}${source.slice(absolute + colorLit[0].length)}`;
      return next;
    }
  }

  const fill = (preferAnchor && preferAnchor.exec(block))
    || (["rotate", "transform", "opacity"].includes(field)
      ? /(?:left|top|width|height|position)\s*=\s*opts\.[^\n]+,/.exec(block)
      : null)
    || /backgroundColor\s*=\s*(?:bg|core)\s*,/.exec(block)
    || /backgroundColor\s*=\s*[^\n]+,/.exec(block)
    || /text\s*=\s*opts\.title\s*,/.exec(block)
    || /text\s*=\s*opts\.text[^\n]*,/.exec(block);
  if (!fill || fill.index == null) return undefined;
  const absolute = start + fill.index + fill[0].length;
  const lineStart = source.lastIndexOf("\n", absolute - 1) + 1;
  const indentMatch = source.slice(lineStart, absolute).match(/^([ \t]*)/);
  const indent = indentMatch?.[1] ?? "                ";
  const assignment = field === "color"
    ? `${field} = opts.color or opts.fontColor,`
    : `${field} = opts.${field},`;
  return `${source.slice(0, absolute)}\n${indent}${assignment}${source.slice(absolute)}`;
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
  // Visual/style only — NEVER route left/top/width/height/position here.
  // Live drag reports parent-relative geometry (0, -4); writing that onto
  // `top = contentTop + 470` call sites shifts buttons after restart.
  "text", "title", "backgroundColor", "fontColor", "textColor", "color",
  "backgroundImage", "backgroundFit", "path",
  "bg", "rim", "fontSize", "fontWeight", "borderRadius",
  "padding", "margin", "visible",
  "rotate", "transform", "opacity", "textAlign", "verticalAlign", "whiteSpace"
]);

/**
 * Label@wrongLine (parent panel / factory) — persist left/top/position onto the
 * unique UI.Label matched by id or previous text within the preferred file.
 */
export function writeBackMatchingLabelLayoutProps(
  projectRoot: string,
  previousText: string | undefined,
  props: Record<string, UiValue>,
  hints?: CallSiteIdentityHints
): CallSiteTextWritebackResult {
  const layoutKeys = ["left", "top", "position", "width", "height"] as const;
  const wanted = Object.fromEntries(
    Object.entries(props).filter(([key]) => (layoutKeys as readonly string[]).includes(key))
  ) as Record<string, UiValue>;
  if (!Object.keys(wanted).length) {
    return { filesTouched: [], appliedCount: 0, reason: "empty" };
  }
  const preferredRaw = hints?.preferredFile ? normalizeSourceFile(hints.preferredFile) : undefined;
  const preferred = preferredRaw && !isKitDefinitionFile(preferredRaw) ? preferredRaw : undefined;

  type Hit = { file: string; range: [number, number]; kitScore: number };
  const hits: Hit[] = [];
  for (const relative of listUiLuaFiles(projectRoot)) {
    if (preferred && !filePathMatches(relative, preferred)) continue;
    let source: string;
    try {
      source = readProjectSource(projectRoot, relative).text;
    } catch {
      continue;
    }
    for (const widget of findWidgetTables(source)) {
      if (widget.type !== "Label" || isFactoryTemplateTable(source, widget.table)) continue;
      const idHit = hints?.id !== undefined && literalFieldEquals(source, widget.table, "id", hints.id);
      const textHit = previousText
        ? callSiteIdentityMatch(projectRoot, source, widget.table, previousText, hints, { allowLayoutOnly: false })
        : false;
      if (!idHit && !textHit) continue;
      const range = (widget.table as Located).range;
      if (!range) continue;
      hits.push({ file: relative, range: [range[0], range[1]], kitScore: idHit ? 3 : 1 });
    }
  }
  const chosen = pickUniqueCallSiteHits(hits, preferred ?? preferredRaw);
  if (chosen.length === 0) return { filesTouched: [], appliedCount: 0, reason: "no_match" };
  if (chosen.length !== 1) return { filesTouched: [], appliedCount: 0, reason: "ambiguous" };

  const relative = chosen[0]!.file;
  const anchorRange = chosen[0]!.range;
  let next = readProjectSource(projectRoot, relative).text;
  let appliedCount = 0;
  for (const [key, value] of Object.entries(wanted)) {
    if (!WRITABLE_KEYS.has(key) || value === undefined || isExpressionUiValue(value)) continue;
    const serialized = serializeLiteral(value);
    if (!serialized) continue;
    const live = findWidgetTables(next).find((widget) => {
      const range = (widget.table as Located).range;
      return Boolean(range && range[0] === anchorRange[0] && range[1] === anchorRange[1]);
    }) || (hints?.id !== undefined
      ? findWidgetTables(next).find((widget) => (
        widget.type === "Label"
        && !isFactoryTemplateTable(next, widget.table)
        && literalFieldEquals(next, widget.table, "id", hints.id)
      ))
      : undefined);
    if (!live) continue;
    const field = fieldByKey(live.table, key);
    if (field) {
      if (LAYOUT_GEOMETRY_KEYS.has(key) && expressionLooksLikeLayoutMath(field.value)) {
        continue;
      }
      const valueNode = field.value as Expression & Located;
      if (!valueNode.range) continue;
      const [start, end] = valueNode.range;
      if (next.slice(start, end) === serialized) continue;
      next = `${next.slice(0, start)}${serialized}${next.slice(end)}`;
      appliedCount += 1;
    } else {
      const tableHasGeom = Boolean(
        fieldByKey(live.table, "position")
        || fieldByKey(live.table, "left")
        || fieldByKey(live.table, "top")
      );
      const previousHadGeom = Boolean(
        hints
        && (hints.left !== undefined || hints.top !== undefined || hints.width !== undefined || hints.height !== undefined)
      );
      // hints carry previous geometry; also allow when table already has position.
      if (!tableHasGeom && !previousHadGeom) continue;
      const insertion = planFieldInsertion(next, live.table, key, serialized);
      if (!insertion) continue;
      next = `${next.slice(0, insertion.start)}${insertion.text}${next.slice(insertion.end)}`;
      appliedCount += 1;
    }
    // Insertion/replacement shifts ranges — re-anchor by id.
    const refreshed = hints?.id !== undefined
      ? findWidgetTables(next).find((widget) => (
        widget.type === "Label"
        && !isFactoryTemplateTable(next, widget.table)
        && literalFieldEquals(next, widget.table, "id", hints.id)
      ))
      : findWidgetTables(next).find((widget) => {
        const range = (widget.table as Located).range;
        return Boolean(range && range[0] === anchorRange[0]);
      });
    const refreshedRange = refreshed ? (refreshed.table as Located).range : undefined;
    if (refreshedRange) {
      anchorRange[0] = refreshedRange[0];
      anchorRange[1] = refreshedRange[1];
    }
  }
  if (!appliedCount) return { filesTouched: [], appliedCount: 0, reason: "unchanged" };
  writeProjectText(projectRoot, relative, next);
  return { filesTouched: [relative], appliedCount, reason: "ok" };
}
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
      remaining.push(...fileOverrides.map(({ previousProps: _previous, nodeId: _nodeId, revertProps: _revert, instancePath: _path, ...rest }) => rest));
      skippedCount += fileOverrides.reduce((sum, item) => sum + Object.keys(item.props).length, 0);
      continue;
    }

    let nextSource = source;
    let fileChanged = false;
    for (const override of fileOverrides) {
      const kitSplit = splitKitInternalGeometry(sourceFile, override);
      const result = patchLuaWidgetLiterals(nextSource, {
        line: override.selector.line,
        type: override.selector.type
      }, kitSplit.props, {
        replaceExpressions: true,
        insertMissingFields: true,
        ...(override.previousProps ? { previousProps: override.previousProps } : {})
      });
      let applied = [...result.applied];
      let skipped = [...kitSplit.skipped, ...result.skipped];
      if (result.changed) {
        nextSource = result.text;
        fileChanged = true;
      }
      if (result.applied.includes("backgroundImage")) {
        for (const file of ensureKitOptsPassthrough(projectRoot, "backgroundImage")) {
          if (!filesTouched.includes(file)) filesTouched.push(file);
        }
      }
      if (result.applied.includes("color") || result.applied.includes("fontColor") || result.applied.includes("textColor")) {
        for (const file of ensureKitOptsPassthrough(projectRoot, "color", {
          leaves: ["UpgradeCard", "CaptionBar", "Chip", "PrimaryButton", "SecondaryButton"],
          preferAnchor: /(?:fontColor|color)\s*=/
        })) {
          if (!filesTouched.includes(file)) filesTouched.push(file);
        }
      }
      for (const kitField of ["rotate", "transform", "opacity"] as const) {
        if (!result.applied.includes(kitField)) continue;
        for (const file of ensureKitOptsPassthrough(projectRoot, kitField, {
          leaves: ["UpgradeCard", "Chip", "PrimaryButton", "SecondaryButton", "CaptionBar"],
          preferAnchor: /(?:left|top|width|height|position)\s*=\s*opts\./
        })) {
          if (!filesTouched.includes(file)) filesTouched.push(file);
        }
      }

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
        ...(override.previousProps?.top !== undefined ? { top: override.previousProps.top } : {}),
        ...(override.previousProps?.id !== undefined ? { id: override.previousProps.id } : {}),
        ...(override.previousProps?.bg !== undefined ? { bg: override.previousProps.bg } : {}),
        ...(override.previousProps?.backgroundColor !== undefined
          ? { backgroundColor: override.previousProps.backgroundColor }
          : {}),
        // Prefer the override's source file for instance screens; UiStyle is ignored later.
        preferredFile: normalizeSourceFile(sourceFile)
      };
      const textBlocked = skipped.find((item) => (
        (item.key === "text" || item.key === "title")
        && (
          item.reason === "opts_passthrough"
          || item.reason === "widget_not_found"
          || item.reason === "nearby_skip"
          || item.reason === "nearby_no_insert"
          || item.reason === "field_missing"
        )
      ));
      if (textBlocked && nextTextValue != null) {
        if (previousText == null && identityHints.id === undefined) {
          skipped = skipped.map((item) => (
            (item.key === "text" || item.key === "title")
            && (
              item.reason === "opts_passthrough"
              || item.reason === "widget_not_found"
              || item.reason === "nearby_skip"
              || item.reason === "nearby_no_insert"
              || item.reason === "field_missing"
            )
              ? { key: item.key, reason: "call_site_no_previous" }
              : item
          ));
        } else {
          // Label@parentLine (children = { levelLabel }) + SetText(Title · Subtitle)
          // Also covers nearby_skip / nearby_no_insert when Panel line is an UpgradeCard.
          const findText = String(previousTextOriginal ?? previousText ?? "");
          const labelDisplay = findText
            ? writeBackLabelDisplayText(
              projectRoot,
              findText,
              String(nextTextValue),
              identityHints
            )
            : { filesTouched: [] as string[], appliedCount: 0, reason: "empty" as const };
          const callSiteText = labelDisplay.appliedCount > 0 || labelDisplay.reason === "unchanged"
            ? labelDisplay
            : writeBackMatchingCallSiteText(
              projectRoot,
              findText,
              String(nextTextValue),
              identityHints
            );
          const callSite = callSiteText.appliedCount > 0 || callSiteText.reason === "unchanged"
            ? callSiteText
            : (findText
              ? writeBackMatchingTextLiterals(
                projectRoot,
                findText,
                String(nextTextValue),
                identityHints.preferredFile
              )
              : { filesTouched: [] as string[], appliedCount: 0, reason: "no_match" as const });
          if (callSite.appliedCount > 0 || callSite.reason === "unchanged") {
            applied.push(textBlocked.key);
            skipped = skipped.filter((item) => item.key !== textBlocked.key);
            if (callSite.appliedCount > 0) {
              appliedCount += callSite.appliedCount;
              for (const file of callSite.filesTouched) {
                if (!filesTouched.includes(file)) filesTouched.push(file);
              }
              // Disk may have changed via SetText/label freeze — reload for further patches.
              try {
                nextSource = readProjectSource(projectRoot, resolvedPath).text;
                fileChanged = false;
              } catch {
                /* keep nextSource */
              }
            }
          } else {
            const reason = callSite.reason === "ambiguous"
              ? "call_site_ambiguous"
              : "call_site_no_match";
            skipped = skipped.map((item) => (
              item.key === textBlocked.key
              && (
                item.reason === "opts_passthrough"
                || item.reason === "widget_not_found"
                || item.reason === "nearby_skip"
                || item.reason === "nearby_no_insert"
                || item.reason === "field_missing"
              )
                ? { key: item.key, reason }
                : item
            ));
          }
        }
      }

      const routedBlocked = skipped.filter((item) => (
        (
          item.reason === "opts_passthrough"
          || item.reason === "nearby_no_insert"
          || item.reason === "nearby_skip"
          || item.reason === "field_missing"
          || item.reason === "widget_not_found"
        )
        && CALL_SITE_ROUTE_KEYS.has(item.key)
        && item.key !== "text"
        && item.key !== "title"
      ));
      if (routedBlocked.length && (previousText != null || identityHints.id !== undefined)) {
        const routedProps = resolveFactoryCallSiteProps(nextSource, {
          line: override.selector.line,
          type: override.selector.type
        }, Object.fromEntries(
          routedBlocked
            .map((item) => [item.key, override.props[item.key]])
            .filter((entry): entry is [string, UiValue] => entry[1] !== undefined)
        ));
        // widget_not_found: resolveFactoryCallSiteProps may be empty — still remap
        // inspector backgroundColor/fontColor onto kit call-site keys.
        const propsForRoute = Object.keys(routedProps).length
          ? routedProps
          : remapPropsForCallSiteTable(
            Object.fromEntries(
              routedBlocked
                .map((item) => [item.key, override.props[item.key]])
                .filter((entry): entry is [string, UiValue] => entry[1] !== undefined)
            )
          );
        // Find call site by PRE-EDIT identity first (Lua often still has Assets.* / old literal).
        // If that misses (text already frozen earlier), retry with live identityText.
        const findIdentity = String(
          previousTextOriginal
          ?? previousText
          ?? identityTextLatest
          ?? identityHints.id
          ?? ""
        );
        let routedSite = writeBackMatchingCallSiteProps(
          projectRoot,
          findIdentity,
          propsForRoute,
          identityHints
        );
        if (
          (routedSite.reason === "no_match" || routedSite.reason === "ambiguous")
          && identityTextLatest
          && String(identityTextLatest) !== findIdentity
        ) {
          routedSite = writeBackMatchingCallSiteProps(
            projectRoot,
            String(identityTextLatest),
            propsForRoute,
            identityHints
          );
        }
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
            try {
              nextSource = readProjectSource(projectRoot, resolvedPath).text;
              fileChanged = false;
            } catch {
              /* keep */
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

      if (routedBlocked.length && previousText == null && identityHints.id === undefined) {
        skipped = skipped.map((item) => (
          routedBlocked.some((blocked) => blocked.key === item.key)
            ? { key: item.key, reason: "call_site_no_previous" }
            : item
        ));
      }

      // Label geometry by id only — never route parent-relative drag coords onto kit call sites.
      const geometryBlocked = skipped.filter((item) => (
        LAYOUT_GEOMETRY_KEYS.has(item.key)
        && (
          item.reason === "widget_not_found"
          || item.reason === "nearby_no_insert"
          || item.reason === "nearby_skip"
          || item.reason === "field_missing"
        )
      ));
      if (geometryBlocked.length && identityHints.id !== undefined) {
        const labelLayout = writeBackMatchingLabelLayoutProps(
          projectRoot,
          previousText != null ? String(previousText) : undefined,
          Object.fromEntries(
            geometryBlocked
              .map((item) => [item.key, override.props[item.key]])
              .filter((entry): entry is [string, UiValue] => entry[1] !== undefined)
          ),
          identityHints
        );
        if (labelLayout.appliedCount > 0 || labelLayout.reason === "unchanged") {
          for (const item of geometryBlocked) applied.push(item.key);
          skipped = skipped.filter((item) => !geometryBlocked.some((blocked) => blocked.key === item.key));
          if (labelLayout.appliedCount > 0) {
            appliedCount += labelLayout.appliedCount;
            for (const file of labelLayout.filesTouched) {
              if (!filesTouched.includes(file)) filesTouched.push(file);
            }
            try {
              nextSource = readProjectSource(projectRoot, resolvedPath).text;
              fileChanged = false;
            } catch {
              /* keep */
            }
          }
        }
      }

      // Nearby freeze may rewrite `text = Assets.Title` while Refresh still does
      // SetText(Title · Subtitle). Always sync SetText when label text changed.
      if (
        (applied.includes("text") || applied.includes("title"))
        && previousText != null
        && nextTextValue != null
        && String(previousText) !== String(nextTextValue)
      ) {
        const sync = writeBackLabelDisplayText(
          projectRoot,
          String(previousTextOriginal ?? previousText),
          String(nextTextValue),
          identityHints
        );
        if (sync.appliedCount > 0) {
          appliedCount += sync.appliedCount;
          for (const file of sync.filesTouched) {
            if (!filesTouched.includes(file)) filesTouched.push(file);
          }
          try {
            nextSource = readProjectSource(projectRoot, resolvedPath).text;
            fileChanged = false;
          } catch {
            /* keep */
          }
        }
      }

      appliedCount += result.applied.length;
      skippedCount += skipped.filter((item) => item.reason !== "unchanged").length;
      const undurableSkipped = new Set(
        skipped
          .filter((item) => UNDURABLE_SKIP_REASONS.has(item.reason))
          .map((item) => item.key)
      );
      // Live edit must equal game Lua: hand back the pre-edit values so the
      // Bridge can undo the SetStyle that never reached the source.
      const revert: Record<string, UiValue | null> = {};
      for (const key of undurableSkipped) {
        if (override.revertProps && key in override.revertProps) revert[key] = override.revertProps[key]!;
      }
      details.push({
        sourceFile: resolvedPath,
        line: override.selector.line,
        type: override.selector.type,
        applied,
        skipped,
        ...(override.nodeId ? { nodeId: override.nodeId } : {}),
        ...(override.instancePath ? { instancePath: override.instancePath } : {}),
        ...(Object.keys(revert).length ? { revert } : {})
      });
      const dropped = new Set([
        ...applied,
        ...skipped.filter((item) => item.reason === "unchanged").map((item) => item.key)
      ]);
      // Remapped kit keys: writing `bg`/`rim`/`color` must also clear inspector aliases
      // or lime fills linger forever in .ui.json while Lua stays on the old gold.
      if (dropped.has("bg") || dropped.has("rim")) dropped.add("backgroundColor");
      if (dropped.has("color")) {
        dropped.add("fontColor");
        dropped.add("textColor");
      }
      // Invariant: live edit = game Lua. Sidecar must NEVER re-apply leftovers
      // (esp. factory geometry → Panel@259 opts_passthrough) on refresh.
      const kept = Object.fromEntries(
        Object.entries(override.props).filter(([key]) => {
          if (dropped.has(key) || key.startsWith("$")) return false;
          if (LAYOUT_GEOMETRY_KEYS.has(key)) return false;
          if (undurableSkipped.has(key)) return false;
          return true;
        })
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
