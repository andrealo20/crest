import { useEffect, useState } from "react";
import { createStore } from "../../lib/store";
import { ArrowsLeftRight } from "@phosphor-icons/react";
import { Select } from "../../ui/controls";
import { locale, t } from "../../i18n";
import { fetchRates } from "../../platform/portfolio";
import { settings } from "../../settings/store";
import { effectiveBase } from "../trading/base";
import { BASES, type Rates } from "../trading/portfolio";
import { convertMoney, currencies } from "./fx";
import { parseAmount } from "./parse";

/*
 * Currencies at the ECB reference rates (Frankfurter, the portfolio's source; Rust caches them for a minute). They are
 * asked for in the portfolio's base currency, so both share one cache, and any two others cross through that base.
 */

// Per language, so a language change shows the new names.
const names = new Map<string, Intl.DisplayNames>();
function label(code: string): string {
  try {
    const lang = locale();
    if (!names.has(lang)) names.set(lang, new Intl.DisplayNames(lang, { type: "currency" }));
    return `${code} · ${names.get(lang)!.of(code)}`;
  } catch {
    return code;
  }
}

/** The last pair of currencies: the panel opens on it again. */
const lastPair = createStore<[string, string] | null>(null, { persist: "convert-currency" });

export function CurrencyPanel() {
  const base = effectiveBase(settings.use().trading.base);
  const [rates, setRates] = useState<Rates | null>(null);
  const [offline, setOffline] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const saved = lastPair.use();
  const [from, to] = Array.isArray(saved) && saved.length === 2 && saved.every((c) => /^[A-Z]{3}$/.test(c)) ? saved : [base, base === "EUR" ? "USD" : "EUR"];
  const setPair = (p: [string, string]) => lastPair.set(p);
  const [input, setInput] = useState("100");

  useEffect(() => {
    let live = true;
    let retry = 0;
    // Offline: ask again after a while, so a start without network does not need the tool reopened.
    const failed = () => {
      setOffline(true);
      retry = window.setTimeout(() => setAttempt((a) => a + 1), 20_000);
    };
    // Any currency other than the base makes Rust fetch the rates, and the answer holds all of them.
    fetchRates(base, [], ["EUR", "USD"]).then(
      (r) => {
        if (!live) return;
        setRates(r);
        if (r.failed.includes("frankfurter")) failed();
        else setOffline(false);
      },
      () => live && failed(),
    );
    return () => {
      live = false;
      window.clearTimeout(retry);
    };
  }, [base, attempt]);

  const known = rates && Object.keys(rates.fx).length > 0 ? rates : null;
  const options = (known ? currencies(known) : [...BASES]).map((c) => ({ value: c, label: label(c) }));
  const value = parseAmount(input, locale());
  const result = !known || value === null ? null : convertMoney(value, from, to, known);
  const day = known?.date ? new Date(`${known.date}T12:00:00`).toLocaleDateString(locale(), { day: "numeric", month: "short" }) : null;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 flex-col gap-1.5 rounded-[12px] bg-fill-1 p-2.5">
          <input
            value={input}
            inputMode="decimal"
            aria-label={t("Betrag")}
            onChange={(e) => setInput(e.target.value.replace(/[^\d.,]/g, ""))}
            className="tabular w-full bg-transparent text-[22px] leading-7 font-semibold tracking-[-0.02em] text-label outline-none"
          />
          <Select value={from} options={options} onChange={(v) => setPair([v, to])} width="w-full" />
        </div>
        <button
          aria-label={t("Tauschen")}
          onClick={() => setPair([to, from])}
          className="pressable pressable-fill flex size-8 shrink-0 items-center justify-center rounded-full bg-fill-2 text-label-2"
        >
          <ArrowsLeftRight size={14} weight="bold" />
        </button>
        <div className="flex flex-1 flex-col gap-1.5 rounded-[12px] bg-fill-1 p-2.5">
          <div className="tabular truncate text-[22px] leading-7 font-semibold tracking-[-0.02em] text-label">
            {result === null ? "–" : result.toLocaleString(locale(), { style: "currency", currency: to })}
          </div>
          <Select value={to} options={options} onChange={(v) => setPair([from, v])} width="w-full" />
        </div>
      </div>
      <div className="text-caption text-label-3">
        {day ? t("EZB-Referenzkurse vom {date}", { date: day }) : offline ? t("Keine Verbindung") : t("Kurse werden geladen …")}
        {day && offline && ` · ${t("Keine Verbindung")}`}
      </div>
    </div>
  );
}
