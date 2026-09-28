import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_MAKER_ACCOUNT_ID = "default";

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
  builtin: boolean;
  global: boolean;
}

let accountsFileOverride: string | undefined;
let homesRootOverride: string | undefined;
let loginCheck: (home: string) => boolean = (home) => fs.existsSync(path.join(home, "pat.json"));

export function setMakerAccountsFileForTests(file: string | undefined): void {
  accountsFileOverride = file;
  appsCache.clear();
}

export function setMakerHomesRootForTests(dir: string | undefined): void {
  homesRootOverride = dir;
}

export function setAccountLoginCheckForTests(check: ((home: string) => boolean) | undefined): void {
  loginCheck = check ?? ((home) => fs.existsSync(path.join(home, "pat.json")));
}

export function defaultMakerHome(): string {
  return path.join(os.homedir(), ".taptap-maker");
}

export function accountsFilePath(): string {
  return accountsFileOverride ?? path.join(os.homedir(), ".tapmakerwork", "maker-accounts.json");
}

export function extraAccountHome(id: string): string {
  const root = homesRootOverride ?? path.join(os.homedir(), ".tapmakerwork", "maker-homes");
  return path.join(root, id);
}

export function accountSourceLabel(source: MakerAccountSource): string {
  if (source === "manual") return "手动指定";
  if (source === "auto") return "自动核对";
  return "全局账号";
}

function builtinAccount(): MakerAccountRecord {
  return { id: DEFAULT_MAKER_ACCOUNT_ID, label: "默认账号", home: defaultMakerHome(), builtin: true };
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
      next[key] = { mode: "manual", accountId: binding.accountId };
    } else if (binding.mode === "auto" || binding.mode === "manual") {
      next[key] = { mode: "auto" };
    }
  }
  return next;
}

export function loadMakerAccounts(): MakerAccountFile {
  const fallback: MakerAccountFile = {
    globalAccountId: DEFAULT_MAKER_ACCOUNT_ID,
    accounts: [builtinAccount()],
    projects: {}
  };
  try {
    const parsed = JSON.parse(fs.readFileSync(accountsFilePath(), "utf8")) as Partial<MakerAccountFile>;
    const accounts = Array.isArray(parsed.accounts) ? parsed.accounts.filter(validAccount) : [];
    const builtin = accounts.find((account) => account.id === DEFAULT_MAKER_ACCOUNT_ID);
    if (builtin) {
      builtin.home = defaultMakerHome();
      builtin.builtin = true;
      if (!builtin.label) builtin.label = "默认账号";
    } else {
      accounts.unshift(builtinAccount());
    }
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
  if (binding?.mode === "manual" || store.accounts.length <= 1 || identities.length === 0) {
    return chooseMakerAccount({ store, projectRoot: key, matches: [], ...(projectId ? { projectId } : {}) });
  }
  const matches: string[] = [];
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
    if (listed && identities.some((id) => listed.includes(id))) matches.push(account.id);
  }
  return chooseMakerAccount({ store, projectRoot: key, matches, ...(projectId ? { projectId } : {}) });
}

export function makerAccountSnapshot(projectRoot?: string, resolution?: AccountResolution): {
  globalAccountId: string;
  accounts: MakerAccountView[];
  project?: {
    mode: MakerAccountMode;
    accountId?: string;
    resolved?: { accountId: string; label: string; source: MakerAccountSource };
  };
} {
  const store = loadMakerAccounts();
  const accounts = store.accounts.map((account) => ({
    id: account.id,
    label: account.label,
    loggedIn: accountHasLogin(account.home),
    builtin: Boolean(account.builtin),
    global: account.id === store.globalAccountId
  }));
  if (!projectRoot) return { globalAccountId: store.globalAccountId, accounts };
  const binding = store.projects[projectAccountKey(projectRoot)];
  return {
    globalAccountId: store.globalAccountId,
    accounts,
    project: {
      mode: binding?.mode ?? "auto",
      ...(binding?.accountId ? { accountId: binding.accountId } : {}),
      ...(resolution ? { resolved: { accountId: resolution.accountId, label: resolution.label, source: resolution.source } } : {})
    }
  };
}

export function setGlobalMakerAccount(accountId: string): void {
  const store = loadMakerAccounts();
  if (!store.accounts.some((account) => account.id === accountId)) throw new Error("maker_account_not_found");
  store.globalAccountId = accountId;
  saveMakerAccounts(store);
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

export function removeMakerAccount(accountId: string): void {
  const store = loadMakerAccounts();
  const account = store.accounts.find((item) => item.id === accountId);
  if (!account) throw new Error("maker_account_not_found");
  if (account.builtin || account.id === DEFAULT_MAKER_ACCOUNT_ID) throw new Error("maker_account_builtin");
  store.accounts = store.accounts.filter((item) => item.id !== accountId);
  if (store.globalAccountId === accountId) store.globalAccountId = DEFAULT_MAKER_ACCOUNT_ID;
  for (const [key, binding] of Object.entries(store.projects)) {
    if (binding.accountId === accountId) store.projects[key] = { mode: "auto" };
  }
  saveMakerAccounts(store);
}

export function setProjectMakerAccount(projectRoot: string, mode: MakerAccountMode, accountId?: string): void {
  const store = loadMakerAccounts();
  const key = projectAccountKey(projectRoot);
  if (mode === "manual") {
    if (!accountId || !store.accounts.some((account) => account.id === accountId)) throw new Error("maker_account_not_found");
    store.projects[key] = { mode: "manual", accountId };
  } else {
    store.projects[key] = { mode: "auto" };
  }
  saveMakerAccounts(store);
}
