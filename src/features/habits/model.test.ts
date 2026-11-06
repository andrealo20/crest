import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_DAYS, KEEP_DAYS, MAX_HABITS, NAME_MAX, SHOWN_DAYS, dayOf, dots, followWater, isActive, normalizeHabits, pruneDone, streaks, weekday, withDay, type Habit } from "./model.ts";

const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const T = dayOf(local(2026, 11, 6)); // a Friday
const habit = (p: Partial<Habit> = {}): Habit => ({ id: "h", name: "Read", hue: "blue", days: ALL_DAYS, since: T - 60, done: [], ...p });
/** Ticks on today minus each offset. */
const ticks = (...back: number[]) => back.map((b) => T - b);
const run = (p: Partial<Habit>, today = T) => streaks(habit(p), today);

test("a day is the local date as a number; weekdays follow it", () => {
  assert.equal(dayOf(local(2026, 11, 7)) - T, 1);
  assert.equal(dayOf(local(2026, 11, 6, 0, 0)), dayOf(local(2026, 11, 6, 23, 59)));
  assert.equal(weekday(T), 5);
  assert.equal(weekday(T + 2), 0);
  assert.equal(weekday(dayOf(local(1970, 1, 1))), 4);
});

test("a plain run counts the ticked days, today included", () => {
  assert.deepEqual(run({ done: ticks(0, 1, 2, 3, 4) }), { current: 5, best: 5 });
  assert.deepEqual(run({ done: [] }), { current: 0, best: 0 });
});

test("today not ticked yet is open: it neither breaks nor adds", () => {
  assert.deepEqual(run({ done: ticks(1, 2, 3, 4, 5) }), { current: 5, best: 5 });
  assert.deepEqual(run({ done: ticks(0, 1, 2, 3, 4, 5) }), { current: 6, best: 6 });
});

test("one missed day is forgiven and adds nothing", () => {
  // Misses on T-3 only.
  assert.deepEqual(run({ since: T - 6, done: ticks(0, 1, 2, 4, 5, 6) }), { current: 6, best: 6 });
  // Yesterday missed, today not ticked yet: the streak before it stays.
  assert.deepEqual(run({ since: T - 5, done: ticks(2, 3, 4, 5) }), { current: 4, best: 4 });
});

test("two misses in a week are both forgiven, a third within the week breaks", () => {
  // Misses T-5 and T-2: the second has one other miss in the 7 days before it.
  assert.deepEqual(run({ since: T - 8, done: ticks(0, 1, 3, 4, 6, 7, 8) }), { current: 7, best: 7 });
  // Misses T-6, T-4, T-2: the third has two others before it, so the run restarts after it.
  assert.deepEqual(run({ since: T - 8, done: ticks(0, 1, 3, 5, 7, 8) }), { current: 2, best: 4 });
});

test("the window is the 7 days before the miss, counted from either end", () => {
  const x = T - 20;
  const missesAt = (...gaps: number[]) => {
    const misses = new Set(gaps.reduce<number[]>((acc, g) => [...acc, acc[acc.length - 1] + g], [x]));
    return Array.from({ length: 21 }, (_, i) => x + i).filter((d) => !misses.has(d) && d < T);
  };
  // x, x+3, x+8: the first is 8 days before the third, outside its window, so nothing breaks.
  assert.equal(run({ since: x, done: [...missesAt(3, 5), T] }).current, 20 - 3 + 1);
  // x, x+3, x+7: now x is exactly 7 days before, inside the window: it breaks at x+7.
  const after = x + 7;
  assert.equal(run({ since: x, done: [...missesAt(3, 4), T] }).current, T - after);
});

test("a long gap ends the streak; one tick after it starts a new one", () => {
  assert.deepEqual(run({ since: T - 30, done: [] }), { current: 0, best: 0 });
  assert.deepEqual(run({ since: T - 30, done: ticks(0) }), { current: 1, best: 1 });
  assert.deepEqual(run({ since: T - 30, done: [...ticks(25, 24, 23, 22), T] }), { current: 1, best: 4 });
});

test("days off do not count: not as misses, not as ticks", () => {
  const days = [1, 3, 5]; // Monday, Wednesday, Friday
  const since = T - 13;
  const own = Array.from({ length: 14 }, (_, i) => since + i).filter((d) => days.includes(weekday(d)));
  assert.equal(own.length, 6);
  assert.deepEqual(run({ days, since, done: own }), { current: 6, best: 6 });
  // A tick on a day off (Thursday) changes nothing.
  assert.deepEqual(run({ days, since, done: [...own, T - 1] }), { current: 6, best: 6 });
  // Skipping the days off between ticks is no miss: with one own day missed it is still forgiven.
  assert.deepEqual(run({ days, since, done: own.slice(1) }), { current: 5, best: 5 });
  // Four own days missed within a week (Wed, Fri, Mon, Wed) break it; only the last tick counts.
  assert.equal(run({ days, since, done: [own[5], own[0]] }).current, 1);
});

test("a habit created today starts at zero and has nothing to miss", () => {
  assert.deepEqual(run({ since: T }), { current: 0, best: 0 });
  assert.deepEqual(run({ since: T, done: [T] }), { current: 1, best: 1 });
  // Days before it began are not misses.
  assert.deepEqual(run({ since: T - 2, done: ticks(0, 1) }), { current: 2, best: 2 });
  const d = dots(habit({ since: T }), T);
  assert.equal(d.length, SHOWN_DAYS);
  assert.deepEqual(d.map((x) => x.state).slice(-2), ["off", "open"]);
  assert.ok(d.slice(0, -1).every((x) => x.state === "off"));
  // Created on a day it is not active on: nothing to tick today either.
  assert.equal(isActive(habit({ since: T, days: [1] }), T, T), false);
});

test("the dots: five weeks ending today", () => {
  const h = habit({ since: T - 3, days: ALL_DAYS, done: ticks(0, 2) });
  const d = dots(h, T);
  assert.equal(d[d.length - 1].day, T);
  assert.equal(d[0].day, T - SHOWN_DAYS + 1);
  assert.deepEqual(d.slice(-4).map((x) => x.state), ["missed", "done", "missed", "done"]);
  assert.equal(d.filter((x) => x.state === "off").length, SHOWN_DAYS - 4);
  assert.equal(dots(habit({ since: T - 3, done: ticks(1) }), T).at(-1)!.state, "open");
});

test("the history kept is two years: older ticks are pruned, older days do not count", () => {
  assert.deepEqual(pruneDone([T - KEEP_DAYS, T - KEEP_DAYS + 1, T], T), [T - KEEP_DAYS + 1, T]);
  // A habit from long ago still works and only its kept years count.
  assert.deepEqual(run({ since: T - 1000, done: ticks(0, 1, 2, 3, 4) }), { current: 5, best: 5 });
  assert.equal(run({ since: T - 1000, done: Array.from({ length: 900 }, (_, i) => T - i) }).best, KEEP_DAYS);
});

test("ticking: a day is added once and can be taken back", () => {
  assert.deepEqual(withDay([1, 2], 3, true), [1, 2, 3]);
  assert.deepEqual(withDay([1, 2, 3], 3, true), [1, 2, 3]);
  assert.deepEqual(withDay([1, 2, 3], 3, false), [1, 2]);
});

test("DST: every local day is one day, however long, and ticks near midnight stay on their date", () => {
  const orig = process.env.TZ;
  try {
    // Spring forward and fall back, a half-hour change, and a zone ahead of UTC.
    const changes: [string, number, number][] = [
      ["Europe/London", 3, 29], ["Europe/London", 10, 25], ["Europe/Rome", 3, 29], ["America/New_York", 3, 8], ["America/New_York", 11, 1],
      ["Australia/Lord_Howe", 4, 5], ["Australia/Lord_Howe", 10, 4], ["Pacific/Auckland", 4, 5], ["Asia/Kolkata", 3, 29],
    ];
    for (const [tz, month, date] of changes) {
      process.env.TZ = tz;
      const first = dayOf(local(2026, month, date - 1, 12));
      const stamps = [[0, 30], [1, 30], [2, 30], [12, 0], [23, 30]].map(([h, m]) => dayOf(local(2026, month, date, h, m)));
      assert.ok(stamps.every((s) => s === first + 1), `${tz} ${month}/${date}: ${stamps} vs ${first + 1}`);
      assert.equal(dayOf(local(2026, month, date + 1, 0, 30)), first + 2, tz);
      // The same week gives the same streak in every zone.
      const today = dayOf(local(2026, month, date + 2));
      const h = habit({ since: today - 8, done: [today, today - 1, today - 2, today - 4, today - 5, today - 7, today - 8] }); // misses at -3 and -6
      assert.deepEqual(streaks(h, today), { current: 7, best: 7 }, tz);
    }
  } finally {
    if (orig === undefined) delete process.env.TZ;
    else process.env.TZ = orig;
  }
});

test("a new time zone keeps old ticks and turns the same moment into the local day", () => {
  const orig = process.env.TZ;
  try {
    const moment = Date.UTC(2026, 10, 6, 22, 30); // Friday evening UTC
    process.env.TZ = "Europe/Rome";
    const ticked = dayOf(moment); // 6 Nov, 23:30 local: ticked on the 6th
    assert.equal(ticked, T);
    const h = habit({ since: T - 3, done: [T - 2, T - 1, ticked] });
    // The same moment in Auckland is already the 7th: the tick of the 6th is yesterday's, today is open.
    process.env.TZ = "Pacific/Auckland";
    const nowThere = dayOf(moment);
    assert.equal(nowThere, T + 1);
    assert.deepEqual(streaks(h, nowThere), { current: 3, best: 3 });
    assert.equal(dots(h, nowThere).at(-2)!.state, "done");
    assert.equal(dots(h, nowThere).at(-1)!.state, "open");
    // Flying back west, the date moves back: a tick made on the 7th is ahead of today, and ignored until then.
    process.env.TZ = "America/Los_Angeles";
    const ahead = habit({ since: T + 1, done: [T + 1] });
    assert.equal(dayOf(moment), T);
    assert.deepEqual(streaks(ahead, T), { current: 0, best: 0 });
    assert.equal(isActive(ahead, T, T), true, "today can still be ticked");
    assert.equal(dots(ahead, T).at(-1)!.state, "open");
    // Its two earlier days still count.
    assert.deepEqual(streaks(habit({ since: T - 3, done: [T - 2, T - 1, T + 1] }), T), { current: 2, best: 2 });
  } finally {
    if (orig === undefined) delete process.env.TZ;
    else process.env.TZ = orig;
  }
});

test("Water: today follows the goal, past days and other habits stay", () => {
  const manual = habit({ id: "m", done: [T - 1] });
  const linked = habit({ id: "w", water: true, done: [T - 1] });
  const list = [manual, linked];
  const on = followWater(list, T, true);
  assert.deepEqual(on[1].done, [T - 1, T]);
  assert.equal(on[0], manual, "other habits are the same object");
  const off = followWater(on, T, false);
  assert.deepEqual(off[1].done, [T - 1]);
  assert.equal(followWater(list, T, false), list, "nothing to change returns the same list");
  assert.equal(followWater(on, T, true), on);
});

test("saved data is repaired", () => {
  assert.deepEqual(normalizeHabits(null, T), { habits: [] });
  assert.deepEqual(normalizeHabits({ habits: "x" }, T), { habits: [] });
  const saved = {
    habits: [
      { id: "a", name: `  ${"x".repeat(60)}  `, hue: "chartreuse", days: [], since: "no", done: [T, T, T - 1, "x", 1.5, T - KEEP_DAYS - 5], water: "yes" },
      { id: "a", name: "duplicate", hue: "red", days: [1], since: T, done: [] },
      { id: "", name: "no id" },
      { id: "b", name: "   " },
      null,
      { id: "c", name: "Run", hue: "green", days: [3, 1, 3, 9], since: T - 4, done: [T - 1], water: true },
    ],
  };
  const { habits } = normalizeHabits(saved, T);
  assert.deepEqual(habits.map((h) => h.id), ["a", "c"]);
  assert.equal(habits[0].name, "x".repeat(NAME_MAX));
  assert.equal(habits[0].hue, "blue");
  assert.deepEqual(habits[0].days, ALL_DAYS);
  assert.equal(habits[0].since, T);
  assert.deepEqual(habits[0].done, [T - 1, T]);
  assert.equal(habits[0].water, undefined);
  assert.deepEqual(habits[1].days, [1, 3]);
  assert.equal(habits[1].water, true);
  const many = { habits: Array.from({ length: 30 }, (_, i) => ({ id: `h${i}`, name: `H${i}` })) };
  assert.equal(normalizeHabits(many, T).habits.length, MAX_HABITS);
});

test("a weekly habit loses its streak when it is missed week after week", () => {
  const days = [weekday(T)]; // the same weekday as today, once a week
  const since = T - 7 * 20;
  // Ticked on its first day, then missed every week until today: the third miss within seven own days breaks it.
  assert.equal(run({ days, since, done: [since] }).current, 0);
  // Two misses in a row are forgiven, as for a daily habit.
  assert.equal(run({ days, since: T - 21, done: [T - 21] }).current, 1);
});
