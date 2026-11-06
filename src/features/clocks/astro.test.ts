import { test } from "node:test";
import assert from "node:assert/strict";
import { moonPhase, sunDay, sunPosition } from "./astro.ts";

const H = 3_600_000;
const MIN = 60_000;
const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
/** Minutes from `expected` to `actual`; the references below are the usual published times to the minute. */
const off = (actual: number | null, expected: number) => (actual === null ? Infinity : Math.abs(actual - expected) / MIN);

test("London on the June solstice: 04:43 to 21:21 BST", () => {
  const from = utc(2026, 6, 20, 23); // Midnight in BST.
  const day = sunDay(from, from + 24 * H, 51.5074, -0.1278);
  assert.ok(off(day.sunrise, utc(2026, 6, 21, 3, 43)) <= 3, "sunrise");
  assert.ok(off(day.sunset, utc(2026, 6, 21, 20, 21)) <= 3, "sunset");
  assert.equal(day.polar, null);
  // Golden hour wraps the sunrise and the sunset, and the sun is higher in between.
  const [m0, m1] = day.goldenMorning!;
  const [e0, e1] = day.goldenEvening!;
  assert.ok(m0 < day.sunrise! && day.sunrise! < m1);
  assert.ok(e0 < day.sunset! && day.sunset! < e1);
  assert.ok(m1 < e0);
});

test("New York and Sydney on the December solstice, each in its own local day", () => {
  const ny = utc(2026, 12, 21, 5); // Midnight EST.
  const a = sunDay(ny, ny + 24 * H, 40.7128, -74.006);
  assert.ok(off(a.sunrise, utc(2026, 12, 21, 12, 17)) <= 3, "New York sunrise 07:17");
  assert.ok(off(a.sunset, utc(2026, 12, 21, 21, 32)) <= 3, "New York sunset 16:32");

  // Sydney's day starts the evening before in UTC, so its sunrise is on the 20th there.
  const sy = utc(2026, 12, 20, 13); // Midnight AEDT.
  const b = sunDay(sy, sy + 24 * H, -33.8688, 151.2093);
  assert.ok(off(b.sunrise, utc(2026, 12, 20, 18, 41)) <= 3, "Sydney sunrise 05:41");
  assert.ok(off(b.sunset, utc(2026, 12, 21, 9, 5)) <= 3, "Sydney sunset 20:05");
});

test("a 23 hour day (clocks going forward) still gives that day's sunrise and sunset", () => {
  const from = utc(2026, 3, 29); // Midnight GMT; the next midnight is 23:00 UTC.
  const day = sunDay(from, from + 23 * H, 51.5074, -0.1278);
  assert.ok(day.sunrise! > from && day.sunrise! < day.sunset! && day.sunset! < from + 23 * H);
});

test("on the equator at the equinox the day is 12 hours long and noon follows the equation of time", () => {
  const from = utc(2026, 3, 20);
  const day = sunDay(from, from + 24 * H, 0, 0);
  const length = (day.sunset! - day.sunrise!) / MIN;
  assert.ok(Math.abs(length - 727) <= 3, `day length ${length} min`); // 12 h 07: the sun's disc and refraction add a few minutes.
  assert.ok(off((day.sunrise! + day.sunset!) / 2, utc(2026, 3, 20, 12, 7)) <= 3, "solar noon about 12:07 UTC");
});

test("midnight sun: no sunset and no sunrise, nothing thrown", () => {
  const from = utc(2026, 6, 20, 22); // Tromso, midnight CEST.
  const day = sunDay(from, from + 24 * H, 69.6492, 18.9553);
  assert.equal(day.polar, "day");
  assert.equal(day.sunrise, null);
  assert.equal(day.sunset, null);
  assert.equal(day.goldenMorning, null);
  assert.equal(day.goldenEvening, null);
});

test("polar night, and the poles themselves", () => {
  const from = utc(2026, 12, 20, 23);
  assert.equal(sunDay(from, from + 24 * H, 69.6492, 18.9553).polar, "night");
  // December: the sun never rises at the north pole and never sets at the south pole. An answer, not NaN or an exception.
  assert.equal(sunDay(from, from + 24 * H, 90, 0).polar, "night");
  assert.equal(sunDay(from, from + 24 * H, -90, 0).polar, "day");
});

test("Reykjavik at midsummer: the sun sets around midnight but never gets 4 degrees down, so golden hour has no end", () => {
  const from = utc(2026, 6, 21);
  const day = sunDay(from, from + 24 * H, 64.1466, -21.9426);
  assert.equal(day.polar, null);
  assert.ok(day.sunrise !== null && day.sunset !== null);
  assert.equal(day.goldenEvening, null);
});

test("the sun's declination reaches 23.4 degrees at the solstice and 0 at the equinox", () => {
  assert.ok(Math.abs(sunPosition(utc(2026, 6, 21, 8, 24)).declination - 23.44) < 0.05);
  assert.ok(Math.abs(sunPosition(utc(2026, 3, 20, 14, 46)).declination) < 0.05);
});

test("moon: Meeus' worked example, 12 April 1992 0h", () => {
  const m = moonPhase(utc(1992, 4, 12));
  assert.ok(Math.abs(m.fraction - 0.6786) < 0.005, `${m.fraction}`);
  assert.equal(m.waxing, true);
  assert.equal(m.phase, "waxing-gibbous");
});

test("moon: the four principal phases of April and May 2024", () => {
  const nm = moonPhase(utc(2024, 4, 8, 18, 21));
  assert.ok(nm.fraction < 0.005);
  assert.equal(nm.phase, "new");
  const fq = moonPhase(utc(2024, 4, 15, 19, 13));
  assert.ok(Math.abs(fq.fraction - 0.5) < 0.03);
  assert.equal(fq.phase, "first-quarter");
  assert.equal(fq.waxing, true);
  const fm = moonPhase(utc(2024, 4, 23, 23, 49));
  assert.ok(fm.fraction > 0.995);
  assert.equal(fm.phase, "full");
  const lq = moonPhase(utc(2024, 5, 1, 11, 27));
  assert.ok(Math.abs(lq.fraction - 0.5) < 0.03);
  assert.equal(lq.phase, "last-quarter");
  assert.equal(lq.waxing, false);
});

test("moon: one cycle waxes through crescent and gibbous to full, then wanes back", () => {
  const order = ["new", "waxing-crescent", "first-quarter", "waxing-gibbous", "full", "waning-gibbous", "last-quarter", "waning-crescent"];
  const seen: string[] = [];
  for (let d = 0; d < 30; d += 0.25) {
    const p = moonPhase(utc(2024, 4, 8, 18, 21) + d * 24 * H).phase;
    if (seen.at(-1) !== p) seen.push(p);
  }
  assert.deepEqual(seen.slice(0, 8), order);
});
