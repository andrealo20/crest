import { test } from "node:test";
import assert from "node:assert/strict";
import { quotaLevel, newQuotaTracker, detectRise, armTrack, observeTrack, topNotice } from "./notices.ts";

const p = (used: number, error: string | null = null) => [{ id: "claude" as const, plan: null, error, updatedAt: 0, windows: [{ kind: "session", usedPercent: used, resetsAt: null, windowSecs: null }] }];

test("levels", () => { assert.equal(quotaLevel(69.9), 0); assert.equal(quotaLevel(70), 1); assert.equal(quotaLevel(90), 2); });

test("no alert on first read, alert on rise, none on stay or fall", () => {
  const t = newQuotaTracker();
  assert.equal(detectRise(t, p(95)), null);
  assert.equal(detectRise(t, p(96)), null);
  const u = newQuotaTracker(); detectRise(u, p(50));
  assert.deepEqual(detectRise(u, p(72)), { provider: "claude", kind: "session", used: 72, resetsAt: null });
  assert.equal(detectRise(u, p(75)), null);
  assert.equal(detectRise(u, p(91))?.used, 91);
  assert.equal(detectRise(u, p(40)), null);
  assert.equal(detectRise(u, p(80, "offline")), null);
});

test("track gate", () => {
  const g = { until: null };
  armTrack(g, 0, true); assert.equal(observeTrack(g, false, 1000), false); assert.equal(observeTrack(g, true, 4000), true);
  assert.equal(observeTrack(g, true, 4100), false);
  armTrack(g, 0, true); assert.equal(observeTrack(g, true, 6000), false);
  armTrack(g, 0, false); assert.equal(observeTrack(g, true, 100), false);
});

test("priority", () => {
  assert.equal(topNotice({ timer: true, status: true, quota: true, track: true }), "timer");
  assert.equal(topNotice({ timer: false, status: true, quota: true, track: true }), "status");
  assert.equal(topNotice({ timer: false, status: false, quota: true, track: true }), "quota");
  assert.equal(topNotice({ timer: false, status: false, quota: false, track: false }), null);
});
