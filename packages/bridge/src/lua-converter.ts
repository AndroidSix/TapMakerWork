import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import luaparse, {
  type AssignmentStatement,
  type Expression,
  type FunctionDeclaration,
  type Identifier,
  type IndexExpression,
  type MemberExpression,
  type Statement,
  type TableConstructorExpression,
  type TableKeyString,
  type TableValue
} from "luaparse";
import type { UiConversionDiagnostic, UiConversionDocument, UiNode, UiSnapshot, UiValue } from "@tapmakerwork/protocol";
import { resolveInsideProject } from "./project.js";

type Located = {
  loc?: { start: { line: number; column: number }; end: { line: number; column: number } } | undefined;
  range?: [number, number] | undefined;
};
type SymbolValue = { expression?: Expression; appended: Expression[] };

interface ConversionContext {
  source: string;
  sourceFile: string;
  symbols: Map<string, SymbolValue>;
  diagnostics: UiConversionDiagnostic[];
  candidates: UiNode[];
}

function sourceText(context: ConversionContext, node: Located): string {
  if (node.range) return context.source.slice(node.range[0], node.range[1]);
  return "<dynamic>";
}

function decodeLuaString(raw: string): string {
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\([\\"'])/g, "$1");
  }
  return raw;
}

function calleeName(expression: Expression): string {
  if (expression.type === "Identifier") return expression.name;
  if (expression.type === "MemberExpression") return `${calleeName(expression.base)}${expression.indexer}${expression.identifier.name}`;
  if (expression.type === "IndexExpression") return `${calleeName(expression.base)}[]`;
  return expression.type;
}

function widgetTable(expression: Expression): { callee: Expression; table: TableConstructorExpression } | undefined {
  if (expression.type === "TableCallExpression" && expression.arguments.type === "TableConstructorExpression") {
    return { callee: expression.base, table: expression.arguments };
  }
  if (expression.type === "CallExpression") {
    const first = expression.arguments[0];
    if (first?.type === "TableConstructorExpression") return { callee: expression.base, table: first };
  }
  return undefined;
}

function widgetType(callee: Expression): string {
  const name = calleeName(callee);
  const leaf = name.split(/[.:]/).at(-1) || "Widget";
  if (/button$/i.test(leaf)) return "Button";
  if (/label|text$/i.test(leaf)) return "Label";
  if (/image|sprite$/i.test(leaf)) return "Image";
  if (/panel|container|view$/i.test(leaf)) return "Panel";
  return leaf;
}

function expressionValue(context: ConversionContext, expression: Expression): UiValue {
  switch (expression.type) {
    case "StringLiteral": return decodeLuaString(expression.raw);
    case "NumericLiteral": return expression.value;
    case "BooleanLiteral": return expression.value;
    case "NilLiteral": return null;
    case "TableConstructorExpression": {
      const array: UiValue[] = [];
      const record: Record<string, UiValue> = {};
      let keyed = false;
      for (const field of expression.fields) {
        if (field.type === "TableValue") array.push(expressionValue(context, field.value));
        else if (field.type === "TableKeyString") {
          keyed = true;
          record[field.key.name] = expressionValue(context, field.value);
        }
      }
      return keyed ? record : array;
    }
    default: return { $expression: sourceText(context, expression) };
  }
}

function symbolExpressions(context: ConversionContext, expression: Expression): Expression[] {
  if (expression.type === "Identifier") {
    const symbol = context.symbols.get(expression.name);
    if (symbol) {
      const initial = symbol.expression?.type === "TableConstructorExpression"
        ? symbol.expression.fields.filter((field): field is TableValue => field.type === "TableValue").map((field) => field.value)
        : symbol.expression ? [symbol.expression] : [];
      return [...initial, ...symbol.appended];
    }
  }
  if (expression.type === "TableConstructorExpression") {
    return expression.fields.filter((field): field is TableValue => field.type === "TableValue").map((field) => field.value);
  }
  return [expression];
}

function dynamicNode(context: ConversionContext, expression: Expression, ordinal: number): UiNode {
  const line = expression.loc?.start.line ?? 0;
  return {
    id: `${context.sourceFile}:${line}:slot:${ordinal}`,
    type: "Slot",
    name: "DynamicSlot",
    props: { expression: sourceText(context, expression) },
    source: { file: context.sourceFile, line },
    children: []
  };
}

function toWidget(context: ConversionContext, expression: Expression, ordinal = 0): UiNode | undefined {
  if (expression.type === "Identifier") {
    const resolved = context.symbols.get(expression.name)?.expression;
    if (resolved && resolved !== expression) return toWidget(context, resolved, ordinal);
  }
  const call = widgetTable(expression);
  if (!call) return undefined;
  const type = widgetType(call.callee);
  const line = expression.loc?.start.line ?? 0;
  const props: Record<string, UiValue> = {};
  const children: UiNode[] = [];

  for (const field of call.table.fields) {
    if (field.type !== "TableKeyString") continue;
    const key = field.key.name;
    if (key !== "children") {
      props[key] = expressionValue(context, field.value);
      continue;
    }
    const childExpressions = symbolExpressions(context, field.value);
    childExpressions.forEach((childExpression, index) => {
      const child = toWidget(context, childExpression, index);
      children.push(child ?? dynamicNode(context, childExpression, index));
    });
  }

  const callee = calleeName(call.callee);
  if (!callee.startsWith("UI.")) props.$factory = callee;
  return {
    id: `${context.sourceFile}:${line}:${type.toLowerCase()}:${ordinal}`,
    type,
    name: props.id && typeof props.id === "string" ? props.id : `${type}@${line}`,
    props,
    source: { file: context.sourceFile, line },
    children
  };
}

function appendAssignment(context: ConversionContext, statement: AssignmentStatement): void {
  statement.variables.forEach((variable, index) => {
    const value = statement.init[index];
    if (!value) return;
    if (variable.type === "Identifier") {
      context.symbols.set(variable.name, { expression: value, appended: context.symbols.get(variable.name)?.appended ?? [] });
      return;
    }
    if (variable.type === "IndexExpression" && variable.base.type === "Identifier") {
      const symbol = context.symbols.get(variable.base.name) ?? { appended: [] };
      symbol.appended.push(value);
      context.symbols.set(variable.base.name, symbol);
    }
  });
}

function scanStatements(context: ConversionContext, statements: Statement[]): void {
  for (const statement of statements) {
    if (statement.type === "LocalStatement") {
      statement.variables.forEach((variable, index) => {
        const expression = statement.init[index];
        if (expression) context.symbols.set(variable.name, { expression, appended: [] });
        const widget = expression ? toWidget(context, expression) : undefined;
        if (widget) context.candidates.push(widget);
      });
    } else if (statement.type === "AssignmentStatement") {
      appendAssignment(context, statement);
      for (const expression of statement.init) {
        const widget = toWidget(context, expression);
        if (widget) context.candidates.push(widget);
      }
    } else if (statement.type === "FunctionDeclaration") {
      scanFunction(context, statement);
    } else if (statement.type === "IfStatement") {
      for (const clause of statement.clauses) scanStatements(context, clause.body);
    } else if (statement.type === "DoStatement" || statement.type === "WhileStatement" || statement.type === "RepeatStatement" || statement.type === "ForNumericStatement" || statement.type === "ForGenericStatement") {
      scanStatements(context, statement.body);
    }
  }
}

function scanFunction(parent: ConversionContext, declaration: FunctionDeclaration): void {
  const nested: ConversionContext = { ...parent, symbols: new Map(parent.symbols), candidates: [] };
  scanStatements(nested, declaration.body);
  const rootSymbol = nested.symbols.get("root")?.expression;
  const root = rootSymbol ? toWidget(nested, rootSymbol) : undefined;
  if (root) parent.candidates.push(root);
  else parent.candidates.push(...nested.candidates);
}

function nodeSize(node: UiNode): number {
  return 1 + node.children.reduce((sum, child) => sum + nodeSize(child), 0);
}

function firstSelectable(root: UiNode): string {
  if (root.type === "Button") return root.id;
  for (const child of root.children) {
    const selected = firstSelectable(child);
    if (selected !== child.id || child.type === "Button") return selected;
  }
  return root.id;
}

export function convertLuaUiSource(source: string, sourceFile: string): UiConversionDocument {
  const context: ConversionContext = { source, sourceFile, symbols: new Map(), diagnostics: [], candidates: [] };
  try {
    const chunk = luaparse.parse(source, { locations: true, ranges: true, luaVersion: "5.3", encodingMode: "none" });
    scanStatements(context, chunk.body);
  } catch (error) {
    context.diagnostics.push({ severity: "error", message: error instanceof Error ? error.message : String(error) });
  }
  const root = context.candidates.sort((a, b) => nodeSize(b) - nodeSize(a))[0];
  if (!root) throw new Error("no_ui_root_found");
  const dynamicCount = nodeSize(root) - countConcrete(root);
  if (dynamicCount > 0) {
    context.diagnostics.push({
      severity: "warning",
      message: `${dynamicCount} 个动态节点需要 Runtime 快照补全；静态转换已保留原 Lua 表达式。`
    });
  }
  return {
    formatVersion: 1,
    sourceFile,
    sourceHash: crypto.createHash("sha256").update(source).digest("hex"),
    confidence: dynamicCount ? "hybrid" : "static",
    root,
    diagnostics: context.diagnostics
  };
}

function countConcrete(node: UiNode): number {
  return (node.type === "Slot" ? 0 : 1) + node.children.reduce((sum, child) => sum + countConcrete(child), 0);
}

export function convertLuaUiFile(projectRoot: string, relativeFile: string): UiConversionDocument {
  const filename = resolveInsideProject(projectRoot, relativeFile);
  const source = fs.readFileSync(filename, "utf8");
  return convertLuaUiSource(source, path.relative(projectRoot, filename).split(path.sep).join("/"));
}

export function snapshotFromConversion(document: UiConversionDocument): UiSnapshot {
  return { revision: 1, root: document.root, selectedId: firstSelectable(document.root) };
}
