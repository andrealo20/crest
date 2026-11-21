// The motion presets as the Style changes (motion.ts setMotionDesign): Material 3 Expressive's springs, then Crest's again. Components
// hold the presets themselves, so the setter rewrites them in place, and a key left over would change the spring.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spring as motionSpring } from "motion";

/** motion.ts's spring() and physics() with neither ?slow nor reduced motion, as a page without a window has them. */
const spring = (visualDuration: number, bounce: number) => ({ type: "spring", visualDuration, bounce });
function physics(visualDuration: number, bounce: number) {
  const root = (2 * Math.PI) / (visualDuration * 1.2);
  return { type: "spring", stiffness: root * root, damping: 2 * (1 - bounce) * root, mass: 1 };
}

test("the Style rewrites the motion presets in place, and Crest's come back key for key", async () => {
  // motion.ts reads ?slow and the reduced-motion query as it loads, and must load without a page as well.
  delete (globalThis as { location?: unknown }).location;
  delete (globalThis as { matchMedia?: unknown }).matchMedia;
  const { setMotionDesign, ...presets } = await import("./motion.ts");
  const { springs, fade, content, popover, card } = presets;
  const crest = structuredClone(presets);

  // The notice card keeps the spring it had in NoticeLayer.tsx (stiffness 420, damping 26), and each value waits on its own, since
  // Motion drops a root delay for a value with a transition of its own.
  const { opacity, transform } = card as Record<"opacity" | "transform", Record<string, number>>;
  assert.deepEqual(opacity, { duration: 0.25, delay: 0.08 });
  assert.deepEqual(transform, { type: "spring", stiffness: 420, damping: 26, mass: 1, delay: 0.08 });

  setMotionDesign("material");
  assert.deepEqual(springs, {
    open: spring(0.37, 0.2),
    close: spring(0.198, 0.1),
    peek: spring(0.269, 0.2),
    morph: spring(0.269, 0.2),
    snappy: spring(0.269, 0.2),
    glide: physics(0.269, 0.2),
    rebound: spring(0.185, 0.4),
    pop: spring(0.185, 0.4),
    value: { ...physics(0.6, 0), restDelta: 0.5, restSpeed: 2 },
    drift: physics(1.2, 0),
  });
  assert.deepEqual(fade, spring(0.085, 0));
  assert.deepEqual(content, { enter: { ...spring(0.131, 0), delay: 0.05 }, exit: spring(0.085, 0) });
  assert.deepEqual(popover, { enter: { default: spring(0.185, 0.4), opacity: spring(0.085, 0) }, exit: spring(0.085, 0) });
  assert.deepEqual(card, { opacity: { ...spring(0.131, 0), delay: 0.08 }, transform: { ...spring(0.185, 0.4), delay: 0.08 } });

  // Strict and deep: no stiffness or damping left on a spring that had none, no per-value entry on a tween.
  setMotionDesign("crest");
  assert.deepEqual(presets, crest);
});

test("a reading's spring is at rest before the next sample, for a step of 3 and of 50", async () => {
  const { springs, themeFade } = await import("./motion.ts");
  for (const to of [3, 50]) {
    const gen = motionSpring({ keyframes: [0, to], ...springs.value });
    let t = 0;
    while (!gen.next(t).done && t < 1000) t += 10;
    assert.ok(t < 1000, `a step of ${to} still moves at ${t} ms`);
  }
  assert.deepEqual(themeFade, { duration: 0.5, ease: [0.25, 0.1, 0.25, 1] });
});
