import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_TARGETS, addTarget, convertMoney, currencies, pairOf, removeTarget, saved, targetsOf, toTop } from "./fx.ts";
import type { Rates } from "../trading/portfolio.ts";

/** Reference rate style: units per one GBP. */
const rates: Rates = { base: "GBP", crypto: {}, fx: { EUR: 1.16, USD: 1.36, JPY: 205 }, failed: [] };

const near = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test("converts from and to the base", () => {
  near(convertMoney(100, "GBP", "EUR", rates), 116);
  near(convertMoney(116, "EUR", "GBP", rates), 100);
  near(convertMoney(5, "GBP", "GBP", rates), 5);
});

test("crosses two currencies through the base", () => {
  // 100 EUR = 100 / 1.16 GBP = 117.24 USD.
  near(convertMoney(100, "EUR", "USD", rates), (100 / 1.16) * 1.36);
  near(convertMoney(0, "EUR", "JPY", rates), 0);
});

test("lower-case codes work, unknown or missing rates give null", () => {
  near(convertMoney(10, "gbp", "eur", rates), 11.6);
  assert.equal(convertMoney(10, "XYZ", "EUR", rates), null);
  assert.equal(convertMoney(10, "EUR", "XYZ", rates), null);
  assert.equal(convertMoney(10, "EUR", "USD", { ...rates, fx: {} }), null);
});

test("the list holds the base and every rate, sorted", () => {
  assert.deepEqual(currencies(rates), ["EUR", "GBP", "JPY", "USD"]);
  assert.deepEqual(currencies({ ...rates, fx: {} }), ["GBP"]);
});

test("the Converter's pair is the saved one while it is two codes, else the base and the euro, or the dollar for the euro", () => {
  assert.deepEqual(pairOf(["GBP", "JPY"], "EUR"), ["GBP", "JPY"]);
  assert.deepEqual(pairOf(null, "GBP"), ["GBP", "EUR"]);
  assert.deepEqual(pairOf(null, "EUR"), ["EUR", "USD"]);
  for (const saved of [undefined, "GBP", [], ["GBP"], ["GBP", "EUR", "USD"], ["gbp", "EUR"], ["GBPX", "EUR"], ["GBP", 3], { 0: "GBP", 1: "EUR" }]) assert.deepEqual(pairOf(saved, "CHF"), ["CHF", "EUR"]);
});

const eight = ["AUD", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "GBP"];

test("the currencies under the amount: the bar's pair first, then the saved ones, each once, never the amount's own, at most eight (#87)", () => {
  assert.deepEqual(targetsOf(["EUR", "USD"], ["GBP", "JPY"]), ["USD", "GBP", "JPY"]);
  // Another window's list arrives as it is.
  assert.deepEqual(targetsOf(["EUR", "USD"], ["USD", "EUR", "GBP", "gbp", 3, "GBPX", "GBP"]), ["USD", "GBP"]);
  for (const more of [null, undefined, "GBP", { 0: "GBP" }]) assert.deepEqual(targetsOf(["EUR", "USD"], more), ["USD"]);
  assert.equal(MAX_TARGETS, 8);
  assert.deepEqual(targetsOf(["EUR", "USD"], [...eight, "HKD"]), ["USD", ...eight.slice(0, 7)]);
});

test("a currency is added once, never the amount's own and while there is room, and the last one listed stays", () => {
  assert.deepEqual(addTarget("EUR", ["USD"], "GBP"), ["USD", "GBP"]);
  assert.deepEqual(addTarget("EUR", ["USD"], "USD"), ["USD"]);
  assert.deepEqual(addTarget("EUR", ["USD"], "EUR"), ["USD"]);
  assert.deepEqual(addTarget("EUR", eight, "HKD"), eight);
  assert.deepEqual(removeTarget(["USD", "GBP"], "USD"), ["GBP"]);
  // The bar's exchange rate shows the amount's currency against the first listed one.
  assert.deepEqual(removeTarget(["USD"], "USD"), ["USD"]);
});

test("a listed currency brought to the top swaps places with the amount's, so the rows keep their order", () => {
  assert.deepEqual(toTop("EUR", ["USD", "GBP", "JPY"], "GBP"), { from: "GBP", targets: ["USD", "EUR", "JPY"] });
  assert.deepEqual(toTop("EUR", ["USD", "GBP"], "USD"), { from: "USD", targets: ["EUR", "GBP"] });
  assert.deepEqual(toTop("EUR", ["USD"], "CHF"), { from: "EUR", targets: ["USD"] });
});

test("what is saved: the pair the bar's exchange rate reads, then the rest", () => {
  assert.deepEqual(saved("GBP", ["USD", "EUR", "JPY"]), { pair: ["GBP", "USD"], more: ["EUR", "JPY"] });
  assert.deepEqual(saved("GBP", ["USD"]), { pair: ["GBP", "USD"], more: [] });
});
