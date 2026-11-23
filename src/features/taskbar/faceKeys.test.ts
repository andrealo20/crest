import { test } from "node:test";
import assert from "node:assert/strict";
import { MIC, MIC_WIDTH, TRACK, TRACK_WIDTH, WALL, onWeather, widgetKey } from "./faceKeys.ts";

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

test("the weather at the end of Time and weather or of the week opens Weather from the middle of the gap before it, out past the padding; the rest and the keyboard open the clock", () => {
  // A face 100 px wide whose weather starts 70 px from its start edge.
  for (const x of [70, 85, 100, 108]) assert.equal(onWeather(x, 70, 100, false), true);
  for (const x of [-6, 0, 50, 69.5]) assert.equal(onWeather(x, 70, 100, false), false);
  assert.equal(onWeather(null, 70, 100, false), false);
  assert.equal(onWeather(85, undefined, 100, false), false);
});

test("right to left the weather is drawn at the left end, and the padding left of it opens Weather too", () => {
  for (const x of [-6, 0, 15, 30]) assert.equal(onWeather(x, 70, 100, true), true);
  for (const x of [30.5, 50, 100, 108]) assert.equal(onWeather(x, 70, 100, true), false);
  assert.equal(onWeather(null, 70, 100, true), false);
});

test("the wallpaper's keys step back and on, each out past the padding on its side; the picture between them, its other version and the keyboard open Wallpapers", () => {
  const v = { wallpaper: "keys" };
  assert.equal(WALL.width, 2 * WALL.key + WALL.thumb);
  assert.equal(widgetKey("wallpaper", v, 10), "wallPrevious");
  assert.equal(widgetKey("wallpaper", v, -3), "wallPrevious");
  assert.equal(widgetKey("wallpaper", v, 40), null);
  assert.equal(widgetKey("wallpaper", v, 70), "wallNext");
  assert.equal(widgetKey("wallpaper", v, 85), "wallNext");
  assert.equal(widgetKey("wallpaper", v, null), null);
  for (const x of [-3, 10, 40, 70, 85]) assert.equal(widgetKey("wallpaper", { wallpaper: "thumb" }, x), null);
});
