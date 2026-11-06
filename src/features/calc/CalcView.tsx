import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, Trash } from "@phosphor-icons/react";
import { HeaderActions, HeaderButton } from "../../notch/header";
import { createStore } from "../../lib/store";
import { locale, t } from "../../i18n";
import { fetchRates } from "../../platform/portfolio";
import { settings } from "../../settings/store";
import { effectiveBase } from "../trading/base";
import type { Rates } from "../trading/portfolio";
import { convertMoney } from "../convert/fx";
import { evaluate } from "./engine";
import { formatValue } from "./format";
import { describe } from "./messages";

/** The sheet, saved on every keystroke (localStorage, nothing leaves the PC). */
const sheet = createStore<{ text: string }>({ text: "" }, { persist: "calc" });
sheet.set((s) => ({ text: typeof s?.text === "string" ? s.text : "" }));

/** The sheet taken by the last Clear, for one undo; kept while the notch closes, dropped on the next edit. */
let cleared: string | null = null;

const MAX_CHARS = 20_000;
/** Same metrics on the textarea and the result rows, or the two columns drift apart. */
const TEXT = "font-mono text-[12px] leading-[18px]";
const ROW = 18;
/** The sheet's own top and bottom padding (py-2). */
const PAD = 8;

/** Exchange rates are asked for only once a line names a currency, from the ECB source the Converter uses, and reused for half an hour. */
const rateCache: { rates: Rates | null; at: number } = { rates: null, at: 0 };

function useRates(wanted: boolean) {
  const base = effectiveBase(settings.use().trading.base);
  const [rates, setRates] = useState(rateCache.rates);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!wanted || (rateCache.rates && Date.now() - rateCache.at < 30 * 60_000)) return;
    let live = true;
    setLoading(true);
    fetchRates(base, [], ["EUR", "USD"]).then(
      (r) => {
        if (Object.keys(r.fx).length > 0) Object.assign(rateCache, { rates: r, at: Date.now() });
        if (!live) return;
        setRates(rateCache.rates);
        setLoading(false);
      },
      () => live && setLoading(false),
    );
    return () => {
      live = false;
    };
  }, [wanted, base]);
  return { rates, loading };
}

export function CalcView() {
  const { text } = sheet.use();
  const area = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [, redraw] = useState(0);
  const [caret, setCaret] = useState<number | null>(null);
  const [flash, setFlash] = useState<{ row: number; ok: boolean } | null>(null);
  const flashTimer = useRef(0);
  const canUndo = !text && cleared !== null;
  const lang = locale();

  // Whether a line names a currency does not depend on the rates, so the answer from the first pass can ask for them.
  const [wantRates, setWantRates] = useState(false);
  const { rates, loading } = useRates(wantRates);
  const money = useMemo(() => (rates ? (amount: number, from: string, to: string) => convertMoney(amount, from, to, rates) : undefined), [rates]);
  const result = useMemo(() => evaluate(text, { money }), [text, money]);
  if (result.usesMoney !== wantRates) setWantRates(result.usesMoney);

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  // The textarea is as tall as its lines and the box around it scrolls, so a caret on a new line has to be scrolled to by hand.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (caret === null || !box) return;
    const top = PAD + caret * ROW;
    if (top - PAD < box.scrollTop) box.scrollTop = top - PAD;
    else if (top + ROW + PAD > box.scrollTop + box.clientHeight) box.scrollTop = top + ROW + PAD - box.clientHeight;
  }, [caret, result.lines.length]);

  const edit = (value: string, at: number) => {
    cleared = null;
    sheet.set({ text: value });
    setCaret(value.slice(0, at).split("\n").length - 1);
  };
  const clearOrUndo = () => {
    if (canUndo) {
      sheet.set({ text: cleared! });
      cleared = null;
    } else {
      cleared = text;
      sheet.set({ text: "" });
    }
    redraw((n) => n + 1);
    area.current?.focus();
  };

  const copy = async (row: number, shown: string) => {
    let ok = true;
    try {
      await navigator.clipboard.writeText(shown);
    } catch {
      ok = false;
    }
    setFlash({ row, ok });
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1400);
  };

  // Escape leaves the field first and stops there, so it does not also close the notch; the next Escape closes.
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    e.currentTarget.blur();
  };

  const rows = result.lines;
  return (
    <div className="flex h-full flex-col px-4 pt-1 pb-1">
      <HeaderActions>
        <HeaderButton label={canUndo ? t("Leeren rückgängig") : t("Leeren")} disabled={!text && !canUndo} onClick={clearOrUndo}>
          {canUndo ? <ArrowCounterClockwise size={14} weight="bold" /> : <Trash size={14} weight="bold" />}
        </HeaderButton>
      </HeaderActions>

      <div ref={scroller} dir="ltr" className="min-h-0 flex-1 overflow-y-auto rounded-[12px] bg-fill-1 py-2 [scrollbar-width:thin]" onClick={() => area.current?.focus()}>
        <div className="relative flex min-h-full items-stretch">
          {/* A faint red band behind a line that failed; the line being typed is left alone until the caret moves on. */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0">
            {rows.map((r, i) => (
              <div key={i} style={{ height: ROW }} className={r.kind === "error" && i !== caret && !(r.code === "rates" && loading) ? "bg-red/10" : ""} />
            ))}
          </div>
          <textarea
            ref={area}
            value={text}
            onChange={(e) => edit(e.target.value, e.target.selectionStart)}
            onSelect={(e) => setCaret(e.currentTarget.value.slice(0, e.currentTarget.selectionStart).split("\n").length - 1)}
            onBlur={() => setCaret(null)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            wrap="off"
            maxLength={MAX_CHARS}
            aria-label={t("Rechnungen")}
            placeholder={t("Rechnung eingeben, z. B. 5 km in miles")}
            style={{ minHeight: rows.length * ROW }}
            className={`${TEXT} relative block min-w-0 flex-1 resize-none overflow-x-auto overflow-y-hidden bg-transparent p-0 pl-3 text-label caret-label outline-none [scrollbar-width:none] placeholder:text-label-4 selection:bg-link/40`}
          />
          <div className={`${TEXT} relative w-[42%] shrink-0 pr-3 pl-2 text-right`}>
            {rows.map((r, i) => {
              if (r.kind === "empty") return <div key={i} style={{ height: ROW }} />;
              if (r.kind === "error") {
                const soft = i === caret || (r.code === "rates" && loading);
                const message = r.code === "rates" && loading ? "…" : describe(r.code, r.vars);
                return (
                  <div key={i} style={{ height: ROW }} title={message} className={`truncate ${soft ? "text-label-3" : "text-red"}`}>
                    {message}
                  </div>
                );
              }
              const shown = formatValue(r.value, lang);
              const mark = flash?.row === i ? (flash.ok ? t("Kopiert") : t("Kopieren fehlgeschlagen")) : null;
              return (
                <button
                  key={i}
                  type="button"
                  style={{ height: ROW }}
                  title={shown}
                  aria-label={t("Ergebnis kopieren: {text}", { text: shown })}
                  onClick={(e) => {
                    e.stopPropagation();
                    void copy(i, shown);
                  }}
                  className={`tabular block w-full truncate text-right ${mark ? (flash?.ok ? "text-green" : "text-red") : "text-label hover:text-label-2"}`}
                >
                  {mark ?? shown}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
