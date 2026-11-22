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

export type Tone = "up" | "down" | "flat";

/** Up or down as the change shows at two decimals (formatPercent), flat below that and while it is not known. */
export const changeTone = (change: number | null): Tone => (change === null || Math.abs(change) < 0.005 ? "flat" : change > 0 ? "up" : "down");
