import { test } from "node:test";
import assert from "node:assert/strict";
import { countCheck, utcDay } from "./dailyCount.ts";

const sender = (answer: boolean | Error) => {
  const calls: number[] = [];
  const send = () => (calls.push(1), answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer));
  return { calls, send };
};

test("the day is the UTC date, also late in the evening west of Greenwich", () => {
  assert.equal(utcDay(new Date("2026-11-27T23:30:00-05:00")), "2026-11-28");
});

test("a new install sends and keeps today once counted", async () => {
  const s = sender(true);
  assert.equal(await countCheck(true, null, new Date("2026-11-27T10:00:00Z"), s.send), "2026-11-27");
  assert.equal(s.calls.length, 1);
});

test("a day already counted sends nothing until the next UTC day", async () => {
  const s = sender(true);
  assert.equal(await countCheck(true, "2026-11-27", new Date("2026-11-27T23:59:00Z"), s.send), "2026-11-27");
  assert.equal(s.calls.length, 0);
  assert.equal(await countCheck(true, "2026-11-27", new Date("2026-11-28T00:01:00Z"), s.send), "2026-11-28");
  assert.equal(s.calls.length, 1);
});

test("a clock set back to an earlier day sends nothing", async () => {
  const s = sender(true);
  assert.equal(await countCheck(true, "2026-11-27", new Date("2026-11-20T12:00:00Z"), s.send), "2026-11-27");
  assert.equal(s.calls.length, 0);
});

test("a failed or refused ping keeps the old day, so the next check tries again", async () => {
  for (const answer of [false, new Error("offline")]) {
    const s = sender(answer);
    assert.equal(await countCheck(true, "2026-11-26", new Date("2026-11-27T08:00:00Z"), s.send), "2026-11-26");
    assert.equal(s.calls.length, 1);
  }
});

test("with the switch off nothing is sent", async () => {
  const s = sender(true);
  assert.equal(await countCheck(false, null, new Date("2026-11-27T10:00:00Z"), s.send), null);
  assert.equal(await countCheck(false, "2026-11-01", new Date("2026-11-27T10:00:00Z"), s.send), "2026-11-01");
  assert.equal(s.calls.length, 0);
});
