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
  return Array.isArray(saved) && saved.length === 2 && saved.every(isCode) ? [saved[0], saved[1]] : [base, base === "EUR" ? "USD" : "EUR"];
}

const isCode = (c: unknown): c is string => typeof c === "string" && /^[A-Z]{3}$/.test(c);

/** Most currencies the Converter lists under its amount. */
export const MAX_TARGETS = 8;

/**
 * The currencies listed under the amount (#87): the saved pair's second, the one the bar's exchange rate shows, then the others
 * saved, each once, never the amount's own, at most MAX_TARGETS. Another window's saved list arrives as it is, so it is checked here.
 */
export function targetsOf([from, to]: [string, string], more: unknown): string[] {
  const all = [to, ...(Array.isArray(more) ? more.filter(isCode) : [])];
  return [...new Set(all)].filter((c) => c !== from).slice(0, MAX_TARGETS);
}

/** `code` added at the end of the list, once and never the amount's own, while there is room. */
export const addTarget = (from: string, targets: string[], code: string): string[] =>
  code === from || targets.includes(code) || targets.length >= MAX_TARGETS ? targets : [...targets, code];

/** The list without `code`. Its last currency stays: the bar's exchange rate shows the amount's against the first listed. */
export const removeTarget = (targets: string[], code: string): string[] => (targets.length > 1 ? targets.filter((c) => c !== code) : targets);

/** A listed currency brought to the top: the amount is in it now, and the amount's old currency takes its place in the list. */
export const toTop = (from: string, targets: string[], code: string): { from: string; targets: string[] } =>
  targets.includes(code) ? { from: code, targets: targets.map((c) => (c === code ? from : c)) } : { from, targets };

/** What is saved: the pair the bar's exchange rate reads (lastPair), the amount's currency and the first listed, and the rest. */
export const saved = (from: string, targets: string[]): { pair: [string, string]; more: string[] } => ({ pair: [from, targets[0] ?? from], more: targets.slice(1) });
