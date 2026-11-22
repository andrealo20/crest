import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(import.meta.dirname, "window", "MediaFaces.tsx"), "utf8");

test("under Material the song's ring and line sit on fill-3 as the Slider's track, never on secondary-container", () => {
  assert.doesNotMatch(src, /secondary-container/);
  assert.match(src, /stroke="currentColor" strokeOpacity=\{0\.25\} strokeWidth="2" className="material:stroke-fill-3 material:\[stroke-opacity:1\]"/);
  assert.match(src, /className="relative block h-\[3px\] overflow-hidden rounded-full material:bg-fill-3!" style=\{\{ background: "color-mix\(in srgb, currentColor 25%, transparent\)" \}\}/);
  assert.match(src, /material:stroke-primary/);
  assert.match(src, /material:bg-primary/);
});

test("the song's and the microphone's faces move only by transform and opacity, and tick only for a live song on a shown bar", () => {
  assert.doesNotMatch(src, /blur/);
  // Both animate a blur: the bar draws its own swap and cover.
  assert.doesNotMatch(src, /PlayPauseIcon|LiveArtwork/);
  assert.match(src, /useSecondTick\(!sample && !paused && np\.isPlaying && /);
  assert.match(src, /transition: tick/);
});

test("a muted microphone or speaker wears the bar's own colour as Stato's muted speaker, not red, and the faces keep their keys left to right", () => {
  assert.doesNotMatch(src, /text-red/);
  assert.ok((src.match(/dir="ltr"/g) ?? []).length >= 2);
  assert.match(src, /sample \? undefined : startStatus\(\)/);
});
