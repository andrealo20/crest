import { useEffect, useState } from "react";
import { createStore } from "../../lib/store";
import { Plus, X } from "../../ui/iconset";
import { Select } from "../../ui/controls";
import { locale, t } from "../../i18n";
import { requestExtra } from "../../notch/size";
import { fetchRates } from "../../platform/portfolio";
import { settings } from "../../settings/store";
import { effectiveBase } from "../trading/base";
import { BASES, type Rates } from "../trading/portfolio";
import { MAX_TARGETS, addTarget, convertMoney, currencies, pairOf, removeTarget, saved, targetsOf, toTop } from "./fx";
import { amountText, parseAmount } from "./parse";

/*
 * Currencies at the central banks' reference rates (Frankfurter, the portfolio's source; Rust caches them for a minute). They are
 * asked for in the portfolio's base currency, so both share one cache, and any two others cross through that base. One amount on
 * top, in as many currencies as are listed under it (#87); a row's currency goes to the top with its value.
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

/** The amount's currency and the first listed one: the panel opens on them again, and the bar's exchange rate shows them (pairOf). */
export const lastPair = createStore<[string, string] | null>(null, { persist: "convert-currency" });
/** The currencies listed after the first (fx.ts targetsOf). */
export const moreTargets = createStore<string[]>([], { persist: "convert-currency-more" });

/** A row, and the gap under it: the tool grows by these for each row past the first, up to EXTRA_ROWS, then the list scrolls. */
const ROW = 36, ROW_GAP = 4, EXTRA_ROWS = 4;

export function CurrencyPanel() {
  const base = effectiveBase(settings.use().trading.base);
  const [rates, setRates] = useState<Rates | null>(null);
  const [offline, setOffline] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pair = pairOf(lastPair.use(), base);
  const from = pair[0];
  const targets = targetsOf(pair, moreTargets.use());
  const save = (next: { from: string; targets: string[] }) => {
    const out = saved(next.from, next.targets);
    lastPair.set(out.pair);
    moreTargets.set(out.more);
  };
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

  // Room for the rows past the first, in the notch and in the bar's panel; given back when the panel goes (units, or the tool closes).
  const extra = Math.min(Math.max(0, targets.length - 1), EXTRA_ROWS) * (ROW + ROW_GAP);
  useEffect(() => requestExtra("convert", extra), [extra]);
  useEffect(() => () => requestExtra("convert", 0), []);

  const known = rates && Object.keys(rates.fx).length > 0 ? rates : null;
  const options = (known ? currencies(known) : [...BASES]).map((c) => ({ value: c, label: label(c) }));
  const value = parseAmount(input, locale());
  const convert = (to: string) => (!known || value === null ? null : convertMoney(value, from, to, known));
  // The oldest day among the shown currencies' rates (the base has none, it is 1); the newest of all with only the base shown.
  const shownDay = [from, ...targets].map((c) => known?.dates?.[c]).filter((d): d is string => !!d).sort()[0] ?? Object.values(known?.dates ?? {}).sort().at(-1);
  const day = shownDay ? new Date(`${shownDay}T12:00:00`).toLocaleDateString(locale(), { day: "numeric", month: "short" }) : null;
  const addable = options.filter((o) => o.value !== from && !targets.includes(o.value));

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2 rounded-[12px] bg-fill-1 py-1.5 ps-3 pe-1.5">
        <input
          value={input}
          inputMode="decimal"
          aria-label={t("Betrag")}
          onChange={(e) => setInput(e.target.value.replace(/[^\d.,]/g, ""))}
          className="tabular min-w-0 flex-1 bg-transparent text-[22px] leading-7 font-semibold tracking-[-0.02em] text-label outline-none"
        />
        {/* A listed currency picked here swaps places with the amount's, as a click on its row does, keeping the typed amount. */}
        <Select value={from} options={options} onChange={(c) => save(targets.includes(c) ? toTop(from, targets, c) : { from: c, targets })} width="w-44" />
      </div>
      <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-width:none]" style={{ gap: ROW_GAP }}>
        {targets.map((c) => {
          const result = convert(c);
          return (
            <li key={c} className="flex shrink-0 items-center rounded-[10px] bg-fill-1" style={{ height: ROW }}>
              <button
                aria-label={t("{name} nach oben", { name: c })}
                title={t("{name} nach oben", { name: c })}
                // The amount follows: the other rows keep their values.
                onClick={() => {
                  if (result !== null) setInput(amountText(result, locale()));
                  save(toTop(from, targets, c));
                }}
                className="pressable flex h-full min-w-0 flex-1 items-center justify-between gap-3 rounded-[10px] ps-3 pe-2 text-start"
              >
                <span className="tabular truncate text-[17px] leading-6 font-semibold text-label">
                  {result === null ? "–" : result.toLocaleString(locale(), { style: "currency", currency: c })}
                </span>
                <span className="truncate text-caption text-label-3">{label(c)}</span>
              </button>
              {targets.length > 1 && (
                <button
                  aria-label={t("{name} entfernen", { name: c })}
                  title={t("{name} entfernen", { name: c })}
                  onClick={() => save({ from, targets: removeTarget(targets, c) })}
                  className="pressable pressable-fill me-1 flex size-6 shrink-0 items-center justify-center rounded-full text-label-3 hover:text-label-2"
                >
                  <X size={11} weight="bold" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-caption text-label-3">
          {day ? t("Referenzkurse vom {date}", { date: day }) : offline ? t("Keine Verbindung") : t("Kurse werden geladen …")}
          {day && offline && ` · ${t("Keine Verbindung")}`}
        </div>
        {targets.length < MAX_TARGETS && addable.length > 0 && (
          <Select<string>
            width="shrink-0"
            value=""
            menuMax={320}
            options={addable}
            onChange={(c) => save({ from, targets: addTarget(from, targets, c) })}
            trigger={{
              label: t("Währung hinzufügen"),
              menuWidth: 220,
              className: "pressable pressable-fill flex h-7 items-center gap-1.5 rounded-full bg-fill-2 px-2.5 text-footnote font-medium text-label",
              content: (
                <>
                  <Plus size={13} weight="bold" />
                  <span>{t("Währung hinzufügen")}</span>
                </>
              ),
            }}
          />
        )}
      </div>
    </div>
  );
}
