import { test } from "node:test";
import assert from "node:assert/strict";
import type { UsageId, UsageProvider, UsageWindow } from "../../platform/services";
import { MAX_GAP_MS, SKEW_MS, detectReset, newResetTracker, resetAlertAllowed } from "./reset.ts";
import { detectRise, newQuotaTracker } from "../../notch/row/notices.ts";

const MIN = 60_000, HOUR = 3_600_000;
const T = Date.UTC(2026, 10, 6, 14, 0); // a reset time
const w = (kind: string, used: number, resetsAt: number | null): UsageWindow => ({ kind, usedPercent: used, resetsAt, windowSecs: 5 * 3600 });
const prov = (id: UsageId, windows: UsageWindow[], error: string | null = null): UsageProvider => ({ id, plan: null, windows, error, updatedAt: 0 });
const claude = (used: number, resetsAt: number | null, kind = "session") => [prov("claude", [w(kind, used, resetsAt)])];

test("the first answer only records", () => {
  const t = newResetTracker();
  assert.equal(detectReset(t, claude(2, T + 5 * HOUR), T + MIN), null);
  assert.equal(t.size, 1);
});

test("a window that stood high and whose reset time has come, now low", () => {
  const t = newResetTracker();
  detectReset(t, claude(96, T), T - 3 * MIN);
  assert.deepEqual(detectReset(t, claude(3, T + 5 * HOUR), T + MIN), { provider: "claude", kind: "session", used: 3, resetsAt: T + 5 * HOUR, reset: true });
  // The next answer is the same window: nothing again.
  assert.equal(detectReset(t, claude(4, T + 5 * HOUR), T + 2 * MIN), null);
});

test("the reading right after, with no reset time (an idle window)", () => {
  const t = newResetTracker();
  detectReset(t, claude(100, T), T - 5 * MIN);
  assert.deepEqual(detectReset(t, claude(0, null), T + MIN), { provider: "claude", kind: "session", used: 0, resetsAt: null, reset: true });
});

test("a drop before the reset time is not a reset", () => {
  const t = newResetTracker();
  detectReset(t, claude(96, T), T - 3 * HOUR);
  // The limit was raised, or the answer glitched: same reset time, much lower.
  assert.equal(detectReset(t, claude(10, T), T - 2 * HOUR), null);
});

test("the reading may come a little early against the reset time", () => {
  assert.equal(SKEW_MS, 2 * MIN);
  const early = (ms: number) => {
    const t = newResetTracker();
    detectReset(t, claude(90, T), T - 5 * MIN - 1);
    return detectReset(t, claude(5, T + 5 * HOUR), T - ms);
  };
  assert.notEqual(early(SKEW_MS), null);
  assert.equal(early(SKEW_MS + 1), null);
});

test("only a window that stood at the warning level counts", () => {
  const run = (before: number) => {
    const t = newResetTracker();
    detectReset(t, claude(before, T), T - MIN);
    return detectReset(t, claude(0, T + 5 * HOUR), T + MIN);
  };
  assert.equal(run(69.9), null);
  assert.equal(run(0), null);
  assert.notEqual(run(70), null);
  assert.notEqual(run(100), null);
});

test("the new reading has to be half of the old one or less", () => {
  const run = (after: number) => {
    const t = newResetTracker();
    detectReset(t, claude(90, T), T - MIN);
    return detectReset(t, claude(after, T + 5 * HOUR), T + MIN);
  };
  assert.notEqual(run(45), null);
  assert.equal(run(45.1), null);
  assert.equal(run(80), null);
  assert.equal(run(90), null);
  assert.equal(run(100), null);
});

test("no reset time known: a big drop alone counts, a small one does not", () => {
  const run = (after: number) => {
    const t = newResetTracker();
    detectReset(t, claude(95, null), 0);
    return detectReset(t, claude(after, null), MIN);
  };
  assert.notEqual(run(5), null);
  assert.equal(run(60), null);
});

test("a long gap between answers is no news", () => {
  assert.equal(MAX_GAP_MS, 10 * MIN);
  // `gap` is the time from the first answer to the reset time; the second answer comes a minute after it.
  const run = (gap: number) => {
    const t = newResetTracker();
    detectReset(t, claude(95, T), T - gap);
    return detectReset(t, claude(1, T + 5 * HOUR), T + MIN);
  };
  assert.notEqual(run(5 * MIN), null);
  assert.notEqual(run(MAX_GAP_MS - MIN), null);
  assert.equal(run(MAX_GAP_MS + 2 * MIN), null);
  assert.equal(run(3 * HOUR), null);
  // After the gap the record is current again.
  const t = newResetTracker();
  detectReset(t, claude(95, T), T - 3 * HOUR);
  assert.equal(detectReset(t, claude(1, T + 5 * HOUR), T + MIN), null);
  assert.equal(t.get("claude:session")?.used, 1);
});

test("a card kept from an old reading is skipped and leaves the record alone", () => {
  const t = newResetTracker();
  detectReset(t, claude(95, T), T - 3 * MIN);
  const kept = [prov("claude", [w("session", 1, T + 5 * HOUR)], "offline")];
  assert.equal(detectReset(t, kept, T + MIN), null);
  assert.equal(t.get("claude:session")?.used, 95);
  // The real answer that follows is the reset.
  assert.equal(detectReset(t, claude(1, T + 5 * HOUR), T + 2 * MIN)?.reset, true);
  // A provider with no windows at all (an error before any data) changes nothing.
  assert.equal(detectReset(t, [prov("codex", [], "not-found")], T + 3 * MIN), null);
});

test("a window left out of the answer once it has reset", () => {
  const two = (session: number | null, resetsAt = T) => [prov("claude", [...(session === null ? [] : [w("session", session, resetsAt)]), w("weekly", 20, T + 3 * 24 * HOUR)])];
  const t = newResetTracker();
  detectReset(t, two(97), T - 2 * MIN);
  assert.deepEqual(detectReset(t, two(null), T + MIN), { provider: "claude", kind: "session", used: 0, resetsAt: null, reset: true });
  assert.equal(t.has("claude:session"), false);
  // Still absent next time: nothing more.
  assert.equal(detectReset(t, two(null), T + 2 * MIN), null);
  // Left out before its time, or without a known time, is not a reset.
  const early = newResetTracker();
  detectReset(early, two(97), T - 3 * HOUR);
  assert.equal(detectReset(early, two(null), T - 3 * HOUR + MIN), null);
  const unknown = newResetTracker();
  detectReset(unknown, claude(97, null), T - MIN);
  assert.equal(detectReset(unknown, [prov("claude", [w("weekly", 5, null)])], T), null);
  // A window that was low is not news when it goes.
  const low = newResetTracker();
  detectReset(low, two(30), T - MIN);
  assert.equal(detectReset(low, two(null), T + MIN), null);
});

test("a provider missing from the answer is not read as reset", () => {
  const t = newResetTracker();
  detectReset(t, [...claude(95, T), prov("codex", [w("session", 95, T)])], T - MIN);
  assert.equal(detectReset(t, claude(95, T), T + MIN), null);
  assert.equal(t.has("codex:session"), true);
});

test("numbers that are not finite are ignored and do not spoil the record", () => {
  const t = newResetTracker();
  detectReset(t, claude(95, T), T - MIN);
  for (const bad of [NaN, Infinity, -Infinity, undefined as never, null as never, "3" as never]) {
    assert.equal(detectReset(t, claude(bad, T + 5 * HOUR), T + MIN), null);
    assert.equal(t.get("claude:session")?.used, 95);
  }
  // A reset time that is not finite counts as unknown.
  const u = newResetTracker();
  detectReset(u, claude(95, NaN), 0);
  assert.equal(u.get("claude:session")?.resetsAt, null);
  assert.equal(detectReset(u, claude(2, Infinity), MIN)?.resetsAt, null);
});

test("with several windows the one that stood highest is announced", () => {
  const t = newResetTracker();
  const before = [prov("claude", [w("session", 80, T), w("weekly-opus", 99, T), w("weekly", 85, T)])];
  detectReset(t, before, T - MIN);
  const after = [prov("claude", [w("session", 1, T + 5 * HOUR), w("weekly-opus", 2, T + 5 * HOUR), w("weekly", 3, T + 5 * HOUR)])];
  assert.equal(detectReset(t, after, T + MIN)?.kind, "weekly-opus");
  // Equal: the first.
  const e = newResetTracker();
  detectReset(e, [prov("claude", [w("a", 90, T), w("b", 90, T)])], T - MIN);
  assert.equal(detectReset(e, [prov("claude", [w("a", 0, null), w("b", 0, null)])], T + MIN)?.kind, "a");
  // Across providers.
  const m = newResetTracker();
  detectReset(m, [prov("claude", [w("session", 75, T)]), prov("codex", [w("session", 92, T)])], T - MIN);
  assert.equal(detectReset(m, [prov("claude", [w("session", 0, null)]), prov("codex", [w("session", 0, null)])], T + MIN)?.provider, "codex");
});

test("kinds with a colon or a dash keep their name", () => {
  const t = newResetTracker();
  detectReset(t, [prov("claude", [w("model:Opus", 95, T), w("session", 10, T), w("weekly-opus", 10, T)])], T - MIN);
  const hit = detectReset(t, [prov("claude", [w("session", 10, T), w("weekly-opus", 10, T)])], T + MIN);
  assert.equal(hit?.kind, "model:Opus");
  assert.equal(hit?.reset, true);
});

test("a rise and a reset do not disturb each other", () => {
  // The same answers go through both rules, as NoticeLayer does.
  const rise = newQuotaTracker(), reset = newResetTracker();
  const step = (used: number, resetsAt: number | null, now: number) => ({ rise: detectRise(rise, claude(used, resetsAt)), reset: detectReset(reset, claude(used, resetsAt), now) });
  assert.deepEqual(step(50, T, T - 3 * MIN), { rise: null, reset: null });
  const up = step(75, T, T - 2 * MIN);
  assert.equal(up.rise?.used, 75);
  assert.equal(up.reset, null);
  const down = step(2, T + 5 * HOUR, T + MIN);
  assert.equal(down.rise, null);
  assert.equal(down.reset?.reset, true);
  // The rise has no `reset` flag.
  assert.equal("reset" in (up.rise ?? {}), false);
});

test("what is passed in is not changed", () => {
  const t = newResetTracker();
  const first = claude(95, T), second = claude(1, T + 5 * HOUR);
  const copy = JSON.stringify([first, second]);
  detectReset(t, first, T - MIN);
  detectReset(t, second, T + MIN);
  assert.equal(JSON.stringify([first, second]), copy);
});

test("the notice is held back by the switch, presentation mode and quiet hours", () => {
  const quiet = { on: true, from: "22:00", to: "07:00" };
  const at = (h: number, min = 0) => new Date(2026, 0, 5, h, min);
  // Off by default: the switch decides first.
  assert.equal(resetAlertAllowed(false, false, { ...quiet, on: false }, at(12)), false);
  assert.equal(resetAlertAllowed(true, false, { ...quiet, on: false }, at(12)), true);
  // Presenting.
  assert.equal(resetAlertAllowed(true, true, { ...quiet, on: false }, at(12)), false);
  // Quiet hours that cross midnight.
  assert.equal(resetAlertAllowed(true, false, quiet, at(23)), false);
  assert.equal(resetAlertAllowed(true, false, quiet, at(3, 30)), false);
  assert.equal(resetAlertAllowed(true, false, quiet, at(21, 59)), true);
  assert.equal(resetAlertAllowed(true, false, quiet, at(22, 0)), false);
  assert.equal(resetAlertAllowed(true, false, quiet, at(7, 0)), true);
  assert.equal(resetAlertAllowed(true, false, quiet, at(12)), true);
  // Quiet hours set but switched off, and an unreadable window.
  assert.equal(resetAlertAllowed(true, false, { ...quiet, on: false }, at(23)), true);
  assert.equal(resetAlertAllowed(true, false, { on: true, from: "x", to: "y" }, at(23)), true);
  // Both holding back.
  assert.equal(resetAlertAllowed(true, true, quiet, at(23)), false);
});
