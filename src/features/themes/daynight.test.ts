import { test } from "node:test";
import assert from "node:assert/strict";
import { HALF_HOURS, activeThemeId, chooseTheme, isNight, nextChange, parseTime, sunHours } from "./daynight.ts";
import { THEME_DEFAULTS } from "./themes.ts";

const at = (h: number, m = 0, day = 15) => new Date(2026, 9, day, h, m);
const schedule = (dayStart: string, nightStart: string, sun = false) => ({ on: true, day: "light", night: "dark", dayStart, nightStart, sun });
// On the equator, at the longitude whose solar time is this computer's clock, the sun rises near 06:00 and sets near 18:00
// all year, whatever time zone the tests run in.
const equator = (date: Date) => ({ lat: 0, lon: -date.getTimezoneOffset() / 4 });
// 21 December at 80 degrees north: the sun does not rise.
const polarNight = new Date(2026, 11, 21, 12), arctic = { lat: 80, lon: 0 };

test("parseTime", () => {
  assert.equal(parseTime("07:30"), 450);
  assert.equal(parseTime("7:05"), 425);
  for (const bad of ["24:00", "12:60", "noon", "", "1230"]) assert.equal(parseTime(bad), null, bad);
});

test("isNight with a normal day", () => {
  const s = schedule("07:00", "19:00");
  assert.equal(isNight(s, at(6, 59)), true);
  assert.equal(isNight(s, at(7, 0)), false);
  assert.equal(isNight(s, at(18, 59)), false);
  assert.equal(isNight(s, at(19, 0)), true);
  assert.equal(isNight(s, at(0, 0)), true);
});

test("isNight with a day past midnight", () => {
  const s = schedule("20:00", "08:00");
  assert.equal(isNight(s, at(21)), false);
  assert.equal(isNight(s, at(3)), false);
  assert.equal(isNight(s, at(8)), true);
  assert.equal(isNight(s, at(19, 59)), true);
});

test("equal or invalid times fall back to the defaults", () => {
  assert.equal(isNight(schedule("10:00", "10:00"), at(12)), false);
  assert.equal(isNight(schedule("x", "10:00"), at(20)), true);
});

test("nextChange", () => {
  const s = schedule("07:00", "19:00");
  assert.deepEqual(nextChange(s, at(12)), at(19));
  assert.deepEqual(nextChange(s, at(19)), at(7, 0, 16));
  assert.deepEqual(nextChange(s, at(6, 59)), at(7));
  assert.deepEqual(nextChange(s, at(23, 30)), at(7, 0, 16));
});

test("active theme and choosing", () => {
  const off = THEME_DEFAULTS;
  assert.equal(activeThemeId(off, at(23)), "dark");
  const on = { ...off, schedule: { ...off.schedule, on: true } };
  assert.equal(activeThemeId(on, at(12)), "light");
  assert.equal(activeThemeId(on, at(23)), "dark");
  assert.equal(chooseTheme(off, "dracula", at(12)).id, "dracula");
  assert.equal(chooseTheme(on, "dracula", at(12)).schedule.day, "dracula");
  assert.equal(chooseTheme(on, "dracula", at(23)).schedule.night, "dracula");
  assert.equal(HALF_HOURS.length, 48);
  assert.equal(HALF_HOURS[15], "07:30");
});

test("sunrise and sunset at a place, in minutes of the local day", () => {
  const noon = at(12);
  const [rise, set] = sunHours(noon, equator(noon))!;
  assert.ok(Math.abs(rise - 6 * 60) < 40, `sunrise at minute ${rise}`);
  assert.ok(Math.abs(set - 18 * 60) < 40, `sunset at minute ${set}`);
  assert.equal(sunHours(noon, null), null);
  assert.equal(sunHours(noon, { lat: NaN, lon: 0 }), null);
  assert.equal(sunHours(polarNight, arctic), null);
});

test("with the sun on, sunrise and sunset take the place of the set times (issue #41)", () => {
  const noon = at(12), place = equator(noon);
  // Set times that make noon the night, so the answer shows which pair was used.
  const s = schedule("20:00", "08:00", true);
  const [rise, set] = sunHours(noon, place)!;
  assert.equal(isNight(s, noon, place), false);
  assert.equal(isNight(s, at(2), place), true);
  assert.equal(isNight(s, at(0, rise - 1), place), true);
  assert.equal(isNight(s, at(0, rise), place), false);
  assert.equal(isNight(s, at(0, set - 1), place), false);
  assert.equal(isNight(s, at(0, set), place), true);
  // The set times again: without a place, where the sun does not rise, and with the switch off.
  assert.equal(isNight(s, noon), true);
  assert.equal(isNight(s, polarNight, arctic), true);
  assert.equal(isNight(schedule("20:00", "08:00"), noon, place), true);
});

test("nextChange with the sun: each day by its own sunrise and sunset", () => {
  const noon = at(12), place = equator(noon), s = schedule("07:00", "19:00", true);
  const [rise, set] = sunHours(noon, place)!;
  assert.deepEqual(nextChange(s, at(2), place), at(0, rise));
  assert.deepEqual(nextChange(s, noon, place), at(0, set));
  assert.deepEqual(nextChange(s, at(23, 30), place), at(0, sunHours(at(12, 0, 16), place)![0], 16));
});

test("with the sun the theme changes at every rising and setting, wherever the place is", () => {
  const s = schedule("07:00", "19:00", true);
  // All round the world at 40 degrees north, through a year: for places far from this computer's time zone the sun sets
  // after its midnight, where the day by the clock has already turned, and on some day of the year it crosses that midnight.
  for (let lon = -180; lon < 180; lon += 30) {
    const place = { lat: 40, lon };
    for (let h = 0; h < 366 * 24; h += 5) {
      const now = new Date(2026, 0, 1, h, 7), night = isNight(s, now, place), next = nextChange(s, now, place);
      const where = `longitude ${lon}, ${now.toISOString()}`;
      assert.ok(next > now, where);
      // The longest night there is under 15 hours.
      assert.ok(next.getTime() - now.getTime() < 16 * 3_600_000, `${where}: next change ${next.toISOString()}`);
      assert.equal(isNight(s, new Date(next.getTime() - 60_000), place), night, `${where}: a minute before ${next.toISOString()}`);
      assert.equal(isNight(s, next, place), !night, `${where}: at ${next.toISOString()}`);
    }
  }
});

test("active theme and choosing with the sun", () => {
  const noon = at(12), place = equator(noon);
  const on = { ...THEME_DEFAULTS, schedule: { ...THEME_DEFAULTS.schedule, on: true, sun: true, dayStart: "20:00", nightStart: "08:00" } };
  assert.equal(activeThemeId(on, noon, place), "light");
  assert.equal(activeThemeId(on, noon), "dark");
  assert.equal(chooseTheme(on, "dracula", noon, place).schedule.day, "dracula");
  assert.equal(chooseTheme(on, "dracula", noon).schedule.night, "dracula");
});
