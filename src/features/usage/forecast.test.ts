import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_AGE_MS, MIN_ELAPSED, dayGap, freshReading, pace, type PaceWindow } from "./forecast.ts";
import { USAGE_CARDS_DEFAULTS, normalizeCards } from "./cards.ts";

const MIN = 60_000, HOUR = 3_600_000;
// A 5 hour window from 0 to 5 h; `readAt` and `now` are given in hours after its start.
const LEN = 5 * HOUR;
const win = (used: number, over: Partial<PaceWindow> = {}): PaceWindow => ({ usedPercent: used, resetsAt: LEN, windowSecs: 5 * 3600, ...over });
const at = (hours: number) => hours * HOUR;
const same = (hours: number, used: number, over: Partial<PaceWindow> = {}) => pace(win(used, over), at(hours), at(hours));

/** Runs `fn` with the process time zone set to `tz`, then puts the old one back. */
function inZone<T>(tz: string, fn: () => T): T {
  const old = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (old === undefined) delete process.env.TZ;
    else process.env.TZ = old;
  }
}
const ZONES = ["UTC", "America/New_York", "Europe/London", "Asia/Kolkata", "Pacific/Auckland", "America/St_Johns", "Pacific/Kiritimati"];

test("a window half way: the rate so far goes on to the reset", () => {
  assert.deepEqual(same(2.5, 40), { kind: "reset", percent: 80 });
  assert.deepEqual(same(2.5, 25), { kind: "reset", percent: 50 });
  assert.deepEqual(same(4, 20), { kind: "reset", percent: 25 });
  // Exactly on the limit at the reset is still "on pace", not an alarm.
  assert.deepEqual(same(2.5, 50), { kind: "reset", percent: 100 });
});

test("a pace over 100 % names the time the limit is reached", () => {
  // 60 % after 2.5 h: 100 % after 2.5 * 100 / 60 = 4 h 10 min.
  assert.deepEqual(same(2.5, 60), { kind: "limit", at: at(2.5) * (100 / 60) });
  assert.deepEqual(same(2.5, 60), { kind: "limit", at: 4 * HOUR + 10 * MIN });
  // The time is before the reset, and later than the reading.
  for (const [h, used] of [[1, 30], [2, 70], [3, 99], [4.5, 95], [0.6, 13]] as const) {
    const p = same(h, used);
    assert.equal(p?.kind, "limit", `${h} h, ${used} %`);
    if (p?.kind === "limit") assert.ok(p.at > at(h) && p.at < LEN, `${h} h, ${used} %: ${p.at}`);
  }
});

test("the edge between on pace and over is at 100.5 % rounded", () => {
  // 40.2 % after 2 h of 5: 100.5 %, which rounds to 101, so it is over.
  assert.equal(same(2, 40.2)?.kind, "limit");
  // 40.19 % : 100.475 %, rounds to 100.
  assert.deepEqual(same(2, 40.19), { kind: "reset", percent: 100 });
  // Never more than 100 on the quiet line.
  for (let used = 1; used < 100; used += 0.7) {
    const p = same(3, used);
    if (p?.kind === "reset") assert.ok(p.percent >= 1 && p.percent <= 100, `${used}`);
  }
});

test("a limit already reached has nothing to forecast", () => {
  assert.equal(same(2.5, 100), null);
  assert.equal(same(2.5, 100.0001), null);
  assert.equal(same(2.5, 140), null);
  assert.equal(same(4.9, Number.MAX_VALUE), null);
});

test("nothing used, or less than a percent at the end, says nothing", () => {
  assert.equal(same(3, 0), null);
  assert.equal(same(3, -5), null);
  assert.equal(same(3, -0), null);
  // 0.2 % after 2.5 h of 5 is 0.4 % at the reset, which rounds to 0.
  assert.equal(same(2.5, 0.2), null);
  assert.deepEqual(same(2.5, 0.4), { kind: "reset", percent: 1 });
});

test("a window that has barely begun is noise", () => {
  assert.equal(MIN_ELAPSED, 0.1);
  assert.equal(same(0.49, 5), null);
  assert.equal(same(0, 5), null);
  assert.equal(same(0.4999, 50), null);
  // 10 % of the window exactly is enough.
  assert.deepEqual(same(0.5, 5), { kind: "reset", percent: 50 });
  assert.deepEqual(same(0.5, 20)?.kind, "limit");
  // A reading from before the window started (a reset farther away than the window is long).
  assert.equal(same(-1, 10), null);
  assert.equal(pace(win(10, { resetsAt: LEN + HOUR }), at(0.2), at(0.2)), null);
});

test("division by zero and impossible lengths", () => {
  assert.equal(same(2, 40, { windowSecs: 0 }), null);
  assert.equal(same(2, 40, { windowSecs: -5 }), null);
  // A zero-length window has its start at the reset: the reading cannot be inside it.
  assert.equal(pace(win(40, { windowSecs: 0, resetsAt: at(2) }), at(2), at(2)), null);
  assert.equal(pace(win(40, { windowSecs: 0, resetsAt: at(2) }), at(2), at(1)), null);
});

test("missing numbers", () => {
  assert.equal(same(2, 40, { resetsAt: null }), null);
  assert.equal(same(2, 40, { windowSecs: null }), null);
  assert.equal(pace(win(40), undefined as never, at(2)), null);
  assert.equal(pace({ usedPercent: undefined as never, resetsAt: LEN, windowSecs: 18_000 }, at(2), at(2)), null);
  assert.equal(pace({ usedPercent: "40" as never, resetsAt: LEN, windowSecs: 18_000 }, at(2), at(2)), null);
  assert.equal(pace({ usedPercent: null as never, resetsAt: LEN, windowSecs: 18_000 }, at(2), at(2)), null);
});

test("numbers that are not finite", () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(same(2, bad), null, `used ${bad}`);
    assert.equal(same(2, 40, { resetsAt: bad }), null, `resetsAt ${bad}`);
    assert.equal(same(2, 40, { windowSecs: bad }), null, `windowSecs ${bad}`);
    assert.equal(pace(win(40), bad, at(2)), null, `readAt ${bad}`);
    assert.equal(pace(win(40), at(2), bad), null, `now ${bad}`);
  }
});

test("a reset in the past: the numbers belong to the window before", () => {
  assert.equal(pace(win(80), at(4), LEN), null);
  assert.equal(pace(win(80), at(4), LEN + 1), null);
  assert.equal(pace(win(80), at(4), LEN + 10 * HOUR), null);
  // The reading is also after its reset time.
  assert.equal(pace(win(80), LEN + MIN, LEN + MIN), null);
  // One millisecond before the reset is still this window.
  assert.notEqual(pace(win(80), LEN - 1, LEN - 1), null);
});

test("an old reading gets no forecast", () => {
  const w = win(40);
  assert.deepEqual(pace(w, at(2.5) - MAX_AGE_MS, at(2.5)), { kind: "reset", percent: Math.round((40 * LEN) / (at(2.5) - MAX_AGE_MS)) });
  assert.equal(pace(w, at(2.5) - MAX_AGE_MS - 1, at(2.5)), null);
  assert.equal(pace(w, at(1), at(3)), null);
});

test("the rate is that of the moment of the reading, not of now", () => {
  // 40 % at 2.5 h, read 10 minutes ago: still 80 %, not 40 % over 2 h 40 min.
  assert.deepEqual(pace(win(40), at(2.5), at(2.5) + 10 * MIN), { kind: "reset", percent: 80 });
  // The limit at 4 h 10 min is still ahead.
  assert.deepEqual(pace(win(60), at(2.5), at(2.5) + 10 * MIN), { kind: "limit", at: 4 * HOUR + 10 * MIN });
});

test("a limit time that is already past means the reading is behind", () => {
  // A window of 100 minutes: 99 % at 4_000_000 ms is 100 % at about 4_040_404 ms.
  const w: PaceWindow = { usedPercent: 99, resetsAt: 6_000_000, windowSecs: 6000 };
  const p = pace(w, 4_000_000, 4_030_000);
  assert.equal(p?.kind, "limit");
  assert.equal(pace(w, 4_000_000, 4_041_000), null);
  assert.equal(pace(w, 4_000_000, 4_500_000), null);
});

test("a reading dated in the future counts as taken now", () => {
  assert.deepEqual(pace(win(40), at(2.5) + 5 * MIN, at(2.5)), { kind: "reset", percent: 80 });
  assert.deepEqual(pace(win(40), Number.MAX_SAFE_INTEGER, at(2.5)), { kind: "reset", percent: 80 });
});

test("real window lengths", () => {
  const week = 7 * 24 * HOUR;
  // Day 3.5 of a week at 45 %: 90 %.
  assert.deepEqual(pace({ usedPercent: 45, resetsAt: week, windowSecs: 7 * 86_400 }, 3.5 * 24 * HOUR, 3.5 * 24 * HOUR), { kind: "reset", percent: 90 });
  // Day 2 at 50 %: 175 %, the limit after 4 days.
  const p = pace({ usedPercent: 50, resetsAt: week, windowSecs: 7 * 86_400 }, 2 * 24 * HOUR, 2 * 24 * HOUR);
  assert.deepEqual(p, { kind: "limit", at: 4 * 24 * HOUR });
  // Thirty days, a calendar month in practice: the same arithmetic.
  assert.deepEqual(pace({ usedPercent: 93, resetsAt: 30 * 24 * HOUR, windowSecs: 30 * 86_400 }, 19 * 24 * HOUR, 19 * 24 * HOUR)?.kind, "limit");
});

test("epoch times in, epoch times out: the zone changes nothing", () => {
  const base = Date.UTC(2026, 2, 8, 6, 30); // around the US daylight saving start
  const w: PaceWindow = { usedPercent: 60, resetsAt: base + 2.5 * HOUR, windowSecs: 5 * 3600 };
  const results = ZONES.map((tz) => inZone(tz, () => JSON.stringify(pace(w, base, base))));
  assert.equal(new Set(results).size, 1, results.join(" | "));
  assert.equal(JSON.parse(results[0]).kind, "limit");
});

test("a card kept from an old reading is not fresh, a 429 pause is", () => {
  for (const ok of [null, undefined, "", "rate-limited"]) assert.equal(freshReading(ok), true, String(ok));
  for (const bad of ["offline", "expired", "claude-expired", "failed", "not-found", "bad-key", "no-key", "not-signed-in"]) assert.equal(freshReading(bad), false, bad);
});

test("days between dates are calendar days, in every zone", () => {
  for (const tz of ZONES) {
    inZone(tz, () => {
      // Local constructors: a date and a time of day in this zone.
      const d = (y: number, m: number, day: number, h = 0, min = 0) => new Date(y, m, day, h, min).getTime();
      assert.equal(dayGap(d(2026, 5, 10, 16, 40), d(2026, 5, 10, 9, 0)), 0, tz);
      assert.equal(dayGap(d(2026, 5, 10, 23, 59), d(2026, 5, 10, 0, 1)), 0, tz);
      // Two minutes apart, across midnight.
      assert.equal(dayGap(d(2026, 5, 11, 0, 1), d(2026, 5, 10, 23, 59)), 1, tz);
      assert.equal(dayGap(d(2026, 5, 13, 8, 0), d(2026, 5, 10, 22, 0)), 3, tz);
      assert.equal(dayGap(d(2026, 5, 17, 8, 0), d(2026, 5, 10, 22, 0)), 7, tz);
      // Month and year ends.
      assert.equal(dayGap(d(2026, 6, 1, 1, 0), d(2026, 5, 30, 23, 0)), 1, tz);
      assert.equal(dayGap(d(2026, 6, 2, 1, 0), d(2026, 5, 30, 23, 0)), 2, tz);
      assert.equal(dayGap(d(2027, 0, 1, 0, 30), d(2026, 11, 31, 23, 30)), 1, tz);
      assert.equal(dayGap(d(2028, 1, 29, 12, 0), d(2028, 1, 28, 12, 0)), 1, tz);
      // The past comes out negative.
      assert.equal(dayGap(d(2026, 5, 9, 12, 0), d(2026, 5, 10, 12, 0)), -1, tz);
    });
  }
});

test("a daylight saving change does not move the day", () => {
  // New York: 8 March 2026 has 23 hours, 1 November 2026 has 25.
  inZone("America/New_York", () => {
    const d = (m: number, day: number, h: number, min = 0) => new Date(2026, m, day, h, min).getTime();
    assert.equal((d(2, 9, 0, 30) - d(2, 8, 0, 30)) / HOUR, 23);
    assert.equal(dayGap(d(2, 9, 0, 30), d(2, 8, 0, 30)), 1);
    assert.equal(dayGap(d(2, 9, 23, 0), d(2, 8, 1, 0)), 1);
    assert.equal(dayGap(d(2, 8, 23, 30), d(2, 8, 0, 10)), 0);
    assert.equal((d(10, 2, 0, 30) - d(10, 1, 0, 30)) / HOUR, 25);
    assert.equal(dayGap(d(10, 2, 0, 30), d(10, 1, 0, 30)), 1);
    assert.equal(dayGap(d(10, 1, 23, 30), d(10, 1, 0, 30)), 0);
    assert.equal(dayGap(d(10, 8, 0, 30), d(10, 1, 23, 30)), 7);
  });
  // London: 29 March 2026 has 23 hours.
  inZone("Europe/London", () => {
    const d = (m: number, day: number, h: number) => new Date(2026, m, day, h, 0).getTime();
    assert.equal(dayGap(d(2, 30, 0), d(2, 29, 0)), 1);
  });
});

test("the same two instants are on different days in different zones", () => {
  const now = Date.UTC(2026, 5, 10, 11, 0), later = Date.UTC(2026, 5, 10, 13, 0);
  const gap = (tz: string) => inZone(tz, () => dayGap(later, now));
  assert.equal(gap("UTC"), 0);
  assert.equal(gap("America/New_York"), 0);
  assert.equal(gap("Asia/Kolkata"), 0);
  // 23:00 on the 10th and 01:00 on the 11th.
  assert.equal(gap("Pacific/Auckland"), 1);
  // UTC+14: 01:00 and 03:00 on the 11th.
  assert.equal(gap("Pacific/Kiritimati"), 0);
  // UTC-3:30 in June (Newfoundland, summer time): 10:30 and 08:30, the same day.
  assert.equal(gap("America/St_Johns"), 0);
  assert.equal(inZone("Pacific/Auckland", () => dayGap(now, later)), -1);
});

test("dates that are not dates", () => {
  assert.ok(Number.isNaN(dayGap(NaN, Date.now())));
  assert.ok(Number.isNaN(dayGap(Date.now(), NaN)));
});

test("settings: the pace line is on and the reset notice off, also for saved data of any shape", () => {
  assert.equal(USAGE_CARDS_DEFAULTS.forecast, true);
  assert.equal(USAGE_CARDS_DEFAULTS.notifyReset, false);
  assert.deepEqual([normalizeCards(undefined).forecast, normalizeCards(undefined).notifyReset], [true, false]);
  assert.deepEqual([normalizeCards(null).forecast, normalizeCards(null).notifyReset], [true, false]);
  // Saved by an earlier version: neither field.
  assert.deepEqual([normalizeCards({ order: ["claude"] }).forecast, normalizeCards({ order: ["claude"] }).notifyReset], [true, false]);
  const off = normalizeCards({ forecast: false, notifyReset: true });
  assert.deepEqual([off.forecast, off.notifyReset], [false, true]);
  // Only a real false turns the line off, only a real true turns the notice on.
  const odd = normalizeCards({ forecast: "no" as never, notifyReset: "yes" as never });
  assert.deepEqual([odd.forecast, odd.notifyReset], [true, false]);
  const nul = normalizeCards({ forecast: null as never, notifyReset: 1 as never });
  assert.deepEqual([nul.forecast, nul.notifyReset], [true, false]);
});
