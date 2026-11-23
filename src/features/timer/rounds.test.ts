import { test } from "node:test";
import assert from "node:assert/strict";
import { freshRounds, logRound, roundSpans, roundsOf, roundsWanted, runningSpan, type FocusRound } from "./rounds.ts";

const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 23, 12);

test("a finished round is added once, rounds past 30 days go, and 400 at most stay", () => {
  const one = { end: now - 60_000, secs: 1500 };
  assert.deepEqual(logRound([], one, now), [one]);
  assert.deepEqual(logRound([one], { ...one }, now), [one]);
  const old = { end: now - 31 * DAY, secs: 1500 };
  assert.deepEqual(logRound([old], one, now), [one]);
  // Also without a new round: at the notch's start, so turning the timeline off keeps them 30 days, no longer.
  assert.deepEqual(freshRounds([old, one], now), [one]);
  const many: FocusRound[] = Array.from({ length: 400 }, (_, i) => ({ end: now - (400 - i) * 3_600_000, secs: 1500 }));
  const after = logRound(many, one, now);
  assert.equal(after.length, 400);
  assert.deepEqual(after.at(-1), one);
  assert.equal(after[0].end, many[1].end);
});

test("what another window or a backup saved becomes a list of rounds, the rest dropped", () => {
  const ok = { end: now, secs: 1500 };
  assert.deepEqual(roundsOf([ok, null, "x", { end: now, secs: 0 }, { end: now, secs: 90_000 }, { end: "now", secs: 60 }, { end: now, secs: 300, extra: 1 }]), [ok, { end: now, secs: 300 }]);
  assert.deepEqual(roundsOf("[]"), []);
  assert.deepEqual(roundsOf(null), []);
});

test("a round's span runs from its end less its length to its end, and only those touching the window come", () => {
  const list = [{ end: now, secs: 1500 }, { end: now - DAY, secs: 1500 }];
  assert.deepEqual(roundSpans(list, now - 3_600_000, now + 1), [[now - 1_500_000, now]]);
  assert.deepEqual(roundSpans(list, now, now + 1), []);
});

test("rounds are kept only while Screen Time records or the Day timeline is on the bar or in the closed row (decision W2)", () => {
  const s = (on: boolean, part: boolean, zones: Record<string, string[]>) => ({ screenTime: { on }, closed: { parts: { timeline: part } }, taskbar: { zones } });
  const empty = { left: [], center: [], right: ["clock"] };
  assert.equal(roundsWanted(s(false, false, empty)), false);
  assert.equal(roundsWanted(s(true, false, empty)), true);
  assert.equal(roundsWanted(s(false, true, empty)), true);
  assert.equal(roundsWanted(s(false, false, { ...empty, center: ["timeline"] })), true);
});

test("the round running now runs from its start to now; a paused timer or a break draws none", () => {
  const t = { mode: "focus", endsAt: now + 600_000, duration: 1500 };
  assert.deepEqual(runningSpan(t, now), [now - 900_000, now]);
  assert.equal(runningSpan({ ...t, endsAt: null }, now), null);
  assert.equal(runningSpan({ ...t, mode: "break" }, now), null);
});
