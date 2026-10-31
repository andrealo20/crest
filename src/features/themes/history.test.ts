import { test } from "node:test";
import assert from "node:assert/strict";
import { COALESCE_MS, original, record, startHistory, undo } from "./history.ts";

test("undo steps back and stops at the start", () => {
  let h = startHistory("a");
  h = record(h, "b", 1000);
  h = record(h, "c", 1000 + COALESCE_MS);
  assert.equal(h.present, "c");
  h = undo(h);
  assert.equal(h.present, "b");
  h = undo(h);
  assert.equal(h.present, "a");
  assert.equal(undo(h), h);
});

test("quick changes are one step", () => {
  let h = startHistory(0);
  for (let i = 1; i <= 10; i++) h = record(h, i, 1000 + i * 50);
  assert.equal(h.present, 10);
  assert.deepEqual(h.past, [0]);
  assert.equal(original(h), 0);
  h = record(h, 11, 5000);
  assert.deepEqual(h.past, [0, 10]);
  // After an undo the next change is a step of its own.
  h = undo(h);
  h = record(h, 12, 5010);
  assert.deepEqual(h.past, [0, 10]);
});
