// Direct answers in the bar's search: a sum or a conversion (Calc's engine, which converts money and units too) or the time in a
// city (Clocks' zones). Pure.

import { evaluate, type Options } from "../../calc/engine.ts";
import { formatValue } from "../../calc/format.ts";
import { formatClock, formatUtc, searchHits, wallTime, zoneOffset } from "../../clocks/zones.ts";
import { fold } from "../../settings/search.ts";
import type { Hit } from "./model.ts";

export interface AnswerContext {
  now: Date;
  locale: string;
  h12: boolean;
  zones: string[];
  /** `amount` of `from` in `to`, once the rates are here (Calc's `money`). */
  money?: Options["money"];
}

// Calc answers only text that asks for working out, a digit with an operator or a conversion word: "12", "100 usd" or "pi" alone
// are only typed, and a row repeating them would push the apps down.
const DIGIT = /\d/;
const WORK = /[+\-*/^%×÷()]|\b(in|to|as|into)\b/i;

/** Words for the time and the small words around a city, in Crest's languages; what is left is the city. */
const TIME_WORDS = new Set(["time", "ora", "orario", "hora", "horario", "heure", "uhrzeit", "zeit", "время", "時間", "時刻", "时间", "समय", "الوقت", "الساعة"]);
const LINKS = new Set(["in", "a", "at", "en", "de", "di", "em", "no", "na", "в", "во", "के", "में", "في", "の", "在"]);

/** The one answer row, or null: Calc's value when it worked something out, else the time in a city. */
export function answerHit(query: string, ctx: AnswerContext): Hit | null {
  const text = query.trim();
  if (DIGIT.test(text) && WORK.test(text)) {
    const line = evaluate(text, { now: ctx.now, money: ctx.money }).lines[0];
    if (line?.kind === "value") {
      const shown = formatValue(line.value, ctx.locale);
      if (fold(shown) !== fold(text)) return { key: "answer", kind: "answer", title: shown, subtitle: text, icon: { glyph: "calc" }, action: { do: "copy", text: shown } };
    }
  }
  const city = cityTime(text, ctx.zones);
  if (!city) return null;
  const ms = ctx.now.getTime();
  const shown = formatClock(wallTime(ms, city.zone), ctx.locale, ctx.h12);
  return { key: "answer", kind: "answer", title: shown, subtitle: `${city.name}, ${formatUtc(zoneOffset(ms, city.zone))}`, icon: { glyph: "clock" }, action: { do: "copy", text: shown } };
}

/** Whether the text names a currency, so the panel loads the rates first. */
export const needsRates = (query: string): boolean => evaluate(query.trim()).usesMoney;

/** The city in "time in tokyo", "ora a Tokyo" or a city's whole name alone; a part of a name needs the word for the time. */
export function cityTime(query: string, zones: string[]): { zone: string; name: string } | null {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const asked = words.some((w) => TIME_WORDS.has(w));
  const rest = words.filter((w) => !TIME_WORDS.has(w) && !LINKS.has(w)).join(" ");
  if (!rest) return null;
  const hit = searchHits(rest, zones, 1)[0];
  if (!hit) return null;
  return asked || fold(hit.name) === rest ? hit : null;
}
