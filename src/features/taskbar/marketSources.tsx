import { useEffect, useState } from "react";
import { fetchCoin, fetchRates } from "../../platform/portfolio";
import { settings } from "../../settings/store";
import { lastPair } from "../convert/currency";
import { convertMoney, pairOf } from "../convert/fx";
import { effectiveBase } from "../trading/base";
import { barFeed } from "./barStores";
import { useSlice } from "./slice";

// The notch's sources of the bar's Exchange rate and Crypto widgets, which feed.tsx runs while the widget is on the bar.

/** How often the exchange rate is read: the reference rates change once a working day, and the Converter's own read shares Rust's cache. */
const CURRENCY_EVERY = 60 * 60_000;
/** How often the coin is read: CoinGecko's keyless limit is shared with the Depot, and Rust answers from its cache within a minute. */
const COIN_EVERY = 2 * 60_000;

/**
 * The Converter's pair at one unit's rate, in the feed's currency slice: read now, every CURRENCY_EVERY, and again when the base or
 * the pair changes (picked in the Converter, which saves it for every window). Through the base, as the Converter converts, so both
 * share the rates. A failed read keeps the last rate; another pair's last rate is not sent under this pair's name.
 */
export function CurrencySource(): null {
  const base = effectiveBase(settings.use().trading.base);
  const [from, to] = pairOf(lastPair.use(), base);
  const [rate, setRate] = useState(() => barFeed.get().currency);
  useEffect(() => {
    let on = true;
    const read = () =>
      void fetchRates(base, [], [from, to]).then(
        (r) => {
          const one = convertMoney(1, from, to, r);
          if (on && one !== null) setRate({ from, to, rate: one });
        },
        () => {},
      );
    read();
    const id = window.setInterval(read, CURRENCY_EVERY);
    return () => {
      on = false;
      window.clearInterval(id);
    };
  }, [base, from, to]);
  useSlice("currency", rate && rate.from === from && rate.to === to ? rate : null);
  return null;
}

/**
 * The crypto widget's coin (picked in Items) in the Depot's base currency, in the feed's crypto slice: read now and every COIN_EVERY.
 * A coin CoinGecko does not know empties it, so the widget shows its icon; an error keeps the last value, of this coin and base only.
 */
export function CryptoSource(): null {
  const s = settings.use();
  const base = effectiveBase(s.trading.base), symbol = s.taskbar.coin;
  const [coin, setCoin] = useState(() => barFeed.get().crypto);
  useEffect(() => {
    let on = true;
    const read = () => void fetchCoin(base, symbol).then((d) => on && setCoin(d && { symbol, base, ...d }), () => {});
    read();
    const id = window.setInterval(read, COIN_EVERY);
    return () => {
      on = false;
      window.clearInterval(id);
    };
  }, [base, symbol]);
  useSlice("crypto", coin && coin.symbol === symbol && coin.base === base ? coin : null);
  return null;
}
