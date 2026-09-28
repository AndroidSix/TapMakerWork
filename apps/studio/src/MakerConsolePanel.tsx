import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, PanelTop, RefreshCw, SquareArrowOutUpRight, X } from "lucide-react";
import { refreshMakerAccounts, subscribeMakerAccounts, type AccountsPayload } from "./MakerAccountsCard";

export type TapConsoleSite = "maker" | "developer";

const SITE_URL: Record<TapConsoleSite, string> = {
  maker: "https://maker.taptap.cn/",
  developer: "https://developer.taptap.cn/"
};

const SITE_LABEL: Record<TapConsoleSite, string> = {
  maker: "制造后台",
  developer: "开发者后台"
};

export interface MakerConsolePanelProps {
  open: boolean;
  accountId: string;
  accountLabel: string;
  accountSource?: "manual" | "auto" | "global" | "none";
  site: TapConsoleSite;
  projectRoot?: string;
  onSiteChange: (site: TapConsoleSite) => void;
  onAccountChange: (accountId: string, label: string) => void;
  onClose: () => void;
  onOpenExternal: (url: string) => void;
  notify: (message: string, kind?: "info" | "success" | "error" | "warn") => void;
}

function accountSourceText(source?: "manual" | "auto" | "global" | "none"): string {
  if (source === "manual") return "本项目指定";
  if (source === "auto") return "本项目核对";
  if (source === "global") return "全局账号";
  return "手动选择";
}

export function MakerConsolePanel({
  open,
  accountId,
  accountLabel,
  accountSource = "none",
  site,
  projectRoot,
  onSiteChange,
  onAccountChange,
  onClose,
  onOpenExternal,
  notify
}: MakerConsolePanelProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<"embedded" | "popout" | "hidden">("hidden");
  const [accounts, setAccounts] = useState<AccountsPayload["accounts"]>([]);
  const [projectResolvedId, setProjectResolvedId] = useState<string | undefined>();
  const [webLogin, setWebLogin] = useState<Record<string, boolean>>({});
  const [switching, setSwitching] = useState(false);
  const [activePartition, setActivePartition] = useState("");
  const desktop = Boolean(window.tapMakerWork?.makerConsole);
  const busyRef = useRef(false);
  const accountIdRef = useRef(accountId);
  const siteRef = useRef(site);
  accountIdRef.current = accountId;
  siteRef.current = site;
  const currentUrl = SITE_URL[site];

  useEffect(() => subscribeMakerAccounts((payload) => {
    setAccounts(payload.accounts);
    setProjectResolvedId(payload.project?.resolved?.accountId);
  }), []);

  useEffect(() => {
    if (!open) return;
    void refreshMakerAccounts(projectRoot).catch(() => undefined);
  }, [open, projectRoot]);

  useEffect(() => {
    if (!open || !accounts.length || !window.tapMakerWork?.makerConsole?.webLogin) return;
    let cancelled = false;
    void (async () => {
      const next: Record<string, boolean> = {};
      for (const account of accounts) {
        try {
          const result = await window.tapMakerWork!.makerConsole!.webLogin!(account.id);
          next[account.id] = result.loggedIn;
        } catch {
          next[account.id] = false;
        }
      }
      if (!cancelled) setWebLogin(next);
    })();
    return () => { cancelled = true; };
  }, [open, accounts, accountId]);

  const layoutEmbedded = useCallback(async () => {
    if (!desktop || !frameRef.current || !window.tapMakerWork?.makerConsole) return;
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const rect = frameRef.current.getBoundingClientRect();
      const result = await window.tapMakerWork.makerConsole.mount({
        accountId: accountIdRef.current,
        site: siteRef.current,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      });
      if (!result.ok) {
        notify(`${SITE_LABEL[siteRef.current]}打开失败：${result.error || "unknown"}`, "error");
        return;
      }
      if (typeof result.partition === "string") setActivePartition(result.partition);
      if (result.mode === "popout") setMode("popout");
      else setMode("embedded");
    } finally {
      busyRef.current = false;
    }
  }, [desktop, notify]);

  // 仅在打开/关闭时挂载；切账号绝不走 unmount，否则会误复用旧 partition
  useEffect(() => {
    if (!open) {
      void window.tapMakerWork?.makerConsole?.unmount();
      setMode("hidden");
      setActivePartition("");
      return;
    }
    if (!desktop) return;
    void layoutEmbedded();
    return () => {
      void window.tapMakerWork?.makerConsole?.unmount();
    };
  }, [open, desktop, layoutEmbedded]);

  // 账号或站点变化：只 setAccount / setSite，不 unmount
  useEffect(() => {
    if (!open || !desktop || !window.tapMakerWork?.makerConsole) return;
    let cancelled = false;
    void (async () => {
      setSwitching(true);
      try {
        const result = await window.tapMakerWork!.makerConsole!.setAccount(accountId, site);
        if (cancelled) return;
        if (!result.ok) {
          notify(`切换账号失败：${result.error || "unknown"}`, "error");
          return;
        }
        if (typeof result.partition === "string") setActivePartition(result.partition);
        if (result.mode === "embedded") await layoutEmbedded();
        else if (result.mode === "popout") setMode("popout");
        else if (result.mode === "hidden") await layoutEmbedded();
      } finally {
        if (!cancelled) setSwitching(false);
      }
    })();
    return () => { cancelled = true; };
  }, [accountId, site, open, desktop, layoutEmbedded, notify]);

  useEffect(() => {
    if (!open || !desktop || !frameRef.current || mode !== "embedded") return;
    const observer = new ResizeObserver(() => { void layoutEmbedded(); });
    observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, [open, desktop, mode, layoutEmbedded]);

  useEffect(() => {
    if (!window.tapMakerWork?.makerConsole) return;
    const offMode = window.tapMakerWork.makerConsole.onMode?.((state) => {
      if (state.mode === "embedded" || state.mode === "popout" || state.mode === "hidden") setMode(state.mode);
      if (state.site === "maker" || state.site === "developer") onSiteChange(state.site);
      if (typeof state.partition === "string") setActivePartition(state.partition);
    });
    const offClosed = window.tapMakerWork.makerConsole.onPopoutClosed?.(() => {
      setMode("hidden");
    });
    return () => {
      offMode?.();
      offClosed?.();
    };
  }, [onSiteChange]);

  if (!open) return null;

  async function switchSite(next: TapConsoleSite) {
    if (next === site) return;
    onSiteChange(next);
  }

  function switchAccount(nextId: string) {
    if (!nextId || nextId === accountId || switching) return;
    const row = accounts.find((account) => account.id === nextId);
    onAccountChange(nextId, row?.label || nextId);
  }

  async function popOut() {
    if (!window.tapMakerWork?.makerConsole) {
      onOpenExternal(currentUrl);
      return;
    }
    const result = await window.tapMakerWork.makerConsole.popOut({ accountId, site });
    if (!result.ok) notify(`弹出失败：${result.error || "unknown"}`, "error");
    else {
      setMode("popout");
      notify(`${SITE_LABEL[site]}已弹出为独立窗口（与同账号另一后台共享登录）`, "success");
    }
  }

  async function popIn() {
    if (!window.tapMakerWork?.makerConsole || !frameRef.current) return;
    const rect = frameRef.current.getBoundingClientRect();
    const result = await window.tapMakerWork.makerConsole.popIn({
      accountId,
      site,
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    });
    if (!result.ok) notify(`嵌回失败：${result.error || "unknown"}`, "error");
    else setMode("embedded");
  }

  async function reload() {
    if (!window.tapMakerWork?.makerConsole) return;
    await window.tapMakerWork.makerConsole.reload();
  }

  const selectAccounts = accounts.length
    ? accounts
    : [{ id: accountId, label: accountLabel, loggedIn: false, builtin: false, global: false }];

  return (
    <section className="overlay-panel panel tools-panel maker-console-panel" aria-label="TapTap 后台">
      <header className="maker-console-toolbar">
        <div className="maker-console-heading">
          <strong>TapTap 后台</strong>
          <small>{accountSourceText(accountSource)} · 每个账号独立 Cookie，制造/开发者同账号互通</small>
          <label className="maker-console-account">
            <span>网页账号</span>
            <select
              value={accountId}
              disabled={switching || selectAccounts.length === 0}
              aria-label="选择后台网页账号"
              onChange={(event) => switchAccount(event.target.value)}
            >
              {selectAccounts.map((account) => {
                const marks: string[] = [];
                if (account.id === projectResolvedId) marks.push("本项目");
                if (account.global) marks.push("全局");
                if (webLogin[account.id]) marks.push("已登录");
                const suffix = marks.length ? `（${marks.join(" · ")}）` : "";
                return (
                  <option key={account.id} value={account.id}>
                    {account.label}{suffix}
                  </option>
                );
              })}
            </select>
          </label>
          <nav className="maker-console-sites" aria-label="后台站点">
            <button type="button" className={site === "maker" ? "active" : ""} aria-pressed={site === "maker"} onClick={() => void switchSite("maker")}>制造后台</button>
            <button type="button" className={site === "developer" ? "active" : ""} aria-pressed={site === "developer"} onClick={() => void switchSite("developer")}>开发者后台</button>
          </nav>
        </div>
        <div className="maker-console-actions">
          {desktop && mode === "popout" ? (
            <button type="button" onClick={() => void popIn()} title="嵌回面板"><PanelTop size={14} />嵌回</button>
          ) : (
            <button type="button" onClick={() => void popOut()} title="弹出独立窗口"><SquareArrowOutUpRight size={14} />弹出</button>
          )}
          {desktop && <button type="button" onClick={() => void reload()} title="刷新"><RefreshCw size={14} /></button>}
          <button type="button" onClick={() => onOpenExternal(currentUrl)} title="系统浏览器打开"><ExternalLink size={14} /></button>
          <button type="button" onClick={onClose} aria-label="关闭"><X size={14} /></button>
        </div>
      </header>
      <p className="maker-console-hint">
        当前网页分区：<strong>{accountLabel}</strong>
        {switching ? " · 正在切换…" : activePartition ? ` · ${activePartition.replace(/^persist:/, "")}` : ""}
        {" · 换账号后需各自登录一次"}
      </p>
      {!desktop && (
        <p className="maker-console-fallback">
          当前不是桌面壳，无法内嵌。请用系统浏览器打开。
          <button type="button" className="primary" onClick={() => onOpenExternal(currentUrl)}>打开 {SITE_LABEL[site]}</button>
        </p>
      )}
      {desktop && mode === "popout" && (
        <p className="maker-console-fallback">已在独立窗口中打开。关闭小窗或点「嵌回」可回到面板。</p>
      )}
      <div
        className="maker-console-frame"
        ref={frameRef}
        data-mode={mode}
        aria-hidden={mode !== "embedded"}
      />
    </section>
  );
}
