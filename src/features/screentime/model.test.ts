import { test } from "node:test";
import assert from "node:assert/strict";
import type { ScreenDay } from "../../platform/services.ts";
import { average, barHeight, dateKey, dayTotal, daysBack, eights, hourTotals, longDuration, ranked, screenFaceWidth, shortDuration, summary } from "./model.ts";

/** Seconds at hours 8, 9 and 10, the rest zero. */
const h = (...secs: number[]) => Array.from({ length: 24 }, (_, i) => secs[i - 8] ?? 0);
const day: ScreenDay = {
  date: "2026-11-23",
  apps: {
    "code.exe": { name: "Visual Studio Code", path: "C:\\Code.exe", h: h(1200, 3000) },
    "spotify.exe": { name: "Spotify", path: null, h: h(0, 0, 600) },
    "chrome.exe": { name: "Google Chrome", path: null, h: h(600, 300, 300) },
    "notepad.exe": { name: "Notepad", path: null, h: h(60) },
    "": { name: "", path: null, h: h(30) },
  },
};

test("a day's summary: its total, its first apps by time and the time per hour, the others past 300 counted but never named", () => {
  const s = summary(day, 3);
  assert.equal(s.total, 6090);
  assert.deepEqual(s.apps.map((a) => [a.key, a.secs]), [["code.exe", 4200], ["chrome.exe", 1200], ["spotify.exe", 600]]);
  assert.deepEqual(s.apps[0], { key: "code.exe", name: "Visual Studio Code", path: "C:\\Code.exe", secs: 4200 });
  assert.deepEqual(s.hours.slice(8, 11), [1890, 3300, 900]);
  assert.equal(s.hours.reduce((a, b) => a + b, 0), s.total);
  assert.equal(dayTotal(day), 6090);
  assert.deepEqual(hourTotals(day), s.hours);
  // No day yet: nothing, and still 24 hours.
  assert.deepEqual(summary(null), { total: 0, apps: [], hours: Array(24).fill(0) });
});

test("apps with the same time are in the order of their names", () => {
  const tie: ScreenDay = { date: "2026-11-23", apps: { b: { name: "Beta", path: null, h: h(60) }, a: { name: "Alpha", path: null, h: h(60) } } };
  assert.deepEqual(ranked(tie).map(([key]) => key), ["a", "b"]);
});

test("the average leaves out the days without time", () => {
  const of = (date: string, secs: number): ScreenDay => ({ date, apps: secs ? { a: { name: "A", path: null, h: h(secs) } } : {} });
  assert.equal(average([of("2026-11-21", 3600), of("2026-11-22", 0), of("2026-11-23", 1800)]), 2700);
  assert.equal(average([]), 0);
  // Only the last n days count.
  assert.equal(average([of("2026-11-20", 600), of("2026-11-21", 3600), of("2026-11-22", 1800)], 2), 2700);
});

test("a short duration in the language's narrow units, the minutes in two digits beside hours", () => {
  assert.equal(shortDuration(3725, "en"), "1h 02m");
  assert.equal(shortDuration(2520, "en"), "42m");
  assert.equal(shortDuration(0, "en"), "0m");
});

test("a long duration through the translations: hours and minutes, or minutes alone under the hour", () => {
  const tr = (de: string, vars?: Record<string, string | number>) => `${de}|${JSON.stringify(vars)}`;
  assert.equal(longDuration(3725, tr), '{h} Std. {m} Min.|{"h":1,"m":2}');
  assert.equal(longDuration(2520, tr), '{n} Min.|{"n":42}');
});

test("every digit an 8, for the room of the widest figure", () => {
  assert.equal(eights("3h 05m"), "8h 88m");
});

test("a date key is the local day, from its midnight to its last millisecond", () => {
  assert.equal(dateKey(new Date(2026, 10, 23).getTime()), "2026-11-23");
  assert.equal(dateKey(new Date(2026, 10, 23, 23, 59, 59, 999).getTime()), "2026-11-23");
  assert.equal(dateKey(new Date(2026, 10, 24).getTime()), "2026-11-24");
  assert.equal(daysBack("2026-11-23", 6), "2026-11-17");
  assert.equal(daysBack("2026-03-01", 1), "2026-02-28");
  assert.equal(daysBack("2026-11-23", -8), "2026-12-01");
});

test("the face's room: the hourglass and the text, then three app slots or the 71 px histogram", () => {
  assert.equal(screenFaceWidth("total", 45), 64);
  assert.equal(screenFaceWidth("apps", 45), 128);
  assert.equal(screenFaceWidth("hourly", 45), 141);
});

test("an hour's bar: a dash at zero, the full 14 at an hour, never under 1.5 or over the full height", () => {
  assert.equal(barHeight(0), 0);
  assert.equal(barHeight(3600), 14);
  assert.equal(barHeight(60), 1.5);
  assert.equal(barHeight(7200), 14);
  assert.equal(barHeight(1800, 40), 20);
});
