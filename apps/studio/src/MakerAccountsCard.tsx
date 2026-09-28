import { useEffect, useState } from "react";

const API = "http://127.0.0.1:43121";

type AccountSource = "manual" | "auto" | "global";

interface AccountRow {
  id: string;
  label: string;
  loggedIn: boolean;
  builtin: boolean;
  global: boolean;
}

interface AccountsPayload {
  globalAccountId: string;
  accounts: AccountRow[];
  account?: { id: string; label: string };
  project?: {
    mode: "auto" | "manual";
    accountId?: string;
    resolved?: { accountId: string; label: string; source: AccountSource };
  };
  error?: string;
}

const sourceText: Record<AccountSource, string> = {
  manual: "手动指定",
  auto: "自动核对",
  global: "全局账号"
};

async function readAccounts(path: string, body?: unknown): Promise<AccountsPayload> {
  const response = await fetch(`${API}${path}`, body === undefined ? undefined : {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json() as AccountsPayload;
  if (!response.ok) throw new Error(payload.error || "账号操作失败");
  return payload;
}

export function MakerAccountsCard(props: {
  open: boolean;
  projectRoot?: string;
  notify: (message: string, kind?: "info" | "success" | "error") => void;
}) {
  const [data, setData] = useState<AccountsPayload>();
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (!props.open) return;
    let cancelled = false;
    void readAccounts("/api/maker/accounts")
      .then((payload) => { if (!cancelled) setData(payload); })
      .catch((error: unknown) => props.notify(error instanceof Error ? error.message : String(error), "error"));
    return () => { cancelled = true; };
  }, [props.open, props.projectRoot, props.notify]);

  async function run(path: string, body: unknown, pending: string, done?: string) {
    setBusy(pending);
    try {
      setData(await readAccounts(path, body));
      if (done) props.notify(done, "success");
    } catch (error) {
      props.notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy("");
    }
  }

  async function addAccount() {
    const suggested = `账号 ${(data?.accounts.length ?? 0) + 1}`;
    const label = window.prompt("新账号名称", suggested);
    if (label == null) return;
    setBusy("add");
    try {
      const created = await readAccounts("/api/maker/accounts", { label });
      setData(created);
      if (!created.account) throw new Error("maker_account_not_found");
      props.notify(`即将打开浏览器，请登录「${created.account.label}」`, "info");
      setData(await readAccounts("/api/maker/accounts/login", { accountId: created.account.id }));
      props.notify(`账号「${created.account.label}」已登录`, "success");
    } catch (error) {
      props.notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy("");
    }
  }

  function rename(account: AccountRow) {
    const label = window.prompt("账号名称", account.label);
    if (label == null || label.trim() === "" || label.trim() === account.label) return;
    void run("/api/maker/accounts/rename", { accountId: account.id, label }, account.id);
  }

  function remove(account: AccountRow) {
    if (!window.confirm(`删除账号「${account.label}」？已登录的凭证会留在本机目录里，但工作台不再使用它。`)) return;
    void run("/api/maker/accounts/remove", { accountId: account.id }, account.id, `已删除「${account.label}」`);
  }

  const project = data?.project;
  const manualAccount = project?.accountId || data?.globalAccountId || "";

  return (
    <section className="maker-accounts-card" aria-labelledby="maker-accounts-heading">
      <div className="maker-version-heading">
        <div>
          <h3 id="maker-accounts-heading">Maker 账号</h3>
          <p>每个项目默认用全局账号。有多个账号时，预览、测试码和提交会先自动核对；对不上就继续用全局账号。正在跑的预览保持开预览时的账号。</p>
        </div>
      </div>
      <label className="maker-account-row">
        <span>全局账号</span>
        <select
          value={data?.globalAccountId || ""}
          disabled={Boolean(busy) || !data}
          onChange={(event) => void run("/api/maker/accounts/global", { accountId: event.target.value }, "global", "已切换全局账号")}
        >
          {(data?.accounts ?? []).map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
        </select>
      </label>
      {props.projectRoot && (
        <>
          <label className="maker-account-row">
            <span>当前项目</span>
            <select
              value={project?.mode || "auto"}
              disabled={Boolean(busy) || !data}
              onChange={(event) => {
                const mode = event.target.value === "manual" ? "manual" : "auto";
                void run("/api/maker/accounts/project", {
                  mode,
                  ...(mode === "manual" ? { accountId: manualAccount } : {})
                }, "project");
              }}
            >
              <option value="auto">自动核对</option>
              <option value="manual">手动指定</option>
            </select>
          </label>
          {project?.mode === "manual" && (
            <label className="maker-account-row">
              <span>指定账号</span>
              <select
                value={project.accountId || ""}
                disabled={Boolean(busy)}
                onChange={(event) => void run("/api/maker/accounts/project", { mode: "manual", accountId: event.target.value }, "project")}
              >
                {(data?.accounts ?? []).map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
              </select>
            </label>
          )}
          {project?.resolved && <p className="maker-account-resolved">当前生效：{project.resolved.label}（{sourceText[project.resolved.source]}）</p>}
        </>
      )}
      <ul className="maker-account-list">
        {(data?.accounts ?? []).map((account) => (
          <li key={account.id}>
            <strong>{account.label}</strong>
            <small>{account.loggedIn ? "已登录" : "未登录"}{account.global ? " · 全局" : ""}</small>
            <span>
              <button type="button" disabled={Boolean(busy)} onClick={() => void run("/api/maker/accounts/login", { accountId: account.id }, account.id, `账号「${account.label}」已登录`)}>{account.loggedIn ? "重新登录" : "登录"}</button>
              <button type="button" disabled={Boolean(busy)} onClick={() => rename(account)}>改名</button>
              {!account.builtin && <button type="button" disabled={Boolean(busy)} onClick={() => remove(account)}>删除</button>}
            </span>
          </li>
        ))}
      </ul>
      <button type="button" className="primary" disabled={Boolean(busy)} onClick={() => void addAccount()}>{busy === "add" || busy === "login" ? "请在浏览器中登录…" : "添加账号"}</button>
    </section>
  );
}
