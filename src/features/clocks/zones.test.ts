import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_ZONES, allZones, cityName, dayDelta, formatClock, formatDiff, formatUtc, hourOfDay, isDay, isZone, moveZone, normalizeZones, regionName, searchZones, wallTime, zoneOffset } from "./zones.ts";

const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

test("offsets follow each country's daylight saving dates", () => {
  assert.equal(zoneOffset(utc(2026, 1, 15, 12), "Europe/Rome"), 60);
  assert.equal(zoneOffset(utc(2026, 7, 15, 12), "Europe/Rome"), 120);
  assert.equal(zoneOffset(utc(2026, 1, 15, 12), "America/New_York"), -300);
  assert.equal(zoneOffset(utc(2026, 7, 15, 12), "America/New_York"), -240);
  // The switch itself: Rome springs forward at 01:00 UTC on 29 March, New York three weeks earlier.
  assert.equal(zoneOffset(utc(2026, 3, 29, 0, 59), "Europe/Rome"), 60);
  assert.equal(zoneOffset(utc(2026, 3, 29, 1, 0), "Europe/Rome"), 120);
  assert.equal(zoneOffset(utc(2026, 3, 8, 6, 59), "America/New_York"), -300);
  assert.equal(zoneOffset(utc(2026, 3, 8, 7, 0), "America/New_York"), -240);
});

test("the gap between two cities changes in the weeks when only one has switched", () => {
  const gap = (t: number) => formatDiff(zoneOffset(t, "America/New_York") - zoneOffset(t, "Europe/Rome"));
  assert.equal(gap(utc(2026, 2, 1, 12)), "-6 h");
  assert.equal(gap(utc(2026, 3, 15, 12)), "-5 h"); // New York already on summer time, Rome not yet.
  assert.equal(gap(utc(2026, 4, 15, 12)), "-6 h");
});

test("half and quarter hour zones, the southern hemisphere and a 30 minute daylight saving shift", () => {
  assert.equal(zoneOffset(utc(2026, 6, 1), "Asia/Kolkata"), 330);
  assert.equal(zoneOffset(utc(2026, 6, 1), "Asia/Kathmandu"), 345);
  assert.equal(zoneOffset(utc(2026, 1, 15), "Australia/Sydney"), 660);
  assert.equal(zoneOffset(utc(2026, 7, 15), "Australia/Sydney"), 600);
  assert.equal(zoneOffset(utc(2026, 1, 15), "Australia/Lord_Howe"), 660);
  assert.equal(zoneOffset(utc(2026, 7, 15), "Australia/Lord_Howe"), 630);
  assert.equal(zoneOffset(utc(2026, 7, 15), "UTC"), 0);
});

test("the difference reads as hours with minutes only where there are some", () => {
  assert.equal(formatDiff(300), "+5 h");
  assert.equal(formatDiff(330), "+5:30 h");
  assert.equal(formatDiff(345), "+5:45 h");
  assert.equal(formatDiff(-180), "-3 h");
  assert.equal(formatDiff(-570), "-9:30 h");
  assert.equal(formatDiff(0), "0 h");
  assert.equal(formatUtc(330), "UTC+5:30");
  assert.equal(formatUtc(-240), "UTC-4");
  assert.equal(formatUtc(0), "UTC");
});

test("a zone can be a day ahead or behind you, judged at the instant shown", () => {
  const evening = utc(2026, 11, 6, 20); // 20:00 in London, 05:00 on the 7th in Tokyo.
  assert.equal(dayDelta(evening, "Asia/Tokyo", evening, "Europe/London"), 1);
  assert.equal(dayDelta(evening, "Europe/London", evening, "Europe/London"), 0);
  const early = utc(2026, 11, 6, 2); // 21:00 on the 5th in New York.
  assert.equal(dayDelta(early, "America/New_York", early, "Europe/London"), -1);
  // Sliding the reference a day on: "today" stays the real now, so everything is one day further.
  assert.equal(dayDelta(evening + 24 * 3_600_000, "Europe/London", evening, "Europe/London"), 1);
  assert.equal(dayDelta(evening + 24 * 3_600_000, "Asia/Tokyo", evening, "Europe/London"), 2);
});

test("day and night by the zone's own clock", () => {
  const noonUtc = utc(2026, 11, 6, 12);
  assert.equal(isDay(noonUtc, "Europe/London"), true);
  assert.equal(isDay(noonUtc, "Asia/Tokyo"), false); // 21:00.
  assert.equal(isDay(noonUtc, "America/Los_Angeles"), false); // 04:00.
  assert.equal(isDay(noonUtc, "Asia/Kolkata"), true); // 17:30.
  assert.equal(hourOfDay(utc(2026, 11, 6, 12, 30), "Asia/Kolkata"), 18);
});

test("clock text in 24 and 12 hours, midnight included", () => {
  const w = (h: number, m: number, zone = "UTC") => wallTime(utc(2026, 11, 6, h, m), zone);
  assert.equal(formatClock(w(14, 30), "en-GB", false), "14:30");
  assert.equal(formatClock(w(0, 5), "en-GB", false), "00:05");
  assert.equal(formatClock(w(0, 5), "en-US", false), "00:05");
  assert.match(formatClock(w(14, 30), "en-US", true), /^2:30\sPM$/);
  assert.equal(formatClock(w(14, 30, "Asia/Kolkata"), "en-GB", false), "20:00");
});

test("city and region from the zone name", () => {
  assert.equal(cityName("America/Argentina/Buenos_Aires"), "Buenos Aires");
  assert.equal(cityName("America/New_York"), "New York");
  assert.equal(cityName("Asia/Calcutta"), "Kolkata");
  assert.equal(cityName("UTC"), "UTC");
  assert.equal(regionName("Europe/Rome"), "Europe");
  assert.equal(regionName("America/Argentina/Buenos_Aires"), "America");
  assert.equal(regionName("UTC"), "");
});

test("the picker finds cities by their name, the old name of a renamed one, or the region", () => {
  const zones = ["Europe/London", "America/New_York", "Asia/Calcutta", "America/North_Dakota/New_Salem", "Europe/Rome", "UTC"];
  assert.deepEqual(searchZones("new y", zones), ["America/New_York"]);
  assert.deepEqual(searchZones("KOLK", zones), ["Asia/Calcutta"]);
  assert.deepEqual(searchZones("calcutta", zones), ["Asia/Calcutta"]);
  assert.deepEqual(searchZones("new", zones), ["America/North_Dakota/New_Salem", "America/New_York"]); // Both start with it: by name.
  assert.deepEqual(searchZones("chi", ["Asia/Aching", "Asia/Chita"]), ["Asia/Chita", "Asia/Aching"]); // A city starting with it before one that only contains it.
  assert.deepEqual(searchZones("europe", zones), ["Europe/London", "Europe/Rome"]);
  assert.deepEqual(searchZones("  ", zones), []);
  assert.deepEqual(searchZones("zzz", zones), []);
});

test("the engine's own list works with the picker and holds only zones it can use", () => {
  const zones = allZones();
  assert.ok(zones.length > 300 && zones.includes("UTC") && zones.includes("Europe/London"));
  for (const z of zones) assert.ok(isZone(z), z);
  assert.ok(searchZones("tokyo", zones).includes("Asia/Tokyo"));
});

test("a saved list is cleaned: unknown, repeated and non-text entries go, and it is capped", () => {
  assert.deepEqual(normalizeZones(["Europe/Rome", "Europe/Rome", "Not/AZone", 5, null, "", "Asia/Tokyo"]), ["Europe/Rome", "Asia/Tokyo"]);
  assert.deepEqual(normalizeZones(undefined), []);
  assert.deepEqual(normalizeZones({ 0: "Europe/Rome" }), []);
  const many = allZones().slice(0, 40);
  assert.equal(normalizeZones(many).length, MAX_ZONES);
});

test("reordering moves one place and stops at the ends", () => {
  const list = ["a", "b", "c"];
  assert.deepEqual(moveZone(list, "b", -1), ["b", "a", "c"]);
  assert.deepEqual(moveZone(list, "b", 1), ["a", "c", "b"]);
  assert.deepEqual(moveZone(list, "a", -1), list);
  assert.deepEqual(moveZone(list, "c", 1), list);
  assert.deepEqual(moveZone(list, "x", 1), list);
  assert.deepEqual(list, ["a", "b", "c"]); // Never changed in place.
});
