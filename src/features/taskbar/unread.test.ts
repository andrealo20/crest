import { test } from "node:test";
import assert from "node:assert/strict";
import { WHATSAPP, normalizeUnread, unreadApps, unreadChoices, unreadLead, unreadSlot } from "./unread.ts";

test("the counted apps: null until Windows is read, else the picks in their order with the name seen, WhatsApp's, or the id", () => {
  assert.equal(unreadApps([WHATSAPP], {}, null), null);
  assert.deepEqual(unreadApps([WHATSAPP, "b", "c"], { b: "Beta" }, { [WHATSAPP]: 2, b: 0, x: 5 }), [
    { id: WHATSAPP, name: "WhatsApp", count: 2 },
    { id: "b", name: "Beta", count: 0 },
    { id: "c", name: "c", count: 0 },
  ]);
  // The name Windows gave wins over the one written here.
  assert.equal(unreadApps([WHATSAPP], { [WHATSAPP]: "WhatsApp Beta" }, {})?.[0].name, "WhatsApp Beta");
  assert.deepEqual(unreadApps([], {}, { a: 1 }), []);
});

test("the app in front is the one with the most, the first on a tie and when all are at zero", () => {
  const app = (id: string, count: number) => ({ id, name: id, count });
  assert.equal(unreadLead([]), null);
  assert.equal(unreadLead([app("a", 0), app("b", 0)])?.id, "a");
  assert.equal(unreadLead([app("a", 1), app("b", 3), app("c", 3)])?.id, "b");
});

test("the apps offered: WhatsApp first even if never seen, then the seen ones by name, then picks no longer seen, once each", () => {
  assert.deepEqual(unreadChoices({ z: "Zoom", m: "Mail" }, ["gone"]), [
    { id: WHATSAPP, name: "WhatsApp" },
    { id: "m", name: "Mail" },
    { id: "z", name: "Zoom" },
    { id: "gone", name: "gone" },
  ]);
  // WhatsApp seen keeps its place and its seen name, once; crest-notify's sources never have a toast to count.
  assert.deepEqual(unreadChoices({ [WHATSAPP]: "WhatsApp", a: "Alpha", "cli:ci": "CI" }, [WHATSAPP, "a"]), [
    { id: WHATSAPP, name: "WhatsApp" },
    { id: "a", name: "Alpha" },
  ]);
});

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
