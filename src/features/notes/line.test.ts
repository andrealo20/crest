import { test } from "node:test";
import assert from "node:assert/strict";
import { noteLine } from "./line.ts";

test("the bar shows the note's first line with text, spaces folded, at most 200 characters", () => {
  assert.equal(noteLine(""), "");
  assert.equal(noteLine("  \n\t\n"), "");
  assert.equal(noteLine("\n\n  Milk and eggs \nbread"), "Milk and eggs");
  assert.equal(noteLine("a\tb   c"), "a b c");
  assert.equal(noteLine("one\r\ntwo"), "one");
  assert.equal(noteLine("x".repeat(500)).length, 200);
  // Only the start of a long note is read; its first line is there.
  assert.equal(noteLine(`${"\n".repeat(5000)}late`), "");
  // Cut between characters, not inside one.
  assert.equal(noteLine("😀".repeat(300)), "😀".repeat(200));
});
