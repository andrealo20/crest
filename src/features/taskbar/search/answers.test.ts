import { test } from "node:test";
import assert from "node:assert/strict";
import { allZones } from "../../clocks/zones.ts";
import { answerHit, cityTime, needsRates, type AnswerContext } from "./answers.ts";

const ctx: AnswerContext = { now: new Date(2026, 10, 26, 12), locale: "en-US", h12: false, zones: allZones() };
const money = (amount: number, from: string, to: string) => (from === "USD" && to === "EUR" ? amount * 0.9 : null);

test("a sum or a conversion answers as you type, and Enter copies the answer", () => {
  assert.equal(answerHit("12*8.5", ctx)?.title, "102");
  assert.equal(answerHit("5 km in m", ctx)?.title, "5,000 m");
  assert.equal(answerHit("100 usd to eur", { ...ctx, money })?.title, "€90.00");
  assert.deepEqual(answerHit("12*8.5", ctx)?.action, { do: "copy", text: "102" });
});

test("money waits for the rates", () => {
  assert.equal(needsRates("100 usd to eur"), true);
  assert.equal(needsRates("12*8.5"), false);
  assert.equal(answerHit("100 usd to eur", ctx), null);
});

test("words, a bare number or an amount alone give no answer", () => {
  for (const q of ["holiday", "notepad", "vsc", "altezza 44", "12", "weather", "5 km", "100 usd", "now", "pi", "1/0", "-5"]) assert.equal(answerHit(q, ctx), null, q);
});

test("the time in a city, with the word for time or the city's whole name", () => {
  for (const q of ["time in tokyo", "ora a Tokyo", "tokyo", "Tokyo time", "heure à Tokyo"]) assert.equal(cityTime(q, ctx.zones)?.zone, "Asia/Tokyo", q);
  assert.equal(cityTime("rom", ctx.zones), null);
  assert.equal(cityTime("rome", ctx.zones)?.zone, "Europe/Rome");
  assert.equal(cityTime("holiday", ctx.zones), null);
  assert.match(answerHit("time in tokyo", ctx)?.title ?? "", /^\d{2}:\d{2}$/);
  assert.equal(answerHit("time in tokyo", ctx)?.icon && "glyph" in answerHit("time in tokyo", ctx)!.icon, true);
});
