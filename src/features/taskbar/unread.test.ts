import { test } from "node:test";
import assert from "node:assert/strict";
import { WHATSAPP, normalizeUnread, unreadSlot } from "./unread.ts";

test("the apps the Unread widget counts: an array is kept, anything else gives the fallback; lower case, trimmed, once each, three at most", () => {
  for (const v of [undefined, "x", null, 3, {}]) assert.deepEqual(normalizeUnread(v, [WHATSAPP]), [WHATSAPP]);
  assert.deepEqual(normalizeUnread(["A", "a", 3, "", "b", "c", "d"], [WHATSAPP]), ["a", "b", "c"]);
  // A list the user emptied stays empty.
  assert.deepEqual(normalizeUnread([], [WHATSAPP]), []);
  assert.deepEqual(normalizeUnread([" x ", "y".repeat(513), "z".repeat(512)], []), ["x", "z".repeat(512)]);
  assert.equal(WHATSAPP, WHATSAPP.toLowerCase());
});

test("a click on the version with each app lands on the app under the pointer, split halfway between two, mirrored right to left", () => {
  assert.equal(unreadSlot(null, 3, false), null);
  assert.equal(unreadSlot(40, 1, false), null);
  assert.equal(unreadSlot(0, 3, false), 0);
  assert.equal(unreadSlot(27, 3, false), 0);
  assert.equal(unreadSlot(31, 3, false), 1);
  assert.equal(unreadSlot(95, 3, false), 2);
  assert.equal(unreadSlot(500, 3, false), 2);
  assert.equal(unreadSlot(-10, 3, false), 0);
  assert.equal(unreadSlot(0, 3, true), 2);
});
