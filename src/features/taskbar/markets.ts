/*
 * The bar's Exchange rate and Crypto widgets, the rules apart from their drawing (window/MarketFaces.tsx, window/CryptoPanel.tsx): a
 * rate's figures, a line's points in its box and a change's tone. Pure, so node tests it.
 */

/** One unit's rate in the language's figures, to five significant digits: 1.1835, 191.23 and 28,762 take about the same room. */
export const rateText = (rate: number, locale: string): string => new Intl.NumberFormat(locale, { minimumSignificantDigits: 5, maximumSignificantDigits: 5 }).format(rate);

/**
 * A line's points in a `w` by `h` box, left to right, its lowest point a pixel over the bottom and its highest a pixel under the top,
 * so the stroke is never cut; a flat line runs across the middle. None under two points.
 */
export function spanPoints(values: readonly number[], w = 28, h = 14): [number, number][] {
  if (values.length < 2) return [];
  const lo = Math.min(...values), hi = Math.max(...values), step = w / (values.length - 1);
  return values.map((v, i) => [+(i * step).toFixed(1), hi > lo ? +(h - 1 - ((v - lo) / (hi - lo)) * (h - 2)).toFixed(1) : h / 2]);
}

/**
 * What the crypto widget shows, by its version (marketSources.tsx), over its range: a coin in the Depot's base currency, a stock in
 * its own currency, or the Depot's total with its performance. `change` is in percent over the range (today: over 24 hours, since the last close, since yesterday), `day` how many of the line's
 * last points the bar draws (today: the last 24 hours, the last session, all of today; a longer range all), and `hidden` masks the
 * portfolio's amounts while the screen is shared.
 */
export interface Market {
  kind: "coin" | "stock" | "portfolio";
  /** What the line and the change span (model.ts MarketRange). */
  range: "1d" | "1w" | "1m" | "1y";
  symbol: string;
  name?: string | null;
  base: string;
  price: number;
  change: number | null;
  line: number[];
  day: number;
  hidden?: boolean;
}

/** The crypto widget's ranges by name, as the Widgets page offers them and its panel captions a longer one. */
export const RANGE_LABEL: Record<Market["range"], string> = { "1d": "Heute", "1w": "Woche", "1m": "Monat", "1y": "Jahr" };

/** The points the bar draws: the line's last `day`, none for a day of none. */
export const dayLine = (m: Pick<Market, "line" | "day">): number[] => (m.day > 0 ? m.line.slice(-m.day) : []);

export type Tone = "up" | "down" | "flat";

/** Up or down as the change shows at two decimals (formatPercent), flat below that and while it is not known. */
export const changeTone = (change: number | null): Tone => (change === null || Math.abs(change) < 0.005 ? "flat" : change > 0 ? "up" : "down");
