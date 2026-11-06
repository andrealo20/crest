import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BREAKS_DEFAULTS,
  IDLE_BREAK_SEC,
  MICRO_SEC,
  SLEEP_GAP_MS,
  SNOOZE_MIN,
  advance,
  canStart,
  dueKind,
  formatLeft,
  fresh,
  normalizeBreaks,
  secondsLeft,
  skip,
  snooze,
  start,
  suspend,
  type BreakState,
  type BreaksConfig,
} from "./breaks.ts";

const MIN = 60_000;
const SEC = 1000;
const on: BreaksConfig = { ...BREAKS_DEFAULTS, on: true }; // eye break every 20 min, long every 60, 5 min long

type Opts = { step?: number; idle?: number | null; blocked?: boolean; cfg?: BreaksConfig };

/** What the scheduler does on each poll: advance, then start a due break unless held back. Ticks from `from` to `to`, both included. */
function run(s: BreakState, from: number, to: number, { step = 15 * SEC, idle = 0, blocked = false, cfg = on }: Opts = {}): BreakState {
  for (let t = from; t <= to; t += step) s = start(advance(s, t, idle, cfg), t, cfg, blocked);
  return s;
}

test("an eye break shows after 20 minutes of work and not before", () => {
  let s = run(fresh(), 0, 20 * MIN - 15 * SEC);
  assert.equal(s.shown, null);
  s = run(s, 20 * MIN, 20 * MIN);
  assert.equal(s.shown?.kind, "micro");
  assert.equal(s.shown?.endsAt, 20 * MIN + MICRO_SEC * SEC);
});

test("an eye break ends by itself, the 20 minutes start over and the long counter keeps running", () => {
  let s = run(fresh(), 0, 20 * MIN);
  const end = s.shown!.endsAt;
  s = advance(s, end - SEC, 0, on);
  assert.equal(s.shown?.kind, "micro"); // still counting down
  s = advance(s, end, 0, on);
  assert.equal(s.shown, null);
  assert.equal(s.sinceBreak, 0);
  assert.equal(s.sinceLong, 20 * MIN);
  assert.equal(dueKind(s, on), null);
});

test("work does not add up while a break is showing", () => {
  let s = run(fresh(), 0, 20 * MIN);
  s = advance(s, 20 * MIN + 10 * SEC, 0, on);
  assert.equal(s.sinceLong, 20 * MIN);
});

test("eye breaks at 20 and 40 minutes, then the long break takes the hour's place", () => {
  const seen: string[] = [];
  let s = fresh();
  let last: unknown = null;
  for (let t = 0; t <= 62 * MIN; t += 5 * SEC) {
    s = start(advance(s, t, 0, on), t, on, false);
    if (s.shown && s.shown !== last) seen.push(s.shown.kind);
    last = s.shown;
  }
  assert.deepEqual(seen, ["micro", "micro", "long"]);
});

test("a long break lasts as long as set and starts everything over", () => {
  const cfg = { ...on, microEveryMin: 20, longEveryMin: 20, longMin: 3 };
  let s = run(fresh(), 0, 20 * MIN, { cfg });
  assert.equal(s.shown?.kind, "long"); // both due: the long one
  assert.equal(s.shown?.endsAt, 20 * MIN + 3 * MIN);
  s = advance(s, 23 * MIN, 0, cfg);
  assert.equal(s.shown, null);
  assert.equal(s.sinceBreak + s.sinceLong, 0);
});

test("the long break's suggestion moves on with each one", () => {
  const cfg = { ...on, microEveryMin: 20, longEveryMin: 20, longMin: 1 };
  let s = run(fresh(), 0, 20 * MIN, { cfg });
  const first = s.shown!.tip;
  s = advance(s, 21 * MIN, 0, cfg); // over
  s = run(s, 21 * MIN + 15 * SEC, 41 * MIN + 30 * SEC, { cfg });
  assert.equal(s.shown?.kind, "long");
  assert.equal(s.shown!.tip, first + 1);
});

test("no input for five minutes counts as a break taken", () => {
  let s = run(fresh(), 0, 15 * MIN);
  const now = 15 * MIN + 15 * SEC;
  const still = advance(s, now, IDLE_BREAK_SEC - 1, on);
  assert.equal(still.sinceBreak, 15 * MIN + 15 * SEC); // four minutes and a bit of quiet: still at work
  s = advance(s, now, IDLE_BREAK_SEC, on);
  assert.equal(s.sinceBreak, 0);
  assert.equal(s.sinceLong, 0);
  assert.equal(s.last, now);
});

test("coming back from idle ends a break that was showing and does not start another", () => {
  let s = run(fresh(), 0, 20 * MIN);
  assert.ok(s.shown);
  s = advance(s, 20 * MIN + 5 * SEC, IDLE_BREAK_SEC + 1, on);
  assert.equal(s.shown, null);
  s = start(s, 20 * MIN + 5 * SEC, on, false);
  assert.equal(s.shown, null);
});

test("a tick that did not ask for the idle time leaves it alone", () => {
  const s = run(fresh(), 0, 5 * MIN);
  const next = advance(s, 5 * MIN + 10 * SEC, null, on);
  assert.equal(next.sinceBreak, 5 * MIN + 10 * SEC);
});

test("a computer that slept counts as a break: nothing added up, no burst of reminders after waking", () => {
  const s = run(fresh(), 0, 19 * MIN);
  assert.equal(s.sinceBreak, 19 * MIN);
  const wake = 19 * MIN + 3 * 60 * MIN; // three hours later
  let after = start(advance(s, wake, 0, on), wake, on, false);
  assert.equal(after.shown, null);
  assert.equal(after.sinceBreak, 0);
  assert.equal(after.sinceLong, 0);
  // The cycle starts over from the wake-up: the first eye break is 20 minutes later, not at once.
  after = run(after, wake + 15 * SEC, wake + 19 * MIN);
  assert.equal(after.shown, null);
  after = run(after, wake + 19 * MIN + 15 * SEC, wake + 20 * MIN);
  assert.equal(after.shown?.kind, "micro");
});

test("sleep wipes what was waiting too: a break that was held back does not come after waking", () => {
  let s = run(fresh(), 0, 90 * MIN, { blocked: true });
  assert.equal(dueKind(s, on), "long");
  const wake = 90 * MIN + 10 * MIN;
  s = start(advance(s, wake, 0, on), wake, on, false);
  assert.equal(s.shown, null);
});

test("a gap of exactly two minutes is still work, a bit more is sleep", () => {
  const s = run(fresh(), 0, 5 * MIN);
  assert.equal(advance(s, 5 * MIN + SLEEP_GAP_MS, 0, on).sinceBreak, 5 * MIN + SLEEP_GAP_MS);
  assert.equal(advance(s, 5 * MIN + SLEEP_GAP_MS + 1, 0, on).sinceBreak, 0);
});

test("a clock set back adds nothing and breaks nothing", () => {
  const s = run(fresh(), 0, 5 * MIN);
  const back = advance(s, 5 * MIN - 30 * SEC, 0, on);
  assert.equal(back.sinceBreak, 5 * MIN);
  assert.equal(back.last, 5 * MIN - 30 * SEC);
});

test("snooze puts the break off for five minutes, then it comes back", () => {
  let s = run(fresh(), 0, 20 * MIN);
  s = snooze(s, 20 * MIN + 2 * SEC);
  assert.equal(s.shown, null);
  const until = 20 * MIN + 2 * SEC + SNOOZE_MIN * MIN;
  // Held back for the whole time, though it is still due.
  s = run(s, 20 * MIN + 15 * SEC, until - SEC);
  assert.equal(dueKind(s, on), "micro");
  assert.equal(s.shown, null);
  assert.equal(canStart(s, until - SEC, on), false);
  s = run(s, until, until);
  assert.equal(s.shown?.kind, "micro");
  assert.equal(s.shown?.startedAt, until);
});

test("snooze with nothing showing does nothing; so does skip", () => {
  const s = run(fresh(), 0, MIN);
  assert.equal(snooze(s, MIN), s);
  assert.equal(skip(s), s);
});

test("skipping an eye break counts as taken for it only; skipping a long break, for both", () => {
  let s = run(fresh(), 0, 20 * MIN);
  s = skip(s);
  assert.equal(s.shown, null);
  assert.equal(s.sinceBreak, 0);
  assert.equal(s.sinceLong, 20 * MIN);
  const cfg = { ...on, longEveryMin: 20 };
  s = skip(run(fresh(), 0, 20 * MIN, { cfg }));
  assert.equal(s.sinceBreak + s.sinceLong, 0);
  assert.equal(dueKind(s, cfg), null);
});

test("turning it off in the middle of a break clears everything", () => {
  let s = run(fresh(), 0, 20 * MIN);
  assert.ok(s.shown);
  s = advance(s, 20 * MIN + 5 * SEC, 0, { ...on, on: false });
  assert.equal(s.shown, null);
  assert.equal(s.snoozed, null);
  assert.equal(s.last, null);
  assert.equal(start(s, 20 * MIN + 10 * SEC, { ...on, on: false }, false).shown, null);
  assert.equal(dueKind(s, { ...on, on: false }), null);
});

test("held back by a presentation, full screen or quiet hours, the break waits and then comes once", () => {
  let s = run(fresh(), 0, 45 * MIN, { blocked: true });
  assert.equal(s.shown, null);
  assert.equal(dueKind(s, on), "micro");
  s = run(s, 45 * MIN + 15 * SEC, 45 * MIN + 15 * SEC);
  assert.equal(s.shown?.kind, "micro");
  // And only one: nothing else is queued behind it.
  const end = s.shown!.endsAt;
  s = run(s, end, end + 5 * MIN);
  assert.equal(s.shown, null);
});

test("a break that a presentation interrupts goes off the screen and stays due", () => {
  let s = run(fresh(), 0, 20 * MIN);
  assert.ok(s.shown);
  s = suspend(s);
  assert.equal(s.shown, null);
  assert.equal(dueKind(s, on), "micro");
  s = run(s, 20 * MIN + 15 * SEC, 20 * MIN + 15 * SEC);
  assert.equal(s.shown?.kind, "micro");
  assert.equal(suspend(fresh()).shown, null);
});

test("changing the intervals is read at once", () => {
  const s = run(fresh(), 0, 10 * MIN);
  assert.equal(dueKind(s, { ...on, microEveryMin: 10 }), "micro");
  assert.equal(dueKind(s, { ...on, microEveryMin: 20 }), null);
});

test("a saved config becomes a valid one", () => {
  assert.deepEqual(normalizeBreaks(undefined), BREAKS_DEFAULTS);
  assert.deepEqual(normalizeBreaks("x"), BREAKS_DEFAULTS);
  assert.deepEqual(normalizeBreaks({ on: true, microEveryMin: 15, longEveryMin: 90, longMin: 10 }), { on: true, microEveryMin: 15, longEveryMin: 90, longMin: 10 });
  const wild = normalizeBreaks({ on: "yes", microEveryMin: 0, longEveryMin: 1e9, longMin: Number.NaN });
  assert.equal(wild.on, false);
  assert.equal(wild.microEveryMin, 5);
  assert.equal(wild.longEveryMin, 240);
  assert.equal(wild.longMin, BREAKS_DEFAULTS.longMin);
});

test("the countdown rounds up and reads as minutes and seconds", () => {
  assert.equal(secondsLeft(20_000, 0), 20);
  assert.equal(secondsLeft(20_000, 100), 20);
  assert.equal(secondsLeft(20_000, 19_001), 1);
  assert.equal(secondsLeft(20_000, 25_000), 0);
  assert.equal(formatLeft(20), "0:20");
  assert.equal(formatLeft(300), "5:00");
  assert.equal(formatLeft(725), "12:05");
});
