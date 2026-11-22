import { test } from "node:test";
import assert from "node:assert/strict";
import { convertMoney, currencies, pairOf } from "./fx.ts";
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
