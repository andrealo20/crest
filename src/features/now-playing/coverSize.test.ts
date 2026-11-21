import { test } from "node:test";
import assert from "node:assert/strict";
import { COVER, MIN_HEIGHT, coverSize } from "./coverSize.ts";

test("the cover keeps its size at the default height and grows with a taller panel up to its maximum", () => {
  assert.equal(coverSize(232), COVER.min);
  assert.equal(coverSize(200), COVER.min);
  assert.equal(coverSize(278), 102);
  assert.equal(coverSize(540), COVER.max);
  assert.equal(coverSize(Number.NaN), COVER.min);
});

test("the Music tool is never shorter than the height at which the cover reaches its smallest", () => {
  assert.equal(coverSize(MIN_HEIGHT), COVER.min);
  assert.equal(coverSize(MIN_HEIGHT + 10), COVER.min + 10);
});
