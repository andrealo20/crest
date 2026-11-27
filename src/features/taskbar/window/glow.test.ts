import assert from "node:assert/strict";
import test from "node:test";
import { edgeMask } from "./glow.ts";

/** A CSS list's entries: commas inside a function's parentheses do not count. */
const entries = (list: string) => {
  let depth = 0;
  let n = 1;
  for (const c of list) {
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) n++;
  }
  return n;
};

test("the glow's mask fades in from each side, full on the edge and gone at the band's inner edge", () => {
  const m = edgeMask(48);
  assert.equal(entries(m), 4);
  for (const side of ["to bottom", "to top", "to right", "to left"]) {
    // Each side's fade reaches nothing at its inner edge, so where two sides meet in a corner no seam shows.
    assert.match(m, new RegExp(`linear-gradient\\(${side}, rgb\\(0 0 0 / 1\\) 0px, (?:rgb\\([^)]*\\) [\\d.]+px, )*rgb\\(0 0 0 / 0\\) 48px\\)`));
  }
});
