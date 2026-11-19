import fs from "node:fs";
import path from "node:path";
import luaparse, { type Expression, type FunctionDeclaration } from "luaparse";
import { maskLua54Attributes } from "./lua-symbols.js";
import {
  adapterModuleName,
  adapterTemplateFile,
  detectUiBackend,
  type UiBackend
} from "./ui-backend.js";
import { UI_OVERRIDES_RELATIVE, UI_OVERRIDES_STUB } from "./ui-overrides.js";

export interface AdapterExportResult {
  outputDir: string;
  files: string[];
  project: string;
  adapterInstalledInProject: boolean;
  backend?: UiBackend;
  nextSteps: string[];
}

export interface AdapterInstallResult {
  ok: true;
  projectRoot: string;
  adapterPath: string;
  entryPath: string;
  backend: UiBackend;
  backupPath?: string;
  changed: boolean;
  requiresPreviewRefresh: boolean;
}

const BOOTSTRAP_START = "-- >>> TapMakerWork live editor (managed)";
const BOOTSTRAP_END = "-- <<< TapMakerWork live editor (managed)";
const START_CALL = "TapMakerWorkLiveEditorStart() -- TapMakerWork managed";
const UPDATE_CALL_PATTERN = /TapMakerWorkLiveEditorUpdate\((?:[A-Za-z_]\w*|TapMakerWorkLiveEditorTimeStep\([A-Za-z_]\w*\))\) -- TapMakerWork managed/;
const BOM = "\uFEFF";

/** Any `local <name> = <eventData>:GetFloat("TimeStep")` or `<eventData>["TimeStep"]:GetFloat()` line. */
const TIME_STEP_LINE =
  /local\s+([A-Za-z_]\w*)\s*=\s*[A-Za-z_]\w*(?::GetFloat\(\s*["']TimeStep["']\s*\)|\[\s*["']TimeStep["']\s*\]:GetFloat\(\s*\))/;

const ADAPTER_ERROR_HINTS: Record<string, string> = {
  maker_project_config_invalid: ".project/project.json 不是合法 JSON，无法确定客户端入口。",
  maker_client_entry_not_found: "没有找到客户端入口脚本（project.json 的 entry@client / entry，或 scripts/main.lua）。",
  runtime_adapter_start_hook_not_found: "入口脚本里没有 function Start()，无法挂载实时编辑桥。",
  runtime_adapter_entry_parse_failed: "无法解析客户端入口脚本；未修改项目文件。",
  runtime_adapter_update_hook_not_found:
    "未能定位入口脚本中处理 Update 事件（TimeStep）的函数；未修改项目文件。"
};

function adapterError(code: string): Error {
  const hint = ADAPTER_ERROR_HINTS[code];
  return new Error(hint ? `${code}：${hint}` : code);
}

function editorUpdateIsInScope(source: string): boolean {
  const definedAt = source.indexOf("local function TapMakerWorkLiveEditorUpdate");
  const calledAt = source.search(UPDATE_CALL_PATTERN);
  return definedAt >= 0 && calledAt > definedAt;
}

function stripManagedEditor(source: string): string {
  let next = source;
  const start = next.indexOf(BOOTSTRAP_START);
  const end = next.indexOf(BOOTSTRAP_END);
  if (start >= 0 && end > start) {
    let cut = end + BOOTSTRAP_END.length;
    while (next[cut] === "\r" || next[cut] === "\n" || next[cut] === BOM) cut += 1;
    next = `${next.slice(0, start)}${next.slice(cut)}`;
  }
  return next
    .replace(/^[ \t]*TapMakerWorkLiveEditorStart\(\) -- TapMakerWork managed\r?\n/gm, "")
    .replace(new RegExp(`^[ \\t]*${UPDATE_CALL_PATTERN.source}\\r?\\n`, "gm"), "");
}

function luaLiteral(expression?: Expression): string | undefined {
  return expression?.type === "StringLiteral" ? /^['"]([A-Za-z_]\w*)['"]$/.exec(expression.raw)?.[1] : undefined;
}

function wireRuntimeHooks(source: string, eol: string): string {
  const subscribed = new Set<string>();
  let declarations: FunctionDeclaration[];
  try {
    const chunk = luaparse.parse(maskLua54Attributes(source), {
      luaVersion: "5.3", encodingMode: "none", ranges: true,
      onCreateNode(node) {
        if (node.type !== "CallExpression" || node.base.type !== "Identifier" || node.base.name !== "SubscribeToEvent") return;
        if (luaLiteral(node.arguments.at(-2)) !== "Update") return;
        const handler = luaLiteral(node.arguments.at(-1));
        if (handler) subscribed.add(handler);
      }
    });
    declarations = chunk.body.filter((node): node is FunctionDeclaration => node.type === "FunctionDeclaration" && !node.isLocal);
  } catch (error) {
    throw new Error(`${adapterError("runtime_adapter_entry_parse_failed").message} ${String(error)}`);
  }

  const named = (fn: FunctionDeclaration) => fn.identifier?.type === "Identifier" ? fn.identifier.name : "";
  const start = declarations.find((fn) => named(fn) === "Start");
  if (!start) throw adapterError("runtime_adapter_start_hook_not_found");
  const rangeOf = (node: object) => (node as { range: [number, number] }).range;
  const timeStepIndex = (fn: FunctionDeclaration) => fn.body.findIndex((node) => node.type === "LocalStatement"
    && node.init.length === 1 && node.variables.length === 1 && TIME_STEP_LINE.test(source.slice(...rangeOf(node))));
  const updates = declarations.filter((fn) => fn !== start && (subscribed.size
    ? subscribed.has(named(fn))
    : /^(Handle(?:App)?Update|Update)$/.test(named(fn))));
  const candidateUpdates = updates.length || subscribed.size ? updates : declarations.filter((fn) => fn !== start && timeStepIndex(fn) >= 0);
  const update = candidateUpdates.length === 1 ? candidateUpdates[0] : undefined;
  if (!update) throw adapterError("runtime_adapter_update_hook_not_found");
  const timeStep = timeStepIndex(update);
  const eventData = update.parameters[1];
  const delta = timeStep >= 0
    ? TIME_STEP_LINE.exec(source.slice(...rangeOf(update.body[timeStep]!)))![1]
    : eventData?.type === "Identifier" ? `TapMakerWorkLiveEditorTimeStep(${eventData.name})` : undefined;
  if (!delta) throw adapterError("runtime_adapter_update_hook_not_found");

  const appInit = start.body.findIndex((node) => node.type === "CallStatement" && /^app_:Init\(\)$/.test(source.slice(...rangeOf(node))));
  const insert = (fn: FunctionDeclaration, index: number, hook: string) => {
    const next = fn.body[index];
    const at = next ? rangeOf(next)[0] : rangeOf(fn)[1] - 3;
    const lineStart = source.lastIndexOf("\n", at - 1) + 1;
    const inline = /\S/.test(source.slice(lineStart, at));
    return { at: inline ? at : lineStart, text: `${inline ? eol : ""}    ${hook}${eol}` };
  };
  const edits = [insert(start, appInit + 1, START_CALL), insert(update, timeStep + 1, `TapMakerWorkLiveEditorUpdate(${delta}) -- TapMakerWork managed`)];
  return edits.sort((left, right) => right.at - left.at).reduce(
    (result, edit) => result.slice(0, edit.at) + edit.text + result.slice(edit.at), source
  );
}

function timestampForPath(): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.hrtime.bigint()}`;
}

function resolveMakerClientEntry(projectRoot: string): string {
  const scriptsRoot = path.join(projectRoot, "scripts");
  const projectConfigPath = path.join(projectRoot, ".project", "project.json");
  const candidates: string[] = [];

  if (fs.existsSync(projectConfigPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(projectConfigPath, "utf8")) as Record<string, unknown>;
      for (const key of ["entry@client", "entry"]) {
        const value = config[key];
        if (typeof value === "string" && value.trim()) candidates.push(value.trim());
      }
    } catch {
      throw adapterError("maker_project_config_invalid");
    }
  }
  candidates.push("main.lua");

  for (const candidate of [...new Set(candidates)]) {
    const normalized = candidate.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^scripts\//, "");
    if (!normalized || path.isAbsolute(normalized) || normalized.split("/").includes("..")) continue;
    for (const relative of path.extname(normalized) ? [normalized] : [normalized, `${normalized}.lua`]) {
      const entryPath = path.resolve(scriptsRoot, relative);
      if (entryPath.startsWith(`${path.resolve(scriptsRoot)}${path.sep}`) && fs.existsSync(entryPath)) return entryPath;
    }
  }
  throw adapterError("maker_client_entry_not_found");
}

function escapeLuaString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

/** Prefer publish title / project.json name, then folder basename — Config.lua is optional. */
export function resolveBootstrapProjectName(projectRoot: string): string {
  try {
    const metadata = JSON.parse(fs.readFileSync(path.join(projectRoot, ".project", "project.json"), "utf8")) as {
      name?: unknown;
      taptap_publish?: { title?: unknown };
    };
    const title = metadata.taptap_publish?.title;
    if (typeof title === "string" && title.trim()) return title.trim();
    if (typeof metadata.name === "string" && metadata.name.trim()) return metadata.name.trim();
  } catch {
    // project.json is optional during adapter unit tests.
  }
  return path.basename(path.resolve(projectRoot));
}

function projectNameBootstrapSnippet(projectName: string): string {
  return `    local projectName = "${escapeLuaString(projectName)}"`;
}

const TIME_STEP_HELPER = `local function TapMakerWorkLiveEditorTimeStep(eventData)
    if eventData ~= nil then
        local ok, dt = pcall(function() return eventData:GetFloat("TimeStep") end)
        if ok and type(dt) == "number" then return dt end
        ok, dt = pcall(function() return eventData["TimeStep"]:GetFloat() end)
        if ok and type(dt) == "number" then return dt end
    end
    return 1 / 60
end`;

function yogaBootstrap(projectName: string): string {
  return `${BOOTSTRAP_START}
-- Source tracking for Lua writeback (must run before UI trees are built).
UI_INSPECTOR_ENABLED = true
local tapMakerWorkLiveEditor_ = nil

local function TapMakerWorkLiveEditorStart()
    if IsServerMode and IsServerMode() then return end
    UI_INSPECTOR_ENABLED = true
    local okBridge, bridge = pcall(require, "tapmakerwork/TapMakerWorkBridge")
    local okUi, UI = pcall(require, "urhox-libs/UI")
    if not okBridge or not okUi then
        print("[TapMakerWork] live editor unavailable: " .. tostring(okBridge and UI or bridge))
        return
    end
${projectNameBootstrapSnippet(projectName)}
    tapMakerWorkLiveEditor_ = bridge
    bridge.Start({
        url = "http://127.0.0.1:43121",
        pollInterval = 0.05,
        snapshotInterval = 0.35,
        projectName = projectName,
        rootProvider = function() return UI.GetRoot() end,
    })
end

local function TapMakerWorkLiveEditorUpdate(dt)
    if tapMakerWorkLiveEditor_ then tapMakerWorkLiveEditor_.Update(dt) end
end
${TIME_STEP_HELPER}
${BOOTSTRAP_END}

`;
}

function nanovgBootstrap(projectName: string): string {
  return `${BOOTSTRAP_START}
local tapMakerWorkLiveEditor_ = nil

local function TapMakerWorkLiveEditorStart()
    if IsServerMode and IsServerMode() then return end
    local okBridge, bridge = pcall(require, "tapmakerwork/TapMakerWorkNanoVGBridge")
    if not okBridge then
        print("[TapMakerWork] NanoVG live editor unavailable: " .. tostring(bridge))
        return
    end
${projectNameBootstrapSnippet(projectName)}
    tapMakerWorkLiveEditor_ = bridge
    bridge.Start({
        url = "http://127.0.0.1:43121",
        pollInterval = 0.05,
        snapshotInterval = 0.35,
        projectName = projectName,
    })
end

local function TapMakerWorkLiveEditorUpdate(dt)
    if tapMakerWorkLiveEditor_ then tapMakerWorkLiveEditor_.Update(dt) end
end
${TIME_STEP_HELPER}
${BOOTSTRAP_END}

`;
}

function bootstrapFor(backend: UiBackend, projectName: string): string {
  return backend === "nanovg" ? nanovgBootstrap(projectName) : yogaBootstrap(projectName);
}

function entryMatchesBackend(source: string, backend: UiBackend): boolean {
  const moduleName = adapterModuleName(backend);
  return source.includes(`tapmakerwork/${moduleName}`);
}

function findRepoRoot(fromDir: string): string {
  if (process.env.TAPMAKERWORK_APP_ROOT) return process.env.TAPMAKERWORK_APP_ROOT;
  let current = fromDir;
  for (let index = 0; index < 8; index += 1) {
    if (fs.existsSync(path.join(current, "package.json")) && fs.existsSync(path.join(current, "packages"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return fromDir;
}

function extractManagedBootstrap(source: string): string | undefined {
  const start = source.indexOf(BOOTSTRAP_START);
  const end = source.indexOf(BOOTSTRAP_END);
  if (start < 0 || end < start) return undefined;
  let cut = end + BOOTSTRAP_END.length;
  while (source[cut] === "\r" || source[cut] === "\n") cut += 1;
  return source.slice(start, cut);
}

function normalizeBootstrapText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

export function installRuntimeAdapter(options: {
  bridgePackageRoot: string;
  projectRoot: string;
  backend?: UiBackend;
}): AdapterInstallResult {
  const repoRoot = findRepoRoot(options.bridgePackageRoot);
  const projectRoot = path.resolve(options.projectRoot);
  const backend = options.backend ?? detectUiBackend(projectRoot);
  const bootstrapName = resolveBootstrapProjectName(projectRoot);
  const templateName = adapterTemplateFile(backend);
  const templatePath = path.join(repoRoot, "runtime", "lua", templateName);
  if (!fs.existsSync(templatePath)) throw new Error("adapter_template_not_found");

  const entryPath = resolveMakerClientEntry(projectRoot);
  const original = fs.readFileSync(entryPath, "utf8");
  const hasBom = original.startsWith(BOM);
  const source = hasBom ? original.slice(BOM.length) : original;
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const expectedBootstrap = bootstrapFor(backend, bootstrapName);
  const currentBootstrap = extractManagedBootstrap(source);
  const bootstrapCurrent = Boolean(currentBootstrap)
    && normalizeBootstrapText(currentBootstrap!) === normalizeBootstrapText(expectedBootstrap);
  const alreadyManaged = editorUpdateIsInScope(source)
    && source.includes(BOOTSTRAP_START)
    && source.includes(START_CALL)
    && UPDATE_CALL_PATTERN.test(source)
    && entryMatchesBackend(source, backend)
    && bootstrapCurrent
    && !source.includes(BOM);
  let next = alreadyManaged ? source : stripManagedEditor(source).replaceAll(BOM, "");

  if (!alreadyManaged) {
    next = expectedBootstrap.replace(/\n/g, eol) + wireRuntimeHooks(next, eol);
  }
  next = hasBom ? `${BOM}${next}` : next;

  const adapterPath = path.join(projectRoot, "scripts", "tapmakerwork", templateName);
  const adapterSource = fs.readFileSync(templatePath, "utf8");
  const adapterChanged = !fs.existsSync(adapterPath) || fs.readFileSync(adapterPath, "utf8") !== adapterSource;
  const entryChanged = next !== original;
  let backupPath: string | undefined;
  if (entryChanged) {
    const backupDir = path.join(projectRoot, ".tapmakerwork", "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    backupPath = path.join(backupDir, `${path.basename(entryPath)}.${timestampForPath()}.bak`);
    fs.copyFileSync(entryPath, backupPath, fs.constants.COPYFILE_EXCL);
  }
  fs.mkdirSync(path.dirname(adapterPath), { recursive: true });
  if (adapterChanged) fs.writeFileSync(adapterPath, adapterSource, "utf8");
  if (entryChanged) fs.writeFileSync(entryPath, next, "utf8");
  const overridesPath = path.join(projectRoot, UI_OVERRIDES_RELATIVE);
  const overridesMissing = !fs.existsSync(overridesPath);
  if (overridesMissing) {
    fs.mkdirSync(path.dirname(overridesPath), { recursive: true });
    fs.writeFileSync(overridesPath, UI_OVERRIDES_STUB, "utf8");
  }

  return {
    ok: true,
    projectRoot,
    adapterPath,
    entryPath,
    backend,
    ...(backupPath ? { backupPath } : {}),
    changed: adapterChanged || entryChanged || overridesMissing,
    requiresPreviewRefresh: adapterChanged || entryChanged || overridesMissing
  };
}

export function exportRuntimeAdapterPackage(options: {
  bridgePackageRoot: string;
  projectName?: string | undefined;
  projectRoot?: string | undefined;
}): AdapterExportResult {
  const repoRoot = findRepoRoot(options.bridgePackageRoot);
  const backend = options.projectRoot ? detectUiBackend(options.projectRoot) : "yoga";
  const templateName = adapterTemplateFile(backend);
  const templatePath = path.join(repoRoot, "runtime", "lua", templateName);
  const yogaTemplate = path.join(repoRoot, "runtime", "lua", "TapMakerWorkBridge.lua");
  const nanovgTemplate = path.join(repoRoot, "runtime", "lua", "TapMakerWorkNanoVGBridge.lua");
  if (!fs.existsSync(templatePath)) throw new Error("adapter_template_not_found");
  const outputDir = process.env.TAPMAKERWORK_OUTPUTS_DIR
    ? path.join(process.env.TAPMAKERWORK_OUTPUTS_DIR, "runtime-adapter")
    : path.join(repoRoot, "outputs", "runtime-adapter");
  fs.mkdirSync(outputDir, { recursive: true });

  const files: string[] = [];
  for (const source of [yogaTemplate, nanovgTemplate]) {
    if (!fs.existsSync(source)) continue;
    const out = path.join(outputDir, path.basename(source));
    fs.writeFileSync(out, fs.readFileSync(source, "utf8"), "utf8");
    files.push(out);
  }

  const stubOut = path.join(outputDir, "UiOverrides.lua");
  fs.writeFileSync(stubOut, UI_OVERRIDES_STUB, "utf8");
  files.push(stubOut);

  const projectName = options.projectName ?? "your-maker-project";
  const integration = `-- TapMakerWork Runtime adapter integration sketch
-- Project: ${projectName}
-- Detected backend: ${backend}
-- Generated: ${new Date().toISOString()}
--
-- Yoga (urhox-libs/UI):
--   require("tapmakerwork/TapMakerWorkBridge")
--   bridge.Start({ rootProvider = function() return UI.GetRoot() end })
--
-- NanoVG (raw nvg* draw calls):
--   require("tapmakerwork/TapMakerWorkNanoVGBridge")
--   bridge.Start({ url = "http://127.0.0.1:43121" })
--   -- Draw proxies install automatically; no game rewrite required.
--
-- Call Update(dt) from the existing update loop.
-- This export is a review package. It does NOT modify any Maker project.
`;
  const integrationOut = path.join(outputDir, "integration-main.lua.example");
  fs.writeFileSync(integrationOut, integration, "utf8");
  files.push(integrationOut);

  const readme = `# TapMakerWork Runtime adapter package

创建于 ${new Date().toISOString().slice(0, 10)}

This package is generated by TapMakerWork Bridge and is **not installed** into any Maker project.

## Contents

- \`TapMakerWorkBridge.lua\` — Yoga / \`urhox-libs/UI\` widget-tree adapter
- \`TapMakerWorkNanoVGBridge.lua\` — NanoVG draw-call proxy adapter
- \`UiOverrides.lua\` — stub replay module; the IDE regenerates it when a live edit cannot be written into game Lua
- \`integration-main.lua.example\` — host bootstrap sketch for ${projectName} (detected: ${backend})

## Install later (manual review)

1. Prefer IDE 「接入当前项目」— it auto-detects Yoga vs NanoVG and injects the matching bridge.
2. Or copy the matching adapter into \`scripts/tapmakerwork/\` and wire \`Start\` + \`Update(dt)\`.
3. Start TapMakerWork IDE bound to that project, then start Maker preview.
4. Confirm Bridge health shows \`runtimeSessionId\`, then apply a visual patch and verify game state survives.

## Safety

- Export destination is inside TapMakerWork \`outputs/runtime-adapter\`.
- Pilot project writes remain a separate, explicit step.
`;
  const readmeOut = path.join(outputDir, "README.md");
  fs.writeFileSync(readmeOut, readme, "utf8");
  files.push(readmeOut);

  let adapterInstalledInProject = false;
  const projectRoot = options.projectRoot;
  if (projectRoot) {
    adapterInstalledInProject = [
      "scripts/tapmakerwork/TapMakerWorkBridge.lua",
      "scripts/tapmakerwork/TapMakerWorkNanoVGBridge.lua",
      "scripts/core/TapMakerWorkBridge.lua",
      "scripts/TapMakerWorkBridge.lua",
      "scripts/ui/TapMakerWorkBridge.lua"
    ].some((relative) => fs.existsSync(path.join(projectRoot, relative)));
  }

  return {
    outputDir,
    files,
    project: projectName,
    backend,
    adapterInstalledInProject,
    nextSteps: [
      "审阅 outputs/runtime-adapter 中的 Yoga / NanoVG 适配器",
      "优先用 IDE「接入当前项目」自动识别并注入",
      "重启预览后确认 health 出现 runtimeSessionId",
      "再在 IDE 中打视觉补丁并验证游戏状态不丢"
    ]
  };
}
