import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_MAKER_ACCOUNT_ID = "default";
export const MAKER_CONSOLE_URL = "https://maker.taptap.cn/";

export type MakerAccountMode = "auto" | "manual";
export type MakerAccountSource = "manual" | "auto" | "global";

export interface MakerAccountRecord {
  id: string;
  label: string;
  home: string;
  builtin?: boolean;
}

export interface ProjectAccountBinding {
  mode: MakerAccountMode;
  accountId?: string;
  /** 上次自动核对成功的账号，断网时仍可隔离项目后台 */
  lastAutoAccountId?: string;
}

export interface MakerAccountFile {
  globalAccountId: string;
  accounts: MakerAccountRecord[];
  projects: Record<string, ProjectAccountBinding>;
}

export interface AccountResolution {
  accountId: string;
  label: string;
  home: string;
  source: MakerAccountSource;
  projectId?: string;
}

export interface MakerAccountView {
  id: string;
  label: string;
  loggedIn: boolean;
  cliLoggedIn: boolean;
  builtin: boolean;
  global: boolean;
}

export interface ActivateMakerHomeResult {
  accountId: string;
  activatedHome: string;
  linkPath: string;
  migrated: boolean;
}

let accountsFileOverride: string | undefined;
let homesRootOverride: string | undefined;
let defaultHomeOverride: string | undefined;
let loginCheck: (home: string) => boolean = (home) => fs.existsSync(path.join(home, "pat.json"));

export function setMakerAccountsFileForTests(file: string | undefined): void {
  accountsFileOverride = file;
  appsCache.clear();
}

export function setMakerHomesRootForTests(dir: string | undefined): void {
  homesRootOverride = dir;
}

export function setDefaultMakerHomeForTests(dir: string | undefined): void {
  defaultHomeOverride = dir;
}

export function setAccountLoginCheckForTests(check: ((home: string) => boolean) | undefined): void {
  loginCheck = check ?? ((home) => fs.existsSync(path.join(home, "pat.json")));
}

export function defaultMakerHome(): string {
  return defaultHomeOverride ?? path.join(os.homedir(), ".taptap-maker");
}

export function accountsFilePath(): string {
  return accountsFileOverride ?? path.join(os.homedir(), ".tapmakerwork", "maker-accounts.json");
}

export function makerHomesRoot(): string {
  return homesRootOverride ?? path.join(os.homedir(), ".tapmakerwork", "maker-homes");
}

export function extraAccountHome(id: string): string {
  return path.join(makerHomesRoot(), id);
}

export function accountSourceLabel(source: MakerAccountSource): string {
  if (source === "manual") return "手动指定";
  if (source === "auto") return "自动核对";
  return "全局账号";
}

function builtinAccount(): MakerAccountRecord {
  return {
    id: DEFAULT_MAKER_ACCOUNT_ID,
    label: "默认账号",
    home: extraAccountHome(DEFAULT_MAKER_ACCOUNT_ID),
    builtin: true
  };
}

function validAccount(value: unknown): value is MakerAccountRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as MakerAccountRecord;
  return typeof row.id === "string" && row.id !== "" && typeof row.label === "string" && row.label !== "" && typeof row.home === "string" && row.home !== "";
}

function sanitizeProjects(projects: unknown, accounts: MakerAccountRecord[]): Record<string, ProjectAccountBinding> {
  if (!projects || typeof projects !== "object") return {};
  const ids = new Set(accounts.map((account) => account.id));
  const next: Record<string, ProjectAccountBinding> = {};
  for (const [key, value] of Object.entries(projects as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const binding = value as ProjectAccountBinding;
    if (binding.mode === "manual" && typeof binding.accountId === "string" && ids.has(binding.accountId)) {
      next[key] = {
        mode: "manual",
        accountId: binding.accountId,
        ...(typeof binding.lastAutoAccountId === "string" && ids.has(binding.lastAutoAccountId)
          ? { lastAutoAccountId: binding.lastAutoAccountId }
          : {})
      };
    } else if (binding.mode === "auto" || binding.mode === "manual") {
      next[key] = {
        mode: "auto",
        ...(typeof binding.lastAutoAccountId === "string" && ids.has(binding.lastAutoAccountId)
          ? { lastAutoAccountId: binding.lastAutoAccountId }
          : {})
      };
    }
  }
  return next;
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

function readLinkTarget(linkPath: string): string | undefined {
  try {
    if (!fs.lstatSync(linkPath).isSymbolicLink()) return undefined;
    const raw = fs.readlinkSync(linkPath);
    return path.resolve(path.dirname(linkPath), raw);
  } catch {
    return undefined;
  }
}

function moveDirectoryContents(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const source = path.join(from, name);
    const dest = path.join(to, name);
    if (fs.existsSync(dest)) continue;
    fs.renameSync(source, dest);
  }
}

/** 把历史上真实的 ~/.taptap-maker 迁到 maker-homes/default，便于之后用符号链接切换全局账号。 */
export function migrateLegacyDefaultHomeIfNeeded(): boolean {
  const link = defaultMakerHome();
  const managed = extraAccountHome(DEFAULT_MAKER_ACCOUNT_ID);
  fs.mkdirSync(managed, { recursive: true });
  let migrated = false;
  try {
    const stat = fs.lstatSync(link);
    if (stat.isSymbolicLink()) return false;
    if (!stat.isDirectory()) return false;
    if (samePath(link, managed)) return false;
    moveDirectoryContents(link, managed);
    try {
      fs.rmdirSync(link);
    } catch {
      fs.renameSync(link, `${link}.legacy-${Date.now()}`);
    }
    migrated = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      // 已有链接或无法读取时，后续 activate 再处理。
    }
  }
  return migrated;
}

function normalizeAccountHome(account: MakerAccountRecord): MakerAccountRecord {
  if (account.id === DEFAULT_MAKER_ACCOUNT_ID) {
    return { ...account, home: extraAccountHome(DEFAULT_MAKER_ACCOUNT_ID), builtin: true };
  }
  if (samePath(account.home, defaultMakerHome())) {
    return { ...account, home: extraAccountHome(account.id) };
  }
  return account;
}

function replaceMakerHomeLink(targetHome: string): string {
  const link = defaultMakerHome();
  const resolvedTarget = path.resolve(targetHome);
  fs.mkdirSync(resolvedTarget, { recursive: true });
  const current = readLinkTarget(link);
  if (current && samePath(current, resolvedTarget)) return resolvedTarget;

  try {
    const stat = fs.lstatSync(link);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(link);
    } else if (stat.isDirectory()) {
      migrateLegacyDefaultHomeIfNeeded();
      try {
        const again = fs.lstatSync(link);
        if (again.isSymbolicLink()) fs.unlinkSync(link);
        else fs.renameSync(link, `${link}.legacy-${Date.now()}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    } else {
      fs.unlinkSync(link);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  fs.mkdirSync(path.dirname(link), { recursive: true });
  if (process.platform === "win32") {
    fs.symlinkSync(resolvedTarget, link, "junction");
  } else {
    fs.symlinkSync(resolvedTarget, link, "dir");
  }
  return resolvedTarget;
}

export function loadMakerAccounts(): MakerAccountFile {
  const fallback: MakerAccountFile = {
    globalAccountId: DEFAULT_MAKER_ACCOUNT_ID,
    accounts: [builtinAccount()],
    projects: {}
  };
  try {
    const parsed = JSON.parse(fs.readFileSync(accountsFilePath(), "utf8")) as Partial<MakerAccountFile>;
    const accounts = Array.isArray(parsed.accounts) ? parsed.accounts.filter(validAccount).map(normalizeAccountHome) : [];
    const builtin = accounts.find((account) => account.id === DEFAULT_MAKER_ACCOUNT_ID);
    if (builtin) {
      builtin.home = extraAccountHome(DEFAULT_MAKER_ACCOUNT_ID);
      builtin.builtin = true;
      if (!builtin.label) builtin.label = "默认账号";
    } else {
      accounts.unshift(builtinAccount());
    }
    for (const account of accounts) {
      if (account.id !== DEFAULT_MAKER_ACCOUNT_ID) {
        fs.mkdirSync(account.home, { recursive: true });
      }
    }
    fs.mkdirSync(extraAccountHome(DEFAULT_MAKER_ACCOUNT_ID), { recursive: true });
    const globalAccountId = accounts.some((account) => account.id === parsed.globalAccountId)
      ? parsed.globalAccountId!
      : DEFAULT_MAKER_ACCOUNT_ID;
    return { globalAccountId, accounts, projects: sanitizeProjects(parsed.projects, accounts) };
  } catch {
    return fallback;
  }
}

export function saveMakerAccounts(store: MakerAccountFile): void {
  const file = accountsFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`);
}

export function projectAccountKey(projectRoot: string): string {
  try {
    return fs.realpathSync(projectRoot);
  } catch {
    return path.resolve(projectRoot);
  }
}

export function readProjectIdentityIds(projectRoot: string): string[] {
  const ids = new Set<string>();
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(projectRoot, ".maker-mcp", "config.json"), "utf8")) as { project_id?: string | number };
    if (parsed.project_id != null && String(parsed.project_id) !== "") ids.add(String(parsed.project_id));
  } catch {
    // 项目还没绑定 Maker 项目时，自动核对无法进行。
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(projectRoot, ".project", "project.json"), "utf8")) as {
      taptap_publish?: { app_id?: string | number };
    };
    const appId = parsed.taptap_publish?.app_id;
    if (appId != null && String(appId) !== "") ids.add(String(appId));
  } catch {
    // 没有发布信息时只靠 project_id。
  }
  return [...ids];
}

export function projectIdsFromAppsPayload(payload: unknown): string[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { projects?: unknown }).projects)
      ? (payload as { projects: unknown[] }).projects
      : payload && typeof payload === "object" && Array.isArray((payload as { apps?: unknown }).apps)
        ? (payload as { apps: unknown[] }).apps
        : [];
  const ids: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    for (const key of ["id", "project_id", "app_id", "appId"]) {
      const value = record[key];
      if (typeof value === "string" && value) ids.push(value);
      else if (typeof value === "number") ids.push(String(value));
    }
  }
  return ids;
}

/** 本机各账号 home 里的 projects.json：按路径或 binding 判断项目归属（不依赖联网）。 */
export function accountHomeOwnsProject(home: string, projectRoot: string, identities: string[] = []): boolean {
  let root: string;
  try {
    root = projectAccountKey(projectRoot);
  } catch {
    root = path.resolve(projectRoot);
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(home, "projects.json"), "utf8")) as {
      projects?: Array<{ path?: string; binding?: string }>;
    };
    for (const row of parsed.projects ?? []) {
      if (typeof row.binding === "string" && identities.includes(row.binding)) return true;
      if (typeof row.path === "string" && row.path) {
        try {
          if (projectAccountKey(row.path) === root) return true;
        } catch {
          if (path.resolve(row.path) === path.resolve(projectRoot)) return true;
        }
      }
    }
  } catch {
    // 该账号尚未登记过本地项目
  }
  return false;
}

function rememberAutoAccount(projectRoot: string, accountId: string): void {
  const store = loadMakerAccounts();
  if (!store.accounts.some((account) => account.id === accountId)) return;
  const key = projectAccountKey(projectRoot);
  const existing = store.projects[key];
  if (existing?.mode === "manual") return;
  if (existing?.mode === "auto" && existing.lastAutoAccountId === accountId) return;
  store.projects[key] = { mode: "auto", lastAutoAccountId: accountId };
  saveMakerAccounts(store);
}

export function accountHasLogin(home: string): boolean {
  return loginCheck(home);
}

export function listAccountHomes(): string[] {
  return [...new Set(loadMakerAccounts().accounts.map((account) => account.home))];
}

export function getMakerAccount(accountId: string): MakerAccountRecord | undefined {
  return loadMakerAccounts().accounts.find((account) => account.id === accountId);
}

export function chooseMakerAccount(input: {
  store: MakerAccountFile;
  projectRoot: string;
  projectId?: string;
  matches: string[];
}): AccountResolution {
  const { store, projectId, matches } = input;
  const byId = (id: string) => store.accounts.find((account) => account.id === id);
  const global = byId(store.globalAccountId) ?? byId(DEFAULT_MAKER_ACCOUNT_ID) ?? builtinAccount();
  const finish = (account: MakerAccountRecord, source: MakerAccountSource): AccountResolution => ({
    accountId: account.id,
    label: account.label,
    home: account.home,
    source,
    ...(projectId ? { projectId } : {})
  });
  const binding = store.projects[input.projectRoot];
  if (binding?.mode === "manual" && binding.accountId) {
    const pinned = byId(binding.accountId);
    if (pinned) return finish(pinned, "manual");
  }
  const unique = [...new Set(matches)].filter((id) => byId(id));
  const matchedId = unique.length === 1 ? unique[0] : undefined;
  const matched = matchedId ? byId(matchedId) : undefined;
  if (store.accounts.length > 1 && matched) return finish(matched, "auto");
  return finish(global, "global");
}

const appsCache = new Map<string, { at: number; ids: string[] }>();
const APPS_CACHE_MS = 30_000;

export function clearMakerAppsCache(): void {
  appsCache.clear();
}

export async function resolveProjectAccount(
  projectRoot: string,
  lookup: (account: MakerAccountRecord) => Promise<string[] | undefined>
): Promise<AccountResolution> {
  const store = loadMakerAccounts();
  const key = projectAccountKey(projectRoot);
  const identities = readProjectIdentityIds(projectRoot);
  const binding = store.projects[key];
  const projectId = identities[0];
  if (binding?.mode === "manual" || store.accounts.length <= 1) {
    return chooseMakerAccount({ store, projectRoot: key, matches: [], ...(projectId ? { projectId } : {}) });
  }

  const finishAuto = (accountId: string): AccountResolution => {
    rememberAutoAccount(key, accountId);
    return chooseMakerAccount({ store: loadMakerAccounts(), projectRoot: key, matches: [accountId], ...(projectId ? { projectId } : {}) });
  };

  // 1) 本机 projects.json：不依赖网络，按路径 / binding 归属账号
  const localMatches: string[] = [];
  for (const account of store.accounts) {
    if (!accountHasLogin(account.home)) continue;
    if (accountHomeOwnsProject(account.home, key, identities)) localMatches.push(account.id);
  }
  const uniqueLocal = [...new Set(localMatches)];
  if (uniqueLocal.length === 1) return finishAuto(uniqueLocal[0]!);

  // 2) 联网 apps 列表核对（有 project_id / app_id 时）
  const remoteMatches: string[] = [];
  if (identities.length > 0) {
    for (const account of store.accounts) {
      if (!accountHasLogin(account.home)) continue;
      const cached = appsCache.get(account.id);
      const fresh = cached && Date.now() - cached.at < APPS_CACHE_MS ? cached.ids : undefined;
      let listed = fresh;
      if (!listed) {
        try {
          listed = await lookup(account);
        } catch {
          listed = undefined;
        }
        if (listed) appsCache.set(account.id, { at: Date.now(), ids: listed });
      }
      if (listed && identities.some((id) => listed.includes(id))) remoteMatches.push(account.id);
    }
  }
  const uniqueRemote = [...new Set(remoteMatches)];
  if (uniqueRemote.length === 1) return finishAuto(uniqueRemote[0]!);

  // 3) 本地与联网都无法唯一判定时，用上次自动核对缓存（断网 / apps 失败）
  if (
    uniqueRemote.length === 0
    && uniqueLocal.length === 0
    && binding?.lastAutoAccountId
    && store.accounts.some((account) => account.id === binding.lastAutoAccountId)
  ) {
    return chooseMakerAccount({
      store,
      projectRoot: key,
      matches: [binding.lastAutoAccountId],
      ...(projectId ? { projectId } : {})
    });
  }

  return chooseMakerAccount({
    store,
    projectRoot: key,
    matches: uniqueRemote.length ? uniqueRemote : uniqueLocal,
    ...(projectId ? { projectId } : {})
  });
}

export function makerAccountSnapshot(projectRoot?: string, resolution?: AccountResolution, activation?: ActivateMakerHomeResult): {
  globalAccountId: string;
  accounts: MakerAccountView[];
  activatedHome?: string;
  linkPath?: string;
  project?: {
    mode: MakerAccountMode;
    accountId?: string;
    resolved?: { accountId: string; label: string; source: MakerAccountSource };
  };
} {
  const store = loadMakerAccounts();
  const accounts = store.accounts.map((account) => {
    const cliLoggedIn = accountHasLogin(account.home);
    return {
      id: account.id,
      label: account.label,
      loggedIn: cliLoggedIn,
      cliLoggedIn,
      builtin: Boolean(account.builtin),
      global: account.id === store.globalAccountId
    };
  });
  const base = {
    globalAccountId: store.globalAccountId,
    accounts,
    ...(activation ? { activatedHome: activation.activatedHome, linkPath: activation.linkPath } : {})
  };
  if (!projectRoot) return base;
  const binding = store.projects[projectAccountKey(projectRoot)];
  return {
    ...base,
    project: {
      mode: binding?.mode ?? "auto",
      ...(binding?.accountId ? { accountId: binding.accountId } : {}),
      ...(resolution ? { resolved: { accountId: resolution.accountId, label: resolution.label, source: resolution.source } } : {})
    }
  };
}

export function activateGlobalMakerHome(accountId?: string): ActivateMakerHomeResult {
  const migrated = migrateLegacyDefaultHomeIfNeeded();
  const store = loadMakerAccounts();
  let dirty = false;
  for (const account of store.accounts) {
    const normalized = normalizeAccountHome(account);
    if (!samePath(account.home, normalized.home) || Boolean(account.builtin) !== Boolean(normalized.builtin)) {
      account.home = normalized.home;
      if (normalized.builtin) account.builtin = true;
      else delete account.builtin;
      dirty = true;
    }
    fs.mkdirSync(account.home, { recursive: true });
  }
  const id = accountId && store.accounts.some((account) => account.id === accountId)
    ? accountId
    : store.globalAccountId;
  const account = store.accounts.find((item) => item.id === id)
    ?? store.accounts.find((item) => item.id === DEFAULT_MAKER_ACCOUNT_ID)
    ?? builtinAccount();
  if (store.globalAccountId !== account.id) {
    store.globalAccountId = account.id;
    dirty = true;
  }
  if (dirty) saveMakerAccounts(store);
  const activatedHome = replaceMakerHomeLink(account.home);
  return {
    accountId: account.id,
    activatedHome,
    linkPath: defaultMakerHome(),
    migrated
  };
}

export function setGlobalMakerAccount(accountId: string): ActivateMakerHomeResult {
  const store = loadMakerAccounts();
  if (!store.accounts.some((account) => account.id === accountId)) throw new Error("maker_account_not_found");
  store.globalAccountId = accountId;
  saveMakerAccounts(store);
  clearMakerAppsCache();
  return activateGlobalMakerHome(accountId);
}

export function addMakerAccount(label: string): MakerAccountRecord {
  const store = loadMakerAccounts();
  const id = `acc_${crypto.randomBytes(4).toString("hex")}`;
  const home = extraAccountHome(id);
  fs.mkdirSync(home, { recursive: true });
  const record: MakerAccountRecord = { id, label: label.trim() || `账号 ${store.accounts.length + 1}`, home };
  store.accounts.push(record);
  saveMakerAccounts(store);
  return record;
}

export function renameMakerAccount(accountId: string, label: string): void {
  const store = loadMakerAccounts();
  const account = store.accounts.find((item) => item.id === accountId);
  if (!account) throw new Error("maker_account_not_found");
  const next = label.trim();
  if (!next) throw new Error("maker_account_label_required");
  account.label = next;
  saveMakerAccounts(store);
}

export function removeMakerAccount(accountId: string): ActivateMakerHomeResult | undefined {
  const store = loadMakerAccounts();
  const account = store.accounts.find((item) => item.id === accountId);
  if (!account) throw new Error("maker_account_not_found");
  if (account.builtin || account.id === DEFAULT_MAKER_ACCOUNT_ID) throw new Error("maker_account_builtin");
  const wasGlobal = store.globalAccountId === accountId;
  store.accounts = store.accounts.filter((item) => item.id !== accountId);
  if (wasGlobal) store.globalAccountId = DEFAULT_MAKER_ACCOUNT_ID;
  for (const [key, binding] of Object.entries(store.projects)) {
    if (binding.accountId === accountId) store.projects[key] = { mode: "auto" };
  }
  saveMakerAccounts(store);
  clearMakerAppsCache();
  if (wasGlobal) return activateGlobalMakerHome(DEFAULT_MAKER_ACCOUNT_ID);
  return undefined;
}

export function setProjectMakerAccount(projectRoot: string, mode: MakerAccountMode, accountId?: string): void {
  const store = loadMakerAccounts();
  const key = projectAccountKey(projectRoot);
  const existing = store.projects[key];
  if (mode === "manual") {
    if (!accountId || !store.accounts.some((account) => account.id === accountId)) throw new Error("maker_account_not_found");
    store.projects[key] = {
      mode: "manual",
      accountId,
      ...(typeof existing?.lastAutoAccountId === "string" ? { lastAutoAccountId: existing.lastAutoAccountId } : {})
    };
  } else {
    store.projects[key] = {
      mode: "auto",
      ...(typeof existing?.lastAutoAccountId === "string" ? { lastAutoAccountId: existing.lastAutoAccountId } : {})
    };
  }
  saveMakerAccounts(store);
}
