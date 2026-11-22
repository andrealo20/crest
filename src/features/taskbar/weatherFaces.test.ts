import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(import.meta.dirname, "window", "WeatherFaces.tsx"), "utf8");

test("the sun's arc and horizon are a track on fill-3 under Material, as the timer's ring, never secondary-container", () => {
  assert.match(src, /fill="none" stroke="currentColor" strokeOpacity=\{0\.25\} strokeWidth="1\.5" strokeLinecap="round" className="material:stroke-fill-3 material:\[stroke-opacity:1\]"/);
  assert.doesNotMatch(src, /secondary-container/);
});

test("the sun's face ticks once a minute only while the bar shows and it is not a preview, and nothing on the weather's faces animates", () => {
  assert.match(src, /useMinuteTick\(!paused && at === undefined\)/);
  assert.doesNotMatch(src, /from "motion\/react"/);
});

test("the next days are named in the language's short form of the weekday", () => {
  assert.match(src, /new Intl\.DateTimeFormat\(locale\(\), \{ weekday: "short" \}\)/);
});
