import { test } from "node:test";
import assert from "node:assert/strict";
import { MIC, MIC_WIDTH, TRACK, TRACK_WIDTH, widgetKey } from "./faceKeys.ts";

test("the song's and the microphone's faces are as wide as their parts, so a new song or a mute never moves a neighbour", () => {
  assert.deepEqual(TRACK_WIDTH, { play: 160, cover: 192, disc: 22, track: 160 });
  assert.deepEqual(MIC_WIDTH, { mic: 16, both: 40 });
  assert.equal(TRACK_WIDTH.cover, TRACK.cover + TRACK.gap + TRACK.text.cover + 3 * TRACK.key);
  assert.equal(MIC_WIDTH.both, 2 * MIC.key);
});

test("a click on the round play key plays or pauses, the side padding beside it included; the titles and the keyboard open Now Playing", () => {
  const v = { title: "play" };
  assert.equal(widgetKey("title", v, 10), "toggle");
  assert.equal(widgetKey("title", v, -4), "toggle");
  assert.equal(widgetKey("title", v, 30), null);
  assert.equal(widgetKey("title", v, null), null);
});

test("the cover's three keys go back, play or pause and skip, the last one out to the screen's edge", () => {
  const v = { title: "cover" };
  assert.equal(widgetKey("title", v, 130), "previous");
  assert.equal(widgetKey("title", v, 150), "toggle");
  assert.equal(widgetKey("title", v, 175), "next");
  assert.equal(widgetKey("title", v, 199), "next");
  assert.equal(widgetKey("title", v, 60), null);
  assert.equal(widgetKey("title", v, null), null);
});

test("the round version plays or pauses wherever the pointer clicks it, and only Enter opens Now Playing", () => {
  const v = { title: "disc" };
  for (const x of [-6, 11, 28]) assert.equal(widgetKey("title", v, x), "toggle");
  assert.equal(widgetKey("title", v, null), null);
});

test("the progress version skips from its key and opens Now Playing from its line", () => {
  const v = { title: "track" };
  assert.equal(widgetKey("title", v, 150), "next");
  assert.equal(widgetKey("title", v, 168), "next");
  assert.equal(widgetKey("title", v, 100), null);
});

test("the scrolling line, a version this window does not know and the other widgets have no keys", () => {
  assert.equal(widgetKey("title", {}, 80), null);
  assert.equal(widgetKey("title", { title: "lyrics" }, 10), null);
  assert.equal(widgetKey("title", "not an object", 10), null);
  assert.equal(widgetKey("disk", {}, 5), null);
  assert.equal(widgetKey("clock", { title: "play" }, 5), null);
});

test("a click anywhere on the microphone mutes it, and beside it the speaker mutes the sound", () => {
  for (const x of [8, 30, null]) assert.equal(widgetKey("mic", {}, x), "mic");
  const v = { mic: "both" };
  assert.equal(widgetKey("mic", v, 5), "mic");
  assert.equal(widgetKey("mic", v, -6), "mic");
  assert.equal(widgetKey("mic", v, 25), "sound");
  assert.equal(widgetKey("mic", v, 46), "sound");
  assert.equal(widgetKey("mic", v, null), "mic");
});
