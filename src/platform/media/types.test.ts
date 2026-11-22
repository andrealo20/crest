import { test } from "node:test";
import assert from "node:assert/strict";
import { playedShare, type NowPlaying } from "./types.ts";

const song: NowPlaying = {
  title: "Song",
  artist: "Artist",
  artwork: null,
  accent: "#ffffff",
  isPlaying: false,
  position: 50,
  duration: 200,
  canSeek: true,
  updatedAt: 1000,
  appId: "App",
  shuffle: null,
  repeat: null,
  sources: [],
};

test("the share played is the live position over the length, held to the whole song, and unknown without a length", () => {
  assert.equal(playedShare(song, 99_000), 0.25);
  assert.equal(playedShare({ ...song, isPlaying: true }, 11_000), 0.3);
  assert.equal(playedShare({ ...song, isPlaying: true, position: 195 }, 21_000), 1);
  assert.equal(playedShare({ ...song, duration: 0 }, 11_000), null);
});
