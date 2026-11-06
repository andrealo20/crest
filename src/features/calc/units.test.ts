import { test } from "node:test";
import assert from "node:assert/strict";
import { CURRENCIES, UNITS, convertUnits, findUnit } from "./units.ts";

const to = (value: number, from: string, into: string) => convertUnits(value, findUnit(from)!, findUnit(into)!);
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${a} vs ${b}`);

test("every name belongs to one unit, and the ids are unique", () => {
  const ids = new Set<string>();
  const names = new Map<string, string>();
  for (const unit of UNITS) {
    assert.ok(!ids.has(unit.id), `duplicate id ${unit.id}`);
    ids.add(unit.id);
    for (const n of unit.names) {
      assert.ok(!names.has(n) || names.get(n) === unit.id, `${n} names both ${names.get(n)} and ${unit.id}`);
      names.set(n, unit.id);
    }
    assert.ok(unit.factor > 0 || unit.cat === "temp");
  }
});

test("names are found as typed or in lower case", () => {
  assert.equal(findUnit("km")?.id, "km");
  assert.equal(findUnit("KM")?.id, "km");
  assert.equal(findUnit("Miles")?.id, "mi");
  assert.equal(findUnit("feet")?.id, "ft");
  assert.equal(findUnit("°F")?.id, "f");
  assert.equal(findUnit("F")?.id, "f");
  assert.equal(findUnit("Celsius")?.id, "c");
  assert.equal(findUnit("K")?.id, "K");
  assert.equal(findUnit("kelvin")?.id, "K");
  assert.equal(findUnit("k"), undefined, "a lone k is not Kelvin");
  assert.equal(findUnit("min")?.id, "min");
  assert.equal(findUnit("minutes")?.id, "min");
  assert.equal(findUnit("m")?.id, "m");
  assert.equal(findUnit("m/s")?.id, "m/s");
  assert.equal(findUnit("banana"), undefined);
  assert.equal(findUnit("constructor"), undefined);
  assert.equal(findUnit("__proto__"), undefined);
  assert.equal(findUnit(""), undefined);
});

test("conversions agree with the Converter's factors", () => {
  near(to(1, "mi", "km"), 1.609344);
  near(to(1, "in", "cm"), 2.54);
  near(to(1, "ft", "m"), 0.3048);
  near(to(1, "lb", "kg"), 0.45359237);
  near(to(1, "oz", "g"), 28.349523125);
  near(to(1, "gal", "l"), 3.785411784);
  near(to(1, "cup", "ml"), 236.5882365);
  near(to(60, "mph", "km/h"), 96.56064);
  near(to(1, "kn", "km/h"), 1.852);
  near(to(1, "m3", "l"), 1000);
});

test("time and angle units", () => {
  near(to(1, "h", "min"), 60);
  near(to(1, "d", "h"), 24);
  near(to(1, "wk", "d"), 7);
  near(to(1, "yr", "d"), 365.25);
  near(to(12, "mo", "yr"), 1);
  near(to(1, "s", "ms"), 1000);
  near(to(180, "deg", "rad"), Math.PI);
  near(to(Math.PI / 2, "rad", "deg"), 90);
});

test("temperature has offsets, not just a factor", () => {
  near(to(0, "c", "f"), 32);
  near(to(100, "c", "f"), 212);
  near(to(32, "f", "c"), 0);
  near(to(72, "f", "c"), 22.22222222222222);
  near(to(0, "c", "K"), 273.15);
  near(to(300, "K", "c"), 26.85);
  near(to(-40, "c", "f"), -40);
  near(to(0, "K", "f"), -459.67);
  near(to(5, "c", "c"), 5);
});

test("a conversion and its way back meet", () => {
  for (const cat of new Set(UNITS.map((u) => u.cat))) {
    const group = UNITS.filter((u) => u.cat === cat);
    for (const a of group) for (const b of group) near(convertUnits(convertUnits(123.456, a, b), b, a), 123.456);
  }
});

test("only currencies the ECB publishes can be named", () => {
  for (const c of ["EUR", "USD", "GBP", "JPY", "CHF", "SEK"]) assert.ok(CURRENCIES.has(c));
  assert.ok(!CURRENCIES.has("BTC"));
  assert.ok(!CURRENCIES.has("eur"), "codes are kept in capitals; the engine upper-cases what was typed");
  for (const c of CURRENCIES) assert.match(c, /^[A-Z]{3}$/);
});
