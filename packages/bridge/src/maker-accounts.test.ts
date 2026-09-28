import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addMakerAccount,
  chooseMakerAccount,
  clearMakerAppsCache,
  DEFAULT_MAKER_ACCOUNT_ID,
  loadMakerAccounts,
  projectIdsFromAppsPayload,
  removeMakerAccount,
  resolveProjectAccount,
  setAccountLoginCheckForTests,
  setGlobalMakerAccount,
  setMakerAccountsFileForTests,
  setMakerHomesRootForTests,
  setProjectMakerAccount,
  type MakerAccountFile
} from "./maker-accounts.js";

const temps: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maker-accounts-"));
  temps.push(dir);
  return dir;
}

function storeWith(extra: MakerAccountFile["accounts"][number], projectRoot: string, binding?: MakerAccountFile["projects"][string]): MakerAccountFile {
  return {
    globalAccountId: DEFAULT_MAKER_ACCOUNT_ID,
    accounts: [
      { id: DEFAULT_MAKER_ACCOUNT_ID, label: "默认账号", home: "/default-home", builtin: true },
      extra
    ],
    projects: binding ? { [projectRoot]: binding } : {}
  };
}

afterEach(() => {
  setMakerAccountsFileForTests(undefined);
  setMakerHomesRootForTests(undefined);
  setAccountLoginCheckForTests(undefined);
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function useTempStore(): string {
  const root = tempDir();
  setMakerAccountsFileForTests(path.join(root, "accounts.json"));
  setMakerHomesRootForTests(path.join(root, "homes"));
  setAccountLoginCheckForTests(() => true);
  return root;
}

describe("chooseMakerAccount", () => {
  const projectRoot = "/game";
  const other = { id: "acc_b", label: "账号 B", home: "/home-b" };

  it("手动指定优先于自动核对", () => {
    const chosen = chooseMakerAccount({
      store: storeWith(other, projectRoot, { mode: "manual", accountId: "acc_b" }),
      projectRoot,
      projectId: "p1",
      matches: [DEFAULT_MAKER_ACCOUNT_ID]
    });
    expect(chosen).toMatchObject({ accountId: "acc_b", source: "manual" });
  });

  it("多个账号且只有一个对得上时用自动核对", () => {
    const chosen = chooseMakerAccount({
      store: storeWith(other, projectRoot),
      projectRoot,
      projectId: "p1",
      matches: ["acc_b"]
    });
    expect(chosen).toMatchObject({ accountId: "acc_b", source: "auto" });
  });

  it("对不上或对上多个时回到全局账号", () => {
    const store = storeWith(other, projectRoot);
    expect(chooseMakerAccount({ store, projectRoot, matches: [] }).source).toBe("global");
    expect(chooseMakerAccount({ store, projectRoot, matches: [DEFAULT_MAKER_ACCOUNT_ID, "acc_b"] }).accountId).toBe(DEFAULT_MAKER_ACCOUNT_ID);
  });

  it("只有一个账号时不做自动核对", () => {
    const store: MakerAccountFile = {
      globalAccountId: DEFAULT_MAKER_ACCOUNT_ID,
      accounts: [{ id: DEFAULT_MAKER_ACCOUNT_ID, label: "默认账号", home: "/default-home", builtin: true }],
      projects: {}
    };
    expect(chooseMakerAccount({ store, projectRoot, matches: [DEFAULT_MAKER_ACCOUNT_ID] }).source).toBe("global");
  });
});

describe("projectIdsFromAppsPayload", () => {
  it("读取项目 id 和应用 id", () => {
    expect(projectIdsFromAppsPayload({ projects: [{ id: "p1", app_id: 42 }] })).toEqual(["p1", "42"]);
  });
});

describe("resolveProjectAccount", () => {
  it("手动指定时不再查询账号下的项目", async () => {
    const root = useTempStore();
    const added = addMakerAccount("账号 B");
    fs.writeFileSync(path.join(added.home, "pat.json"), "{}\n");
    fs.mkdirSync(path.join(root, ".maker-mcp"), { recursive: true });
    fs.writeFileSync(path.join(root, ".maker-mcp", "config.json"), JSON.stringify({ project_id: "p1" }));
    setProjectMakerAccount(root, "manual", added.id);
    const chosen = await resolveProjectAccount(root, async () => {
      throw new Error("should_not_lookup");
    });
    expect(chosen).toMatchObject({ accountId: added.id, source: "manual" });
  });

  it("恰好一个账号拥有该项目时自动选中，否则用全局账号", async () => {
    const root = useTempStore();
    const added = addMakerAccount("账号 B");
    fs.writeFileSync(path.join(added.home, "pat.json"), "{}\n");
    fs.mkdirSync(path.join(root, ".maker-mcp"), { recursive: true });
    fs.writeFileSync(path.join(root, ".maker-mcp", "config.json"), JSON.stringify({ project_id: "p9" }));
    const lists = new Map<string, string[]>([[DEFAULT_MAKER_ACCOUNT_ID, ["other"]], [added.id, ["p9"]]]);
    const matched = await resolveProjectAccount(root, async (account) => lists.get(account.id) ?? []);
    expect(matched.source).toBe("auto");
    expect(matched.accountId).toBe(added.id);

    clearMakerAppsCache();
    lists.set(DEFAULT_MAKER_ACCOUNT_ID, ["p9"]);
    const both = await resolveProjectAccount(root, async (account) => lists.get(account.id) ?? []);
    expect(both.source).toBe("global");
  });

  it("可以切换全局账号，删除后回到默认账号", () => {
    useTempStore();
    const added = addMakerAccount("账号 B");
    setGlobalMakerAccount(added.id);
    expect(loadMakerAccounts().globalAccountId).toBe(added.id);
    removeMakerAccount(added.id);
    expect(loadMakerAccounts().globalAccountId).toBe(DEFAULT_MAKER_ACCOUNT_ID);
    expect(loadMakerAccounts().accounts.map((account) => account.id)).toEqual([DEFAULT_MAKER_ACCOUNT_ID]);
  });
});
