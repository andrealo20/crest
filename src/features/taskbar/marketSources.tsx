import { useEffect, useState, type ReactNode } from "react";
import { fetchCoin, fetchRates, fetchStock } from "../../platform/portfolio";
import { settings } from "../../settings/store";
import { lastPair } from "../convert/currency";
import { convertMoney, pairOf } from "../convert/fx";
import { usePresenting } from "../privacy/store";
import { effectiveBase } from "../trading/base";
import { combineChanges, seriesFor, spanChange, todayChange, totalPerformance } from "../trading/portfolio";
import { usePortfolio } from "../trading/usePortfolio";
import { barFeed } from "./barStores";
import type { Market } from "./markets";
import { variantOf } from "./model";
import { useSlice } from "./slice";

// The notch's sources of the bar's Exchange rate and Crypto widgets, which feed.tsx runs while the widget is on the bar.

/** How often the exchange rate is read: the reference rates change once a working day, and the Converter's own read shares Rust's cache. */
const CURRENCY_EVERY = 60 * 60_000;
/** How soon a failed exchange rate is read again, only while it fails. */
const RETRY_MS = 60_000;
/** How often the coin is read: CoinGecko's keyless limit is shared with the Depot, and Rust answers from its cache within a minute. */
const COIN_EVERY = 2 * 60_000;
/** How often the stock is read: Yahoo Finance's steps are 15 minutes, and Rust answers from its cache within a minute. */
const STOCK_EVERY = 2 * 60_000;
/** How often the Depot's accounts are read for the bar: each broker's own cache in Rust keeps within its limits, the Depot's view reads every 30 s. */
const PORTFOLIO_EVERY = 5 * 60_000;

/**
 * The Converter's pair at one unit's rate, in the feed's currency slice: read now, every CURRENCY_EVERY, and again when the base or
 * the pair changes (picked in the Converter, which saves it for every window). Through the base, as the Converter converts, so both
 * share the rates. A failed read keeps the last rate and tries again after RETRY_MS (a start before the network is up); another
 * pair's last rate is not sent under this pair's name.
 */
export function CurrencySource(): null {
  const base = effectiveBase(settings.use().trading.base);
  const [from, to] = pairOf(lastPair.use(), base);
  const [rate, setRate] = useState(() => barFeed.get().currency);
  useEffect(() => {
    let on = true, retry = 0;
    const again = () => {
      window.clearTimeout(retry);
      retry = window.setTimeout(read, RETRY_MS);
    };
    const read = () =>
      void fetchRates(base, [], [from, to]).then(
        (r) => {
          if (!on) return;
          const one = convertMoney(1, from, to, r);
          if (one !== null) setRate({ from, to, rate: one });
          // Keyed on Frankfurter failing, not on a missing rate, so a pair it does not list is not read once a minute.
          if (r.failed.includes("frankfurter")) again();
        },
        () => {
          if (on) again();
        },
      );
    read();
    const id = window.setInterval(read, CURRENCY_EVERY);
    return () => {
      on = false;
      window.clearInterval(id);
      window.clearTimeout(retry);
    };
  }, [base, from, to]);
  useSlice("currency", rate && rate.from === from && rate.to === to ? rate : null);
  return null;
}

/** The crypto widget's source by its version: the coin, the stock or the Depot's total, each in the feed's crypto slice. */
export function CryptoSource(): ReactNode {
  const v = variantOf(settings.use().taskbar.variants, "crypto");
  return v === "portfolio" ? <PortfolioSource /> : v === "stock" ? <StockSource /> : <CoinSource />;
}

/**
 * Reads `read` now and every `every` ms while its key (what it reads) stays, and keeps what it last gave: a value, or null for a
 * symbol nobody knows, so the widget shows its icon. It starts from the slice the bar has when that is of the same key (`last`), so a
 * source mounted again does not blink to the icon; an error keeps the last value, of this key only.
 */
function useMarket(key: string, every: number, last: (m: Market) => boolean, read: () => Promise<Market | null>): Market | null {
  const [got, setGot] = useState<{ key: string; market: Market | null } | null>(() => {
    const m = barFeed.get().crypto;
    return m && last(m) ? { key, market: m } : null;
  });
  useEffect(() => {
    let on = true;
    const once = () => void read().then((market) => on && setGot({ key, market }), () => {});
    once();
    const id = window.setInterval(once, every);
    return () => {
      on = false;
      window.clearInterval(id);
    };
    // `read` follows the key.
  }, [key, every]);
  return got?.key === key ? got.market : null;
}

/** The coin picked in Items, in the Depot's base currency, over the widget's range: read every COIN_EVERY. */
function CoinSource(): null {
  const s = settings.use();
  const base = effectiveBase(s.trading.base), symbol = s.taskbar.coin, range = s.taskbar.marketRange;
  const coin = useMarket(
    `${base}:${symbol}:${range}`,
    COIN_EVERY,
    (m) => m.kind === "coin" && m.symbol === symbol && m.base === base && m.range === range,
    () => fetchCoin(base, symbol, range).then((d) => d && { kind: "coin", range, symbol, base, ...d }),
  );
  useSlice("crypto", coin);
  return null;
}

/** The stock typed by its Yahoo Finance symbol, in its own currency, over the widget's range: read every STOCK_EVERY. */
function StockSource(): null {
  const { stock: symbol, marketRange: range } = settings.use().taskbar;
  const stock = useMarket(
    `${symbol}:${range}`,
    STOCK_EVERY,
    (m) => m.kind === "stock" && m.symbol === symbol && m.range === range,
    () =>
      fetchStock(symbol, range).then(
        (d) => d && { kind: "stock", range, symbol, name: d.name, base: d.currency, price: d.price, change: d.change, line: d.line, day: d.day },
      ),
  );
  useSlice("crypto", stock);
  return null;
}

/** How many daily points of the Depot's history a week, a month and a year span (spanChange), today and the day the range starts. */
const SPAN_DAYS = { "1w": 8, "1m": 31, "1y": 366 } as const;

/**
 * The Depot's total as its view shows it with no account picked, read every PORTFOLIO_EVERY (which records its history too): the value
 * of every account and, today, the change from the accounts' own changes with today's line, or over a week, a month or a year the
 * change and the line of the daily history. Masked while the screen is shared. Nothing while no account is set up or none has a
 * total; until the first read, the slice the bar has if it is the portfolio's over the same range.
 */
function PortfolioSource(): null {
  const range = settings.use().taskbar.marketRange;
  const { state } = usePortfolio(PORTFOLIO_EVERY);
  const hidden = usePresenting();
  const total = state?.total ?? null;
  let span: { line: number[]; pct: number | null } = { line: [], pct: null };
  if (state && range !== "1d") {
    if (state.history) span = spanChange(state.history, SPAN_DAYS[range]);
  } else if (state) {
    const today = combineChanges(state.accounts.map((a) => (a.summary && a.history ? todayChange(totalPerformance(a.summary), a.history) : null)));
    span = { line: state.history ? seriesFor(state.history, "1d") : [], pct: today?.pct ?? null };
  }
  const last = barFeed.get().crypto;
  const read: Market | null =
    state && total ? { kind: "portfolio", range, symbol: "", base: state.base, price: total.value, change: span.pct, line: span.line, day: span.line.length, hidden } : null;
  useSlice("crypto", state ? read : last?.kind === "portfolio" && last.range === range ? { ...last, hidden } : null);
  return null;
}
