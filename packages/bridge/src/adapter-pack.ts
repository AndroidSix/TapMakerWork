import fs from "node:fs";
import path from "node:path";

export interface AdapterExportResult {
  outputDir: string;
  files: string[];
  project: string;
  adapterInstalledInProject: boolean;
  nextSteps: string[];
}

export interface AdapterInstallResult {
  ok: true;
  projectRoot: string;
  adapterPath: string;
  entryPath: string;
  backupPath?: string;
  changed: boolean;
  requiresPreviewRefresh: boolean;
}

const BOOTSTRAP_START = "-- >>> TapMakerWork live editor (managed)";
const BOOTSTRAP_END = "-- <<< TapMakerWork live editor (managed)";
const START_CALL = "TapMakerWorkLiveEditorStart() -- TapMakerWork managed";
const UPDATE_CALL = "TapMakerWorkLiveEditorUpdate(dt) -- TapMakerWork managed";

function timestampForPath(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
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
      throw new Error("maker_project_config_invalid");
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
  throw new Error("maker_client_entry_not_found");
}

export function installRuntimeAdapter(options: {
  bridgePackageRoot: string;
  projectRoot: string;
}): AdapterInstallResult {
  const repoRoot = findRepoRoot(options.bridgePackageRoot);
  const templatePath = path.join(repoRoot, "runtime", "lua", "TapMakerWorkBridge.lua");
  if (!fs.existsSync(templatePath)) throw new Error("adapter_template_not_found");

  const projectRoot = path.resolve(options.projectRoot);
  const entryPath = resolveMakerClientEntry(projectRoot);
  const original = fs.readFileSync(entryPath, "utf8");
  const alreadyManaged = original.includes(BOOTSTRAP_START)
    && original.includes(START_CALL)
    && original.includes(UPDATE_CALL);
  let next = original;

  if (!alreadyManaged) {
    if (original.includes(BOOTSTRAP_START) || original.includes(BOOTSTRAP_END)) {
      throw new Error("runtime_adapter_partial_install");
    }
    if (!/\bapp_:Init\(\)/.test(original)) throw new Error("runtime_adapter_start_hook_not_found");
    if (!/local\s+dt\s*=\s*eventData:GetFloat\(["']TimeStep["']\)/.test(original)) {
      throw new Error("runtime_adapter_update_hook_not_found");
    }

    const bootstrap = `${BOOTSTRAP_START}
local tapMakerWorkLiveEditor_ = nil

local function TapMakerWorkLiveEditorStart()
    if IsServerMode and IsServerMode() then return end
    local okBridge, bridge = pcall(require, "tapmakerwork/TapMakerWorkBridge")
    local okUi, UI = pcall(require, "urhox-libs/UI")
    if not okBridge or not okUi then
        print("[TapMakerWork] live editor unavailable: " .. tostring(okBridge and UI or bridge))
        return
    end
    tapMakerWorkLiveEditor_ = bridge
    bridge.Start({
        url = "http://127.0.0.1:43121",
        pollInterval = 0.05,
        snapshotInterval = 0.35,
        rootProvider = function() return UI.GetRoot() end,
    })
end

local function TapMakerWorkLiveEditorUpdate(dt)
    if tapMakerWorkLiveEditor_ then tapMakerWorkLiveEditor_.Update(dt) end
end
${BOOTSTRAP_END}

`;
    const startIndex = next.search(/\bfunction\s+Start\s*\(/);
    if (startIndex < 0) throw new Error("maker_start_function_not_found");
    next = next.slice(0, startIndex) + bootstrap + next.slice(startIndex);
    next = next.replace(/(\bapp_:Init\(\)[^\n]*\n)/, `$1    ${START_CALL}\n`);
    next = next.replace(
      /(local\s+dt\s*=\s*eventData:GetFloat\(["']TimeStep["']\)[^\n]*\n)/,
      `$1    ${UPDATE_CALL}\n`
    );
  }

  const adapterPath = path.join(projectRoot, "scripts", "tapmakerwork", "TapMakerWorkBridge.lua");
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

  return {
    ok: true,
    projectRoot,
    adapterPath,
    entryPath,
    ...(backupPath ? { backupPath } : {}),
    changed: adapterChanged || entryChanged,
    requiresPreviewRefresh: adapterChanged || entryChanged
  };
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

export function exportRuntimeAdapterPackage(options: {
  bridgePackageRoot: string;
  projectName?: string | undefined;
  projectRoot?: string | undefined;
}): AdapterExportResult {
  const repoRoot = findRepoRoot(options.bridgePackageRoot);
  const templatePath = path.join(repoRoot, "runtime", "lua", "TapMakerWorkBridge.lua");
  if (!fs.existsSync(templatePath)) throw new Error("adapter_template_not_found");
  const outputDir = process.env.TAPMAKERWORK_OUTPUTS_DIR
    ? path.join(process.env.TAPMAKERWORK_OUTPUTS_DIR, "runtime-adapter")
    : path.join(repoRoot, "outputs", "runtime-adapter");
  fs.mkdirSync(outputDir, { recursive: true });

  const adapterSource = fs.readFileSync(templatePath, "utf8");
  const files: string[] = [];

  const adapterOut = path.join(outputDir, "TapMakerWorkBridge.lua");
  fs.writeFileSync(adapterOut, adapterSource, "utf8");
  files.push(adapterOut);

  const projectName = options.projectName ?? "your-maker-project";
  const integration = `-- TapMakerWork Runtime adapter integration sketch
-- Project: ${projectName}
-- Generated: ${new Date().toISOString()}
--
-- 1) Copy TapMakerWorkBridge.lua into the project, e.g. scripts/core/TapMakerWorkBridge.lua
-- 2) From the game bootstrap / main UI host, after the UI root exists:

local TapMakerWorkBridge = require("core.TapMakerWorkBridge")

-- Call once after UI.SetRoot / first screen mount:
TapMakerWorkBridge.Start({
  url = "http://127.0.0.1:43121",
  pollInterval = 0.1,
  frames = false,
  rootProvider = function()
    return UI.GetRoot()
  end,
})

-- Call every frame from the existing update loop:
-- TapMakerWorkBridge.Update(dt)

-- 3) Keep TapMakerWork IDE running with the same project bound.
-- 4) Do not use official preview refresh for live visual patches.
--
-- This export is a review package. It does NOT modify any Maker project.
`;
  const integrationOut = path.join(outputDir, "integration-main.lua.example");
  fs.writeFileSync(integrationOut, integration, "utf8");
  files.push(integrationOut);

  const readme = `# TapMakerWork Runtime adapter package

创建于 ${new Date().toISOString().slice(0, 10)}

This package is generated by TapMakerWork Bridge and is **not installed** into any Maker project.

## Contents

- \`TapMakerWorkBridge.lua\` — staged Runtime command-queue adapter
- \`integration-main.lua.example\` — host bootstrap sketch for ${projectName}

## Install later (manual review)

1. Copy \`TapMakerWorkBridge.lua\` into the pilot project under \`scripts/core/\` (or another reviewed path).
2. Wire \`Start\` + \`Update(dt)\` using the example, pointing \`rootProvider\` at the live UI root.
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
      "scripts/core/TapMakerWorkBridge.lua",
      "scripts/TapMakerWorkBridge.lua",
      "scripts/ui/TapMakerWorkBridge.lua"
    ].some((relative) => fs.existsSync(path.join(projectRoot, relative)));
  }

  return {
    outputDir,
    files,
    project: projectName,
    adapterInstalledInProject,
    nextSteps: [
      "审阅 outputs/runtime-adapter 中的适配器与接入示例",
      "人工复制到 Maker 项目并在主循环接入 Start/Update",
      "重启 IDE 绑定项目后启动预览，确认 health 出现 runtimeSessionId",
      "再在 IDE 中打视觉补丁并验证游戏状态不丢"
    ]
  };
}
