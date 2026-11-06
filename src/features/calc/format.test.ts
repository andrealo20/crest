import { test } from "node:test";
import assert from "node:assert/strict";
import { formatNumber, formatValue } from "./format.ts";
import { findUnit } from "./units.ts";
import type { Value } from "./engine.ts";

test("numbers lose float noise and keep a sensible number of digits", () => {
  const rows: [number, string][] = [
    [0, "0"],
    [-0, "0"],
    [1, "1"],
    [-1.5, "-1.5"],
    [0.1 + 0.2, "0.3"],
    [4.35 * 100, "435"],
    [1.005 * 100, "100.5"],
    [1 / 3, "0.333333"],
    [2 / 3, "0.666667"],
    [100 / 3, "33.333333"],
    [1000 / 3, "333.33333"],
    [1e6 / 3, "333,333.33"],
    [123456789012, "123,456,789,012"],
    [123456789012345, "123,456,789,012,345"],
    [999999999999999, "999,999,999,999,999"],
    [1e15, "1E15"],
    [1.5e21, "1.5E21"],
    [-2.5e30, "-2.5E30"],
    [0.0000001, "0.0000001"],
    [0.00000012345678, "0.000000123457"],
    [1e-9, "1E-9"],
    [Number.MAX_VALUE, "1.797693135E308"],
    [Number.MIN_VALUE, "5E-324"],
  ];
  for (const [n, want] of rows) assert.equal(formatNumber(n, "en-US"), want, String(n));
});

test("a value that is not a real number is never written as one", () => {
  for (const n of [NaN, Infinity, -Infinity]) {
    assert.equal(formatNumber(n, "en-US"), "?");
    assert.equal(formatValue({ k: "num", v: n }, "en-US"), "?");
    assert.equal(formatValue({ k: "money", v: n, c: "EUR" }, "en-US"), "?");
    assert.ok(!/NaN|Infinity/.test(formatValue({ k: "pct", v: n }, "en-US")));
    assert.ok(!/NaN|Infinity/.test(formatValue({ k: "qty", v: n, u: findUnit("km")! }, "en-US")));
  }
  assert.equal(formatValue({ k: "date", t: NaN, time: false }, "en-US"), "?");
  assert.equal(formatValue({ k: "date", t: 8.64e15 + 1, time: false }, "en-US"), "?");
});

test("the app's language decides the separators", () => {
  assert.equal(formatNumber(1234567.891, "en-US"), "1,234,567.89");
  assert.equal(formatNumber(1234567.891, "de-DE"), "1.234.567,89");
  assert.equal(formatNumber(1234.5678, "it-IT"), "1234,5678"); // Italian writes four digits without a separator
  assert.equal(formatNumber(12345.5, "it-IT"), "12.345,5");
  assert.equal(formatNumber(0.5, "fr-FR"), "0,5");
  assert.equal(formatValue({ k: "pct", v: 0.155 }, "de-DE"), "15,5%");
  assert.equal(formatNumber(1.5, "not a locale!"), "1.5", "an unknown locale falls back to English");
});

test("quantities, percentages, money and dates", () => {
  const u = (id: string) => findUnit(id)!;
  const rows: [Value, string][] = [
    [{ k: "pct", v: 0.15 }, "15%"],
    [{ k: "pct", v: 0.155 }, "15.5%"],
    [{ k: "pct", v: 0.07 + 0.01 }, "8%"],
    [{ k: "qty", v: 5, u: u("km") }, "5 km"],
    [{ k: "qty", v: 3.5, u: u("mi") }, "3.5 mi"],
    [{ k: "qty", v: 22.5, u: u("C") }, "22.5°C"],
    [{ k: "qty", v: 72, u: u("F") }, "72°F"],
    [{ k: "qty", v: 300, u: u("K") }, "300 K"],
    [{ k: "qty", v: 30, u: u("deg") }, "30°"],
    [{ k: "qty", v: 1, u: u("rad") }, "1 rad"],
    [{ k: "qty", v: 2, u: u("m3") }, "2 m³"],
    [{ k: "qty", v: 1.5, u: u("floz") }, "1.5 fl oz"],
    [{ k: "qty", v: 60, u: u("km/h") }, "60 km/h"],
    [{ k: "qty", v: 1234.5, u: u("m") }, "1,234.5 m"],
    [{ k: "money", v: 1234.5, c: "EUR" }, "€1,234.50"],
    [{ k: "money", v: 5, c: "USD" }, "$5.00"],
    [{ k: "money", v: 1000, c: "JPY" }, "¥1,000"],
    [{ k: "money", v: 5, c: "XXX_" }, "5 XXX_"],
  ];
  for (const [v, want] of rows) assert.equal(formatValue(v, "en-US"), want);
  const day = new Date(2026, 11, 25).getTime();
  const plain = formatValue({ k: "date", t: day, time: false }, "en-US");
  assert.match(plain, /Fri/);
  assert.match(plain, /Dec/);
  assert.match(plain, /25/);
  assert.match(plain, /2026/);
  assert.ok(!/:/.test(plain), "a date without a time has no clock");
  const withTime = formatValue({ k: "date", t: new Date(2026, 11, 25, 14, 5).getTime(), time: true }, "en-US");
  assert.match(withTime, /2:05/);
});
