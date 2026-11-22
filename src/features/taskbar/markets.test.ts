import { test } from "node:test";
import assert from "node:assert/strict";
import { changeTone, rateText, spanPoints } from "./markets.ts";

test("a rate keeps five significant digits in the language's own figures, so the widget's room fits any pair", () => {
  assert.equal(rateText(1.183456, "en"), "1.1835");
  assert.equal(rateText(191.2345, "de"), "191,23");
  assert.equal(rateText(28762.4, "en"), "28,762");
  assert.equal(rateText(0.0052345, "en"), "0.0052345");
  assert.equal(rateText(1.18, "en"), "1.1800");
});

test("a line spans its box from its lowest to its highest point, a pixel inside top and bottom", () => {
  assert.deepEqual(spanPoints([1, 2, 3]), [
    [0, 13],
    [14, 7],
    [28, 1],
  ]);
  // Flat: across the middle.
  assert.deepEqual(spanPoints([5, 5, 5]), [
    [0, 7],
    [14, 7],
    [28, 7],
  ]);
  assert.deepEqual(spanPoints([4]), []);
  assert.deepEqual(spanPoints([]), []);
  // The panel's box: the same rule at its size.
  assert.deepEqual(spanPoints([2, 1], 296, 88), [
    [0, 1],
    [296, 87],
  ]);
});

test("a change is up or down as it shows at two decimals, flat below that or unknown", () => {
  assert.equal(changeTone(2.41), "up");
  assert.equal(changeTone(-0.3), "down");
  assert.equal(changeTone(0.004), "flat");
  assert.equal(changeTone(-0.004), "flat");
  assert.equal(changeTone(null), "flat");
});
