import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sliderKey, wheelAmount, wheelStep, wheelTakes } from "./sliderKey.ts";

test("arrows move by a step and stop at the ends, Home and End jump, other keys do nothing", () => {
  assert.equal(sliderKey("ArrowRight", 40, 5, 0, 100), 45);
  assert.equal(sliderKey("ArrowUp", 40, 5, 0, 100), 45);
  assert.equal(sliderKey("ArrowLeft", 40, 5, 0, 100), 35);
  assert.equal(sliderKey("ArrowDown", 2, 5, 0, 100), 0);
  assert.equal(sliderKey("ArrowUp", 98, 5, 0, 100), 100);
  assert.equal(sliderKey("Home", 40, 5, 10, 90), 10);
  assert.equal(sliderKey("End", 40, 5, 10, 90), 90);
  assert.equal(sliderKey("Tab", 40, 5, 0, 100), undefined);
});

test("the wheel moves one notch once 40 px have gathered, up raises, a line counts 16 px", () => {
  assert.deepEqual(wheelStep(0, -100, 0), { dir: 1, acc: 0 });
  assert.deepEqual(wheelStep(0, 100, 0), { dir: -1, acc: 0 });
  let acc = 0;
  for (let i = 0; i < 3; i++) {
    const r = wheelStep(acc, -10, 0);
    assert.equal(r.dir, 0);
    acc = r.acc;
  }
  assert.equal(acc, 30);
  assert.deepEqual(wheelStep(acc, -10, 0), { dir: 1, acc: 0 });
  assert.deepEqual(wheelStep(0, -3, 1), { dir: 1, acc: 0 });
});

test("a wheel notch moves 2 % of the range in whole steps, never less than one step", () => {
  assert.equal(wheelAmount(1, -100, 100), 4);
  assert.equal(wheelAmount(5, 0, 100), 5);
  assert.equal(wheelAmount(0.1, 0, 1), 0.1);
});

test("a wheel gesture belongs to the slider only with the focus or the pointer resting on it 400 ms", () => {
  const now = 10_000;
  assert.equal(wheelTakes({ focused: true, now, pointerRestSince: null, lastWheel: now - 10 }), true);
  assert.equal(wheelTakes({ focused: false, now, pointerRestSince: now - 400, lastWheel: now - 5000 }), true);
  assert.equal(wheelTakes({ focused: false, now, pointerRestSince: now - 399, lastWheel: now - 5000 }), false);
  assert.equal(wheelTakes({ focused: false, now, pointerRestSince: now - 50, lastWheel: now - 5000 }), false);
  assert.equal(wheelTakes({ focused: false, now, pointerRestSince: now - 1000, lastWheel: now - 200 }), false);
  assert.equal(wheelTakes({ focused: false, now, pointerRestSince: null, lastWheel: now - 5000 }), false);
});

test("the slider listens to the wheel only under Material and acts only when the gesture is its own", () => {
  const source = readFileSync(new URL("./controls.tsx", import.meta.url), "utf8");
  const start = source.indexOf("export function Slider(");
  assert.ok(start >= 0);
  const end = source.indexOf("\nexport function", start + 1);
  const slider = source.slice(start, end < 0 ? undefined : end);

  assert.ok(slider.includes('const material = design.use() === "material"'));
  const effect = slider.match(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[([^\]]*)\]\);/g)?.find((e) => e.includes('addEventListener("wheel"'));
  assert.ok(effect, "the wheel listener is registered in a useEffect");
  const exit = effect.indexOf("if (!material) return");
  assert.ok(exit >= 0 && exit < effect.indexOf('addEventListener("wheel"'), "the effect leaves before registering under Crest");
  assert.match(effect, /addEventListener\("wheel", [^)]*\{ passive: false \}\)/);
  assert.ok(effect.includes('removeEventListener("wheel"'));
  assert.match(effect, /\}, \[[^\]]*\bmaterial\b[^\]]*\]\);$/);

  // The style can change between a render and the event.
  const handlerStart = effect.indexOf("(e: WheelEvent) =>");
  assert.ok(handlerStart >= 0);
  const handler = effect.slice(handlerStart, effect.indexOf('addEventListener("wheel"'));
  const styleCheck = handler.indexOf('design.get() !== "material"');
  assert.ok(styleCheck >= 0 && styleCheck < handler.indexOf("preventDefault()"), "the handler reads the style at the event");
  for (const call of ["wheelTakes(", "wheelStep(", "wheelAmount("]) assert.ok(handler.includes(call), call);
  assert.match(handler, /> 300\b/, "300 ms without a wheel event closes the gesture");
  // preventDefault only after the verdict: a gesture the slider does not take scrolls the page.
  assert.equal(handler.split("preventDefault()").length, 2);
  assert.ok(handler.indexOf("if (!gesture.current.takes) return") < handler.indexOf("preventDefault()"));
  assert.match(handler, /setTimeout\([^,]*onRelease[^,]*, 300\)/);
  assert.ok(effect.includes("clearTimeout(release.current)"));

  assert.match(slider, /onPointerMove=\{\(e\) => \{[\s\S]*?rest\.current = e\.timeStamp/);
  assert.match(slider, /onPointerLeave=\{\(\) => \{?\s*\(?rest\.current = null/);
});
