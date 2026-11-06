import type { Value } from "./engine.ts";

/*
 * How a value is written, in the app's language (`locale` is an Intl locale such as "en-GB" or "it-IT").
 * Numbers keep six decimals at most (fewer for big ones), lose floating-point noise (0.1 + 0.2 reads 0.3)
 * and go scientific beyond 15 digits or below 0.0000001. A value that is not a real number is never written as a number.
 */

const cache = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, options);
    } catch {
      f = new Intl.NumberFormat("en-US", options); // an unknown locale or currency code
    }
    cache.set(key, f);
  }
  return f;
}

export function formatNumber(n: number, locale: string): string {
  if (!Number.isFinite(n)) return "?";
  if (n === 0) return "0"; // also -0
  const abs = Math.abs(n);
  const rounded = Number(n.toPrecision(15));
  const clean = Number.isFinite(rounded) ? rounded : n; // 15 digits of MAX_VALUE round past it
  if (abs >= 1e15 || abs < 1e-7) return numberFormat(locale, { notation: "scientific", maximumSignificantDigits: 10 }).format(clean);
  // Six significant digits below 1; from there on the decimals shrink as the integer part grows (3.141593, 1,234.5679, 1,234,567.89).
  if (abs < 1) return numberFormat(locale, { maximumSignificantDigits: 6 }).format(clean);
  const integerDigits = Math.floor(Math.log10(abs)) + 1;
  return numberFormat(locale, { maximumFractionDigits: Math.min(6, Math.max(2, 8 - integerDigits)) }).format(clean);
}

export function formatValue(value: Value, locale: string): string {
  switch (value.k) {
    case "num": return formatNumber(value.v, locale);
    case "pct": return `${formatNumber(value.v * 100, locale)}%`;
    case "qty": return `${formatNumber(value.v, locale)}${value.u.symbol.startsWith("°") ? "" : " "}${value.u.symbol}`;
    case "money":
      if (!Number.isFinite(value.v)) return "?";
      try {
        return new Intl.NumberFormat(locale, { style: "currency", currency: value.c }).format(value.v);
      } catch {
        return `${formatNumber(value.v, locale)} ${value.c}`;
      }
    case "date": {
      const at = new Date(value.t);
      if (Number.isNaN(at.getTime())) return "?";
      const options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", year: "numeric" };
      if (value.time) Object.assign(options, { hour: "2-digit", minute: "2-digit" });
      try {
        return new Intl.DateTimeFormat(locale, options).format(at);
      } catch {
        return new Intl.DateTimeFormat("en-US", options).format(at);
      }
    }
  }
}
