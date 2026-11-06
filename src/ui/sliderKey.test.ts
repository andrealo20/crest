import { test } from "node:test";
import assert from "node:assert/strict";
import { sliderKey } from "./sliderKey.ts";

test("arrows move by a step and stop at the ends, Home and End jump, other keys do nothing", () => {
  assert.equal(sliderKey("ArrowRight", 40, 5, 0, 100), 45);
  assert.equal(sliderKey("ArrowUp", 40, 5, 0, 100), 45);
  assert.equal(sliderKey("ArrowLeft", 40, 5, 0, 100), 35);
  assert.equal(sliderKey("ArrowDown", 2, 5, 0, 100), 0);
  assert.equal(sliderKey("ArrowUp", 98, 5, 0, 100), 100);
  assert.equal(sliderKey("Home", 40, 5, 10, 90), 10);
  assert.equal(sliderKey("End", 40, 5, 10, 90), 90);
  assert.equal(sliderKey("Tab", 40, 5, 0, 100), undefined);
});
