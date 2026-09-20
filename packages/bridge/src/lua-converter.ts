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
  moduleSymbols: Map<string, SymbolValue>;
  functions: Map<string, FunctionDeclaration>;
  constants: Map<string, UiValue>;
  diagnostics: UiConversionDiagnostic[];
  candidates: UiNode[];
  expansionDepth: number;
  resolvingSymbols: Set<string>;
  expansionStack: Set<string>;
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
  if (/image|sprite|icon$/i.test(leaf)) return "Image";
  if (/panel|container|view|card|chip|dialog|bar$/i.test(leaf)) return "Panel";
  return leaf;
}

function expressionValue(context: ConversionContext, expression: Expression): UiValue {
  switch (expression.type) {
    case "StringLiteral": return decodeLuaString(expression.raw);
    case "NumericLiteral": return expression.value;
    case "BooleanLiteral": return expression.value;
    case "NilLiteral": return null;
    case "Identifier": {
      if (context.resolvingSymbols.has(expression.name)) return { $expression: sourceText(context, expression) };
      const resolved = context.symbols.get(expression.name)?.expression;
      if (!resolved || resolved === expression) return { $expression: sourceText(context, expression) };
      context.resolvingSymbols.add(expression.name);
      try { return expressionValue(context, resolved); }
      finally { context.resolvingSymbols.delete(expression.name); }
    }
    case "MemberExpression": {
      if (expression.base.type === "Identifier") {
        const base = context.symbols.get(expression.base.name)?.expression;
        if (base?.type === "TableConstructorExpression") {
          const field = base.fields.find((candidate): candidate is TableKeyString => candidate.type === "TableKeyString" && candidate.key.name === expression.identifier.name);
          if (field) return expressionValue(context, field.value);
        }
        if ((base?.type === "CallExpression" || base?.type === "TableCallExpression") && /DesignSpace\.Get$/.test(calleeName(base.base))) {
          const designValue: Record<string, number> = { safeTop: 36, safeBottom: 28, safeLeft: 16, safeRight: 16, logicalW: 720, logicalH: 1280 };
          const value = designValue[expression.identifier.name];
          if (value !== undefined) return value;
        }
      }
      const constant = context.constants.get(sourceText(context, expression));
      return constant ?? { $expression: sourceText(context, expression) };
    }
    case "BinaryExpression": {
      const left = expressionValue(context, expression.left);
      const right = expressionValue(context, expression.right);
      if (typeof left !== "number" || typeof right !== "number") return { $expression: sourceText(context, expression) };
      if (expression.operator === "+") return left + right;
      if (expression.operator === "-") return left - right;
      if (expression.operator === "*") return left * right;
      if (expression.operator === "/") return right === 0 ? { $expression: sourceText(context, expression) } : left / right;
      if (expression.operator === "%") return right === 0 ? { $expression: sourceText(context, expression) } : left % right;
      if (expression.operator === "^") return left ** right;
      return { $expression: sourceText(context, expression) };
    }
    case "UnaryExpression": {
      const value = expressionValue(context, expression.argument);
      if (expression.operator === "-" && typeof value === "number") return -value;
      if (expression.operator === "not") return !value;
      return { $expression: sourceText(context, expression) };
    }
    case "CallExpression": {
      const name = calleeName(expression.base);
      const values = expression.arguments.map((argument) => expressionValue(context, argument));
      if (values.every((value): value is number => typeof value === "number")) {
        if (name === "math.floor") return Math.floor(values[0] ?? 0);
        if (name === "math.ceil") return Math.ceil(values[0] ?? 0);
        if (name === "math.max") return Math.max(...values);
        if (name === "math.min") return Math.min(...values);
        if (name === "tonumber") return values[0] ?? 0;
      }
      return { $expression: sourceText(context, expression) };
    }
    case "LogicalExpression": {
      // Lua's `value or literal` idiom carries an explicit preview-safe default.
      if (expression.operator === "or") return expressionValue(context, expression.right);
      return { $expression: sourceText(context, expression) };
    }
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

function collectSymbols(context: ConversionContext, statements: Statement[]): void {
  for (const statement of statements) {
    if (statement.type === "LocalStatement") {
      statement.variables.forEach((variable, index) => {
        const expression = statement.init[index];
        if (!expression || variable.type !== "Identifier") return;
        const previous = context.symbols.get(variable.name);
        context.symbols.set(variable.name, { expression, appended: previous?.appended ?? [] });
      });
      continue;
    }
    if (statement.type === "AssignmentStatement") {
      appendAssignment(context, statement);
      continue;
    }
    if (statement.type === "IfStatement") {
      for (const clause of statement.clauses) collectSymbols(context, clause.body);
      continue;
    }
    if (statement.type === "DoStatement" || statement.type === "WhileStatement" || statement.type === "RepeatStatement" || statement.type === "ForNumericStatement" || statement.type === "ForGenericStatement") {
      collectSymbols(context, statement.body);
    }
  }
}

function walkStatements(statements: Statement[], visit: (statement: Statement) => void): void {
  for (const statement of statements) {
    visit(statement);
    if (statement.type === "IfStatement") {
      for (const clause of statement.clauses) walkStatements(clause.body, visit);
    } else if (statement.type === "DoStatement" || statement.type === "WhileStatement" || statement.type === "RepeatStatement" || statement.type === "ForNumericStatement" || statement.type === "ForGenericStatement") {
      walkStatements(statement.body, visit);
    }
  }
}

function collectReturnedWidgets(context: ConversionContext, statements: Statement[], ordinal = 0): UiNode[] {
  const nodes: UiNode[] = [];
  walkStatements(statements, (statement) => {
    if (statement.type !== "ReturnStatement") return;
    for (const argument of statement.arguments) {
      const widget = toWidget(context, argument, ordinal);
      if (widget) nodes.push(widget);
    }
  });
  return nodes;
}

function expandFunctionWidget(
  context: ConversionContext,
  declaration: FunctionDeclaration,
  args: Expression[],
  ordinal: number
): UiNode | undefined {
  const name = declaration.identifier?.type === "Identifier" ? declaration.identifier.name : undefined;
  if (name) {
    if (context.expansionStack.has(name) || context.expansionDepth >= 8) {
      return dynamicNode(context, { loc: declaration.loc } as Expression, ordinal);
    }
  }
  const nested: ConversionContext = {
    ...context,
    // Current call-site scope (function locals + module symbols), not module-only.
    symbols: new Map(context.symbols),
    candidates: [],
    expansionDepth: context.expansionDepth + 1,
    resolvingSymbols: new Set(),
    expansionStack: new Set(name ? [...context.expansionStack, name] : context.expansionStack)
  };
  declaration.parameters.forEach((parameter, index) => {
    if (parameter.type === "Identifier" && args[index]) {
      nested.symbols.set(parameter.name, { expression: args[index], appended: [] });
    }
  });
  collectSymbols(nested, declaration.body);
  const returned = collectReturnedWidgets(nested, declaration.body, ordinal);
  return returned[0];
}

function toWidget(context: ConversionContext, expression: Expression, ordinal = 0): UiNode | undefined {
  if (expression.type === "Identifier") {
    if (context.resolvingSymbols.has(expression.name)) return dynamicNode(context, expression, ordinal);
    context.resolvingSymbols.add(expression.name);
    try {
      const resolved = context.symbols.get(expression.name)?.expression;
      if (resolved && resolved !== expression) return toWidget(context, resolved, ordinal);
    } finally {
      context.resolvingSymbols.delete(expression.name);
    }
    return undefined;
  }
  if ((expression.type === "CallExpression" || expression.type === "TableCallExpression") && (expression.base.type === "Identifier" || expression.base.type === "MemberExpression" || expression.base.type === "IndexExpression")) {
    const fullName = calleeName(expression.base);
    const leaf = fullName.split(/[.:]/).at(-1) || fullName;
    const declaration = context.functions.get(fullName)
      ?? context.functions.get(leaf)
      ?? context.functions.get(`Q.${leaf}`)
      ?? context.functions.get(`PC.${leaf}`);
    if (declaration) {
      const args = expression.type === "CallExpression" ? expression.arguments : [expression.arguments];
      const expanded = expandFunctionWidget(context, declaration, args, ordinal);
      if (expanded) return expanded;
    }
  }
  const call = widgetTable(expression);
  if (!call) return undefined;
  const type = widgetType(call.callee);
  const line = expression.loc?.start.line ?? 0;
  const props: Record<string, UiValue> = {};
  const children: UiNode[] = [];
  const fields = new Map<string, Expression>();

  for (const field of call.table.fields) {
    if (field.type !== "TableKeyString") continue;
    const key = field.key.name;
    fields.set(key, field.value);
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
  if (props.position == null && (props.left != null || props.top != null || /(?:absPanel|\.Chip|\.UpgradeCard)$/i.test(callee))) props.position = "absolute";
  if (type === "Button") {
    const primary = /primarybutton$/i.test(callee);
    const secondary = /secondarybutton$/i.test(callee);
    const fallback = (key: string) => context.constants.get(`style.${key}`) ?? context.constants.get(`UI_STYLE.${key}`);
    if (primary || secondary) {
      props.height ??= fallback("buttonHeight") ?? 52;
      props.fontSize ??= fallback("buttonFontSize") ?? 16;
      props.fontWeight ??= "bold";
      props.backgroundColor ??= fallback(primary ? "primary" : "secondary") ?? (primary ? [170, 65, 50, 255] : [70, 90, 70, 255]);
      props.borderRadius ??= fallback("buttonRadius") ?? 14;
      props.borderWidth ??= fallback("buttonBorderWidth") ?? 3;
      props.borderColor ??= [0, 0, 0, 255];
    }
  }
  if (/\.Chip$/i.test(callee)) {
    props.flexDirection ??= "row";
    props.alignItems ??= "center";
    props.justifyContent ??= "center";
    props.padding ??= 2;
    props.backgroundColor ??= props.rim ?? [190, 155, 80, 255];
    props.borderRadius ??= 24;
    props.borderWidth ??= 2;
    props.borderColor ??= props.rim ?? [190, 155, 80, 255];
  }
  if (/\.UpgradeCard$/i.test(callee)) {
    props.height ??= 290;
    props.padding ??= { top: 18, right: 10, bottom: 14, left: 10 };
    props.backgroundColor ??= props.bg ?? [70, 100, 90, 255];
    props.borderRadius ??= 18;
    props.borderWidth ??= 3;
    props.borderColor ??= [35, 28, 20, 255];
    props.alignItems ??= "center";
    const synthetic = (name: string, childProps: Record<string, UiValue>): UiNode => ({
      id: `${context.sourceFile}:${line}:label:${name}`,
      type: "Label",
      name,
      props: childProps,
      source: { file: context.sourceFile, line },
      children: []
    });
    if (props.title != null) children.push(synthetic("卡片标题", { text: props.title, fontSize: 18, fontWeight: "bold", color: [255, 236, 180, 255], margin: { bottom: 6 } }));
    for (const key of ["valueLabel", "levLabel", "nextHint"] as const) {
      const childExpression = fields.get(key);
      if (childExpression) {
        const child = toWidget(context, childExpression, children.length);
        if (child) children.push(child);
      }
    }
    const costExpression = fields.get("costLabel");
    if (costExpression) {
      const cost = toWidget(context, costExpression, children.length);
      if (cost) {
        children.push(synthetic("消耗", { text: "消耗", fontSize: 14, fontWeight: "bold", color: [255, 240, 200, 255], margin: { top: 10 } }));
        children.push(cost);
      }
    }
    const hintExpression = fields.get("freeHint");
    if (hintExpression) {
      const hint = toWidget(context, hintExpression, children.length);
      if (hint) children.push(hint);
    }
  }
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
      if (statement.identifier?.type === "Identifier") context.functions.set(statement.identifier.name, statement);
      scanFunction(context, statement);
    } else if (statement.type === "IfStatement") {
      for (const clause of statement.clauses) scanStatements(context, clause.body);
    } else if (statement.type === "DoStatement" || statement.type === "WhileStatement" || statement.type === "RepeatStatement" || statement.type === "ForNumericStatement" || statement.type === "ForGenericStatement") {
      scanStatements(context, statement.body);
    }
  }
}

function scanFunction(parent: ConversionContext, declaration: FunctionDeclaration): void {
  const nested: ConversionContext = {
    ...parent,
    symbols: new Map(parent.symbols),
    candidates: [],
    resolvingSymbols: new Set(),
    expansionStack: new Set(parent.expansionStack)
  };
  scanStatements(nested, declaration.body);
  const returned = collectReturnedWidgets(nested, declaration.body);
  if (returned.length) parent.candidates.push(...returned);
  const rootSymbol = nested.symbols.get("root")?.expression
    ?? nested.symbols.get("root_")?.expression;
  const root = rootSymbol ? toWidget(nested, rootSymbol) : undefined;
  if (root) parent.candidates.push(root);
  else if (!returned.length) parent.candidates.push(...nested.candidates);
}

function nodeSize(node: UiNode): number {
  if (!node || typeof node !== "object") return 0;
  const children = Array.isArray(node.children) ? node.children : [];
  return 1 + children.reduce((sum, child) => sum + nodeSize(child), 0);
}

function countConcreteNodes(node: UiNode): number {
  return (node.type === "Slot" || node.type === "Module" ? 0 : 1) + node.children.reduce((sum, child) => sum + countConcreteNodes(child), 0);
}

function treeDepth(node: UiNode): number {
  return 1 + node.children.reduce((max, child) => Math.max(max, treeDepth(child)), 0);
}

function maxSameSourceLineRepeat(node: UiNode, line?: number, repeat = 0): number {
  const current = node.source?.line;
  const next = line !== undefined && current === line ? repeat + 1 : 1;
  let max = next;
  for (const child of node.children) {
    max = Math.max(max, maxSameSourceLineRepeat(child, current ?? line, next));
  }
  return max;
}

function scoreCandidate(node: UiNode): number {
  const concrete = countConcreteNodes(node);
  const size = nodeSize(node);
  let score = concrete * 8 + size;
  const propsId = typeof node.props.id === "string" ? node.props.id : "";
  const name = node.name || "";
  const factory = typeof node.props.$factory === "string" ? node.props.$factory : "";
  if (propsId === "root" || name === "root" || /root_?$/i.test(name)) score += 800;
  if (/^(show|build|create|open|main|load)$/i.test(name) || /\.(Show|Build|Create|Open|Main)$/i.test(factory)) score += 120;
  if (propsId && propsId !== "root") score += 20;
  const lineRepeat = maxSameSourceLineRepeat(node);
  if (lineRepeat > 2) score -= 250 * (lineRepeat - 2);
  const depth = treeDepth(node);
  if (depth > 10) score -= 80 * (depth - 10);
  const slots = size - concrete;
  if (concrete > 0 && slots / concrete > 0.75) score -= 90;
  return score;
}

function pickConversionRoot(candidates: UiNode[]): UiNode | undefined {
  if (!candidates.length) return undefined;
  let best: UiNode | undefined;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function firstSelectable(root: UiNode): string {
  if (root.type === "Button") return root.id;
  for (const child of root.children) {
    const selected = firstSelectable(child);
    if (selected !== child.id || child.type === "Button") return selected;
  }
  return root.id;
}

function withStableTreeIds(node: UiNode, pathParts: number[] = [0]): UiNode {
  const source = node.source;
  const id = `${source?.file ?? "runtime"}:${source?.line ?? 0}:${node.type.toLowerCase()}:${pathParts.join(".")}`;
  return {
    ...node,
    id,
    children: node.children.map((child, index) => withStableTreeIds(child, [...pathParts, index]))
  };
}

function emptyContext(source: string, sourceFile: string, constants: Map<string, UiValue>): ConversionContext {
  return {
    source,
    sourceFile,
    symbols: new Map(),
    moduleSymbols: new Map(),
    functions: new Map(),
    constants,
    diagnostics: [],
    candidates: [],
    expansionDepth: 0,
    resolvingSymbols: new Set(),
    expansionStack: new Set()
  };
}

function moduleStubDocument(source: string, sourceFile: string, message: string): UiConversionDocument {
  const name = path.basename(sourceFile, ".lua");
  return {
    formatVersion: 1,
    sourceFile,
    sourceHash: crypto.createHash("sha256").update(source).digest("hex"),
    confidence: "module",
    root: {
      id: `${sourceFile}:module:0`,
      type: "Module",
      name,
      props: {
        id: name,
        $module: true,
        note: "未检测到可静态转换的 UI 根，已标记为逻辑/样式/工具模块。"
      },
      source: { file: sourceFile, line: 1 },
      children: []
    },
    diagnostics: [{ severity: "info", message }]
  };
}

function registerModuleFunctions(
  functions: Map<string, FunctionDeclaration>,
  projectRoot: string,
  source: string
): void {
  const requires = [...source.matchAll(/local\s+([A-Za-z_]\w*)\s*=\s*require\s*\(\s*["']([^"']+)["']\s*\)/g)];
  for (const match of requires) {
    const [, alias, moduleName] = match;
    if (!alias || !moduleName) continue;
    if (!/^(ui|config)\./.test(moduleName)) continue;
    const relativeModule = `scripts/${moduleName.replace(/\./g, "/")}.lua`;
    try {
      const moduleFile = resolveInsideProject(projectRoot, relativeModule);
      const moduleSource = fs.readFileSync(moduleFile, "utf8");
      const chunk = luaparse.parse(moduleSource, { locations: true, ranges: true, luaVersion: "5.3", encodingMode: "none" });
      const saveFunction = (name: string, declaration: FunctionDeclaration): void => {
        const leaf = name.split(/[.:]/).at(-1) || name;
        functions.set(name, declaration);
        functions.set(leaf, declaration);
        functions.set(`${alias}.${leaf}`, declaration);
      };
      walkStatements(chunk.body, (statement) => {
        if (statement.type !== "FunctionDeclaration") return;
        const identifier = statement.identifier;
        if (identifier?.type === "Identifier") saveFunction(identifier.name, statement);
        else if (identifier?.type === "MemberExpression") saveFunction(calleeName(identifier), statement);
      });
      walkStatements(chunk.body, (statement) => {
        if (statement.type !== "AssignmentStatement") return;
        statement.variables.forEach((variable, index) => {
          const value = statement.init[index];
          if (!value || value.type !== "FunctionDeclaration") return;
          if (variable.type === "MemberExpression") saveFunction(calleeName(variable), value);
          else if (variable.type === "Identifier") saveFunction(variable.name, value);
        });
      });
    } catch {
      // optional module
    }
  }
}

export function convertLuaUiSource(
  source: string,
  sourceFile: string,
  constants: Map<string, UiValue> = new Map(),
  extraFunctions?: Map<string, FunctionDeclaration>
): UiConversionDocument {
  const context = emptyContext(source, sourceFile, constants);
  if (extraFunctions) {
    for (const [name, declaration] of extraFunctions) context.functions.set(name, declaration);
  }
  try {
    const chunk = luaparse.parse(source, { locations: true, ranges: true, luaVersion: "5.3", encodingMode: "none" });
    collectSymbols(context, chunk.body);
    context.moduleSymbols = new Map(context.symbols);
    scanStatements(context, chunk.body);
    context.candidates.push(...collectReturnedWidgets(context, chunk.body));
  } catch (error) {
    context.diagnostics.push({ severity: "error", message: error instanceof Error ? error.message : String(error) });
  }
  const candidate = pickConversionRoot(context.candidates);
  if (!candidate) {
    return moduleStubDocument(source, sourceFile, context.diagnostics[0]?.message || "no_ui_root_found");
  }
  const designWidth = [...constants.entries()].find(([key, value]) => key.endsWith(".DESIGN_W") && typeof value === "number")?.[1];
  if (typeof designWidth === "number") candidate.props.$previewDesignWidth = designWidth;
  const root = withStableTreeIds(candidate);
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
  if (!node || typeof node !== "object") return 0;
  const children = Array.isArray(node.children) ? node.children : [];
  return (node.type === "Slot" || node.type === "Module" ? 0 : 1) + children.reduce((sum, child) => sum + countConcrete(child), 0);
}

export function convertLuaUiFile(projectRoot: string, relativeFile: string, previewConstants?: Map<string, UiValue>): UiConversionDocument {
  const filename = resolveInsideProject(projectRoot, relativeFile);
  const source = fs.readFileSync(filename, "utf8");
  const constants = new Map(previewConstants ?? loadProjectPreviewConstants(projectRoot));
  for (const [key, value] of loadRequiredConstants(projectRoot, source)) constants.set(key, value);
  const extraFunctions = new Map<string, FunctionDeclaration>();
  registerModuleFunctions(extraFunctions, projectRoot, source);
  return convertLuaUiSource(source, path.relative(projectRoot, filename).split(path.sep).join("/"), constants, extraFunctions);
}

function parseSimpleLiteral(raw: string): UiValue | undefined {
  const value = raw.trim().replace(/,$/, "").trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return decodeLuaString(value);
  if (value === "true" || value === "false") return value === "true";
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("{") && value.endsWith("}")) {
    const parts = value.slice(1, -1).split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.every((part) => /^-?\d+(?:\.\d+)?$/.test(part))) return parts.map(Number);
  }
  return undefined;
}

function tableBodyAfter(source: string, start: number): string | undefined {
  const open = source.indexOf("{", start);
  if (open < 0) return undefined;
  let depth = 0;
  let quote = "";
  for (let index = open; index < source.length; index += 1) {
    const char = source[index]!;
    const previous = source[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") quote = "";
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) return source.slice(open + 1, index);
  }
  return undefined;
}

export function loadProjectPreviewConstants(projectRoot: string): Map<string, UiValue> {
  const constants = new Map<string, UiValue>();
  const scriptsRoot = path.join(projectRoot, "scripts");
  const pending = fs.existsSync(scriptsRoot) ? [scriptsRoot] : [];
  let visited = 0;
  while (pending.length && visited < 500) {
    const directory = pending.pop()!;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) { pending.push(filename); continue; }
      if (!entry.isFile() || !entry.name.endsWith(".lua")) continue;
      visited += 1;
      const source = fs.readFileSync(filename, "utf8");
      for (const match of source.matchAll(/\bUI_STYLE\s*=\s*\{/g)) {
        const body = tableBodyAfter(source, match.index ?? 0);
        if (!body) continue;
        for (const field of body.matchAll(/^\s*([A-Za-z_]\w*)\s*=\s*(\{[^\n{}]*\}|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\d+(?:\.\d+)?|true|false)\s*,?\s*$/gm)) {
          const key = field[1];
          const value = field[2] ? parseSimpleLiteral(field[2]) : undefined;
          if (key && value !== undefined) {
            constants.set(`UI_STYLE.${key}`, value);
            constants.set(`style.${key}`, value);
          }
        }
      }
    }
  }
  return constants;
}

function loadRequiredConstants(projectRoot: string, source: string): Map<string, UiValue> {
  const constants = new Map<string, UiValue>();
  const requires = [...source.matchAll(/local\s+([A-Za-z_]\w*)\s*=\s*require\s*\(\s*["']([^"']+)["']\s*\)/g)];
  for (const match of requires) {
    const [, alias, moduleName] = match;
    if (!alias || !moduleName) continue;
    const relativeModule = `scripts/${moduleName.replace(/\./g, "/")}.lua`;
    try {
      const moduleFile = resolveInsideProject(projectRoot, relativeModule);
      const moduleSource = fs.readFileSync(moduleFile, "utf8");
      const moduleContext = emptyContext(moduleSource, relativeModule, new Map());
      moduleContext.constants = new Map();
      const flatten = (prefix: string, value: UiValue): void => {
        constants.set(prefix, value);
        moduleContext.constants.set(prefix, value);
        if (value && typeof value === "object" && !Array.isArray(value) && !("$expression" in value)) {
          for (const [key, nested] of Object.entries(value)) flatten(`${prefix}.${key}`, nested);
        }
      };
      const chunk = luaparse.parse(moduleSource, { locations: true, ranges: true, luaVersion: "5.3", encodingMode: "none" });
      for (const statement of chunk.body) {
        if (statement.type === "LocalStatement") {
          statement.variables.forEach((variable, index) => {
            const value = statement.init[index];
            if (value) moduleContext.symbols.set(variable.name, { expression: value, appended: [] });
          });
        }
        if (statement.type !== "AssignmentStatement") continue;
        statement.variables.forEach((variable, index) => {
          const valueExpression = statement.init[index];
          if (!valueExpression || variable.type !== "MemberExpression") return;
          const moduleKey = calleeName(variable);
          const separator = moduleKey.indexOf(".");
          const publicKey = separator >= 0 ? `${alias}${moduleKey.slice(separator)}` : `${alias}.${moduleKey}`;
          flatten(publicKey, expressionValue(moduleContext, valueExpression));
        });
      }
      const assignment = new RegExp(`^\\s*${alias}\\.([A-Za-z_]\\w*)\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|-?\\d+(?:\\.\\d+)?|true|false)\\s*$`, "gm");
      for (const valueMatch of moduleSource.matchAll(assignment)) {
        const [, key, raw] = valueMatch;
        if (!key || !raw) continue;
        let value: UiValue;
        if (raw.startsWith('"') || raw.startsWith("'")) value = decodeLuaString(raw);
        else if (raw === "true" || raw === "false") value = raw === "true";
        else value = Number(raw);
        constants.set(`${alias}.${key}`, value);
      }
    } catch {
      // A missing or non-literal module stays dynamic and is completed by Runtime.
    }
  }
  return constants;
}

export function snapshotFromConversion(document: UiConversionDocument): UiSnapshot {
  return { revision: 1, root: document.root, selectedId: firstSelectable(document.root) };
}
