import { test } from "node:test";
import assert from "node:assert/strict";
import { clickAction } from "./click.ts";

const text = { thumbnail: null };
const image = { thumbnail: "data:image/png;base64,AAAA" };

test("an image opens its preview, with paste on or off", () => {
  assert.equal(clickAction(image, { paste: false, hidden: false }), "preview");
  assert.equal(clickAction(image, { paste: true, hidden: false }), "preview");
});

test("text, links and files copy, or paste with Paste directly on", () => {
  assert.equal(clickAction(text, { paste: false, hidden: false }), "copy");
  assert.equal(clickAction(text, { paste: true, hidden: false }), "paste");
});

test("presentation mode hides the image, so a click copies it without a preview", () => {
  assert.equal(clickAction(image, { paste: false, hidden: true }), "copy");
});

test("presentation mode only copies: the card is hidden, and a paste would show the entry in the app on screen", () => {
  assert.equal(clickAction(text, { paste: true, hidden: true }), "copy");
  assert.equal(clickAction(image, { paste: true, hidden: true }), "copy");
});
