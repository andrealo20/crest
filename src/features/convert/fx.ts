import { toBase, type Rates } from "../trading/portfolio.ts";

/**
 * `amount` of `from` in `to`. Reference rates are units per one base, so two other currencies cross through the base;
 * null when either has no rate.
 */
export function convertMoney(amount: number, from: string, to: string, rates: Rates): number | null {
  const inBase = toBase(amount, from, rates);
  const c = to.toUpperCase();
  if (inBase === null) return null;
  if (c === rates.base) return inBase;
  const r = rates.fx[c];
  return r > 0 ? inBase * r : null;
}

/** The currencies the rates cover, the base included, sorted. */
export const currencies = (rates: Rates): string[] => [...new Set([rates.base, ...Object.keys(rates.fx)])].sort();

/**
 * The Converter's pair of currencies as saved, the one the bar's exchange rate shows too: while it is two three-letter codes, else the
 * base and the euro (the dollar when the base is the euro). Another window's saved value arrives as it is, so it is checked here.
 */
export function pairOf(saved: unknown, base: string): [string, string] {
  const code = (c: unknown): c is string => typeof c === "string" && /^[A-Z]{3}$/.test(c);
  return Array.isArray(saved) && saved.length === 2 && saved.every(code) ? [saved[0], saved[1]] : [base, base === "EUR" ? "USD" : "EUR"];
}
