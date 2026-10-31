import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAccount, fetchRates, recordHistory, type RecordEntry } from "../../platform/portfolio";
import { secrets } from "../../platform/services";
import { settings } from "../../settings/store";
import { manualHoldings } from "./manual";
import { addTotals, manualAccount, priceNeeds, summarize, type Account, type History, type Rates, type Summary, type Totals } from "./portfolio";
import { providers } from "./providers";

/** Polls while the tool is open; each provider's cache in Rust keeps within its rate limit. */
const POLL_MS = 30_000;

export interface AccountState {
  /** Provider id or "manual". */
  id: string;
  /** History scope ("t212-live", "kraken", …). */
  scope: string;
  account: Account | null;
  summary: Summary | null;
  error: string | null;
  history: History | null;
}

export interface PortfolioState {
  base: string;
  /** Set-up accounts in provider order, manual last. */
  accounts: AccountState[];
  total: Totals | null;
  history: History | null;
  /** Price sources that failed on the last refresh. */
  failed: string[];
  /** Nothing is set up. */
  empty: boolean;
}

export function usePortfolio() {
  const { env, base } = settings.use().trading;
  const manual = manualHoldings.use();
  const [state, setState] = useState<PortfolioState | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const alive = useRef(true);
  const last = useRef<{ base: string; accounts: Record<string, Account>; rates: Rates | null; histories: Record<string, History> }>({ base, accounts: {}, rates: null, histories: {} });

  const refresh = useCallback(async () => {
    setLoading(true);
    // Histories are per base currency.
    if (last.current.base !== base) last.current = { base, accounts: last.current.accounts, rates: null, histories: {} };
    try {
      const configured = (await Promise.all(providers.map(async (p) => ((await secrets.has(p.fields[0].secret)) ? p.id : null)))).filter((id) => id !== null);
      const results = await Promise.allSettled(configured.map((id) => fetchAccount(id, env)));
      const list: { id: string; scope: string; account: Account | null; error: string | null }[] = configured.map((id, i) => {
        const r = results[i];
        const scope = id === "t212" ? `t212-${env}` : id;
        if (r.status === "fulfilled") {
          last.current.accounts[scope] = r.value;
          return { id, scope, account: r.value, error: null };
        }
        const error = String(r.reason);
        // A rate limit while data is on screen keeps the last data.
        return { id, scope, account: error === "rate" ? (last.current.accounts[scope] ?? null) : null, error: error === "rate" && last.current.accounts[scope] ? null : error };
      });
      if (manual.length) list.push({ id: "manual", scope: "manual", account: manualAccount(manual), error: null });

      const loaded = list.flatMap((a) => (a.account ? [a.account] : []));
      const needs = priceNeeds(loaded, base);
      let rates = last.current.rates;
      try {
        rates = await fetchRates(base, needs.crypto, needs.fiats);
        last.current.rates = rates;
      } catch {
        // Offline: older prices beat none.
      }
      if (rates && rates.base !== base) rates = null;
      const usable: Rates = rates ?? { base, crypto: {}, fx: {}, failed: ["coingecko", "frankfurter"] };

      const summaries = list.map((a) => ({ ...a, summary: a.account ? summarize(a.account, usable) : null }));
      const ok = summaries.flatMap((a) => (a.summary ? [a.summary] : []));
      const total = ok.length ? addTotals(ok) : null;

      // History only from complete data, so a failed account or a missing price makes no dip.
      const entries: RecordEntry[] = [];
      const t212 = summaries.find((a) => a.id === "t212")?.account;
      const t212Currency = t212?.holdings.find((h) => h.currency)?.currency;
      const seed = t212Currency === base ? env : undefined;
      for (const a of summaries) {
        if (a.summary && !a.summary.partial && !a.summary.missing.length) {
          entries.push({ scope: a.scope, ...point(a.summary), seed: a.id === "t212" ? seed : undefined });
        }
      }
      if (total && entries.length === summaries.length) entries.push({ scope: "all", ...point(total), seed: summaries.length === 1 && summaries[0].id === "t212" ? seed : undefined });
      // Scopes not recorded this time keep the history from before.
      const histories = Object.assign(last.current.histories, entries.length ? await recordHistory(base, entries) : {});

      if (!alive.current) return;
      setState({
        base,
        accounts: summaries.map((a) => ({ id: a.id, scope: a.scope, account: a.account, summary: a.summary, error: a.error, history: histories[a.scope] ?? null })),
        total,
        history: histories.all ?? null,
        failed: usable.failed,
        empty: list.length === 0,
      });
      setUpdatedAt(Date.now());
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [env, base, manual]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [refresh]);

  return { state, loading, updatedAt, refresh };
}

function point(t: Totals) {
  return { value: t.value, pnl: t.unrealized + t.realized, invested: t.invested };
}
