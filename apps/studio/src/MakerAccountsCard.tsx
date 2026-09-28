import { useEffect, useRef, useState } from "react";

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

type AccountListener = (payload: AccountsPayload) => void;

const accountListeners = new Set<AccountListener>();
let accountSnapshot: AccountsPayload | undefined;

function publishAccounts(payload: AccountsPayload): void {
  accountSnapshot = payload;
  for (const listener of accountListeners) listener(payload);
  window.tapMakerWork?.accounts?.report(payload.accounts.map((account) => ({
    id: account.id,
    label: account.label,
    global: account.global
  })));
}

function subscribeAccounts(listener: AccountListener): () => void {
  accountListeners.add(listener);
  if (accountSnapshot) listener(accountSnapshot);
  return () => { accountListeners.delete(listener); };
}

async function readAccounts(path: string, body?: unknown): Promise<AccountsPayload> {
  const response = await fetch(`${API}${path}`, body === undefined ? undefined : {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json() as AccountsPayload;
  if (!response.ok) throw new Error(payload.error || "账号操作失败");
  publishAccounts(payload);
  return payload;
}

export function refreshMakerAccounts(): Promise<AccountsPayload> {
  return readAccounts("/api/maker/accounts");
}

export function mutateMakerAccounts(path: string, body: unknown): Promise<AccountsPayload> {
  return readAccounts(path, body);
}

export function MakerAccountsCard(props: {
  open: boolean;
  projectRoot?: string;
  notify: (message: string, kind?: "info" | "success" | "error") => void;
}) {
  const [data, setData] = useState<AccountsPayload | undefined>(accountSnapshot);
  const [busy, setBusy] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => subscribeAccounts(setData), []);

  useEffect(() => {
    if (!props.open) return;
    void refreshMakerAccounts().catch((error: unknown) => props.notify(error instanceof Error ? error.message : String(error), "error"));
  }, [props.open, props.projectRoot, props.notify]);

  async function run(path: string, body: unknown, pending: string, done?: string): Promise<boolean> {
    setBusy(pending);
    try {
      await mutateMakerAccounts(path, body);
      if (done) props.notify(done, "success");
      return true;
    } catch (error) {
      props.notify(error instanceof Error ? error.message : String(error), "error");
      return false;
    } finally {
      setBusy("");
    }
  }

  function beginRename(account: AccountRow) {
    setAdding(false);
    setRenamingId(account.id);
    setDraft(account.label);
  }

  async function submitRename(account: AccountRow) {
    const label = draft.trim();
    if (!label || label === account.label) {
      setRenamingId(null);
      return;
    }
    const renamed = await run("/api/maker/accounts/rename", { accountId: account.id, label }, account.id, `已改名为「${label}」`);
    if (renamed) setRenamingId(null);
  }

  function beginAdd() {
    setRenamingId(null);
    setAdding(true);
    setDraft(`账号 ${(data?.accounts.length ?? 0) + 1}`);
  }

  async function submitAdd() {
    const label = draft.trim();
    if (!label) return;
    setBusy("add");
    try {
      const created = await mutateMakerAccounts("/api/maker/accounts", { label });
      if (!created.account) throw new Error("maker_account_not_found");
      props.notify(`正在用无痕窗口打开登录页，请登录「${created.account.label}」并创建 token`, "info");
      await mutateMakerAccounts("/api/maker/accounts/login", { accountId: created.account.id });
      props.notify(`账号「${created.account.label}」已登录`, "success");
      setAdding(false);
    } catch (error) {
      props.notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy("");
    }
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
          <li key={account.id} className={renamingId === account.id ? "editing" : ""}>
            {renamingId === account.id ? (
              <form className="maker-account-editor" onSubmit={(event) => { event.preventDefault(); void submitRename(account); }}>
                <input value={draft} autoFocus disabled={Boolean(busy)} aria-label={`账号 ${account.label} 的新名称`} onChange={(event) => setDraft(event.target.value)} />
                <button type="submit" disabled={Boolean(busy) || draft.trim() === ""}>保存</button>
                <button type="button" disabled={Boolean(busy)} onClick={() => setRenamingId(null)}>取消</button>
              </form>
            ) : (
              <>
                <strong>{account.label}</strong>
                <small>{account.loggedIn ? "已登录" : "未登录"}{account.global ? " · 全局" : ""}</small>
                <span>
                  <button type="button" disabled={Boolean(busy)} onClick={() => {
                    props.notify(`正在用无痕窗口打开登录页，请登录「${account.label}」并创建 token`, "info");
                    void run("/api/maker/accounts/login", { accountId: account.id }, account.id, `账号「${account.label}」已登录`);
                  }}>{busy === account.id ? "正在打开无痕窗口…" : account.loggedIn ? "重新登录" : "登录"}</button>
                  <button type="button" disabled={Boolean(busy)} onClick={() => beginRename(account)}>改名</button>
                  {!account.builtin && <button type="button" disabled={Boolean(busy)} onClick={() => remove(account)}>删除</button>}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      {adding ? (
        <form className="maker-account-editor" onSubmit={(event) => { event.preventDefault(); void submitAdd(); }}>
          <input value={draft} autoFocus disabled={Boolean(busy)} aria-label="新账号名称" onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" className="primary" disabled={Boolean(busy) || draft.trim() === ""}>{busy === "add" ? "正在打开无痕窗口…" : "用无痕窗口登录"}</button>
          <button type="button" disabled={Boolean(busy)} onClick={() => setAdding(false)}>取消</button>
        </form>
      ) : (
        <button type="button" className="primary" disabled={Boolean(busy)} onClick={beginAdd}>添加账号</button>
      )}
    </section>
  );
}

export function MakerAccountSwitcher(props: {
  projectRoot?: string;
  notify: (message: string, kind?: "info" | "success" | "error") => void;
  onManage: () => void;
}) {
  const [data, setData] = useState<AccountsPayload | undefined>(accountSnapshot);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeAccounts(setData), []);
  useEffect(() => {
    void refreshMakerAccounts().catch((error: unknown) => props.notify(error instanceof Error ? error.message : String(error), "error"));
  }, [props.projectRoot, props.notify]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  async function run(path: string, body: unknown, done: string) {
    setBusy(true);
    try {
      await mutateMakerAccounts(path, body);
      props.notify(done, "success");
    } catch (error) {
      props.notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  }

  const globalAccount = data?.accounts.find((account) => account.global);
  const resolved = data?.project?.resolved;
  const caption = resolved?.label || globalAccount?.label || "未登录";

  return (
    <div className="account-switcher" ref={rootRef}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`切换账号，当前 ${caption}`} onClick={() => setOpen((value) => !value)}>
        <span>账号</span>
        <strong>{caption}</strong>
      </button>
      {open && (
        <div className="account-switcher-menu" role="menu" aria-label="切换 Maker 账号">
          <h3>全局账号</h3>
          {(data?.accounts ?? []).map((account) => (
            <button
              key={account.id}
              type="button"
              role="menuitemradio"
              aria-checked={account.global}
              disabled={busy || account.global}
              onClick={() => void run("/api/maker/accounts/global", { accountId: account.id }, `全局账号已切换为「${account.label}」`)}
            >
              <strong>{account.label}</strong>
              <small>{account.loggedIn ? "已登录" : "未登录"}{account.global ? " · 当前" : ""}</small>
            </button>
          ))}
          {props.projectRoot && (
            <>
              <h3>当前项目</h3>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={data?.project?.mode !== "manual"}
                disabled={busy || data?.project?.mode !== "manual"}
                onClick={() => void run("/api/maker/accounts/project", { mode: "auto" }, "当前项目改为自动核对")}
              >
                <strong>自动核对</strong>
                <small>对不上时用全局账号</small>
              </button>
              {(data?.accounts ?? []).map((account) => {
                const pinned = data?.project?.mode === "manual" && data.project.accountId === account.id;
                return (
                  <button
                    key={`project-${account.id}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={pinned}
                    disabled={busy || pinned}
                    onClick={() => void run("/api/maker/accounts/project", { mode: "manual", accountId: account.id }, `当前项目已指定「${account.label}」`)}
                  >
                    <strong>指定 {account.label}</strong>
                    <small>{pinned ? "当前" : "手动指定"}</small>
                  </button>
                );
              })}
              {resolved && <p>生效：{resolved.label}（{sourceText[resolved.source]}）</p>}
            </>
          )}
          <button type="button" onClick={() => { setOpen(false); props.onManage(); }}>管理账号…</button>
        </div>
      )}
    </div>
  );
}
