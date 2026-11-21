import { test } from "node:test";
import assert from "node:assert/strict";
import { weatherFit } from "./fit.ts";

test("the Material weather drops the hours first and then the detail tiles, and grows only near the largest size", () => {
  assert.deepEqual(weatherFit(480, 166), { hours: 0, details: false, big: false });
  assert.deepEqual(weatherFit(512, 183), { hours: 0, details: true, big: false });
  assert.deepEqual(weatherFit(608, 232), { hours: 8, details: true, big: false });
  assert.deepEqual(weatherFit(708, 298), { hours: 12, details: true, big: false });
  assert.deepEqual(weatherFit(708, 442), { hours: 12, details: true, big: true });
});
