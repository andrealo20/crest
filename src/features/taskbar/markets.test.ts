import { test } from "node:test";
import assert from "node:assert/strict";
import { rateText } from "./markets.ts";

test("a rate keeps five significant digits in the language's own figures, so the widget's room fits any pair", () => {
  assert.equal(rateText(1.183456, "en"), "1.1835");
  assert.equal(rateText(191.2345, "de"), "191,23");
  assert.equal(rateText(28762.4, "en"), "28,762");
  assert.equal(rateText(0.0052345, "en"), "0.0052345");
  assert.equal(rateText(1.18, "en"), "1.1800");
});
