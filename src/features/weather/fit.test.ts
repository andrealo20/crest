import { test } from "node:test";
import assert from "node:assert/strict";
import { keepFit, weatherFit } from "./fit.ts";

test("the Material weather drops the hours first and then the detail tiles, and grows only near the largest size", () => {
  assert.deepEqual(weatherFit(480, 166), { hours: 0, details: false, big: false });
  assert.deepEqual(weatherFit(512, 183), { hours: 0, details: true, big: false });
  assert.deepEqual(weatherFit(608, 232), { hours: 8, details: true, big: false });
  assert.deepEqual(weatherFit(708, 298), { hours: 12, details: true, big: false });
  assert.deepEqual(weatherFit(708, 442), { hours: 12, details: true, big: true });
});

test("a resize that changes nothing the weather shows keeps the same fit, so React does not render again", () => {
  const prev = weatherFit(608, 232);
  assert.equal(keepFit(prev, weatherFit(612, 240)), prev);
  const next = weatherFit(708, 298);
  assert.equal(keepFit(prev, next), next);
  assert.equal(keepFit(prev, weatherFit(608, 400)).big, true);
  assert.equal(keepFit(prev, weatherFit(490, 232)).details, false);
});
