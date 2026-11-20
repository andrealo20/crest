import { test } from "node:test";
import assert from "node:assert/strict";
import { content, springs } from "../design/motion.ts";
import { cascadeDelay, GROUP_IN } from "./cascade.ts";

test("the groups of a page come in 45 ms apart, and the fifth and later together", () => {
  assert.equal(cascadeDelay(0), 0);
  assert.ok(Math.abs(cascadeDelay(2) - 0.09) < 1e-9);
  assert.ok(Math.abs(cascadeDelay(4) - 0.18) < 1e-9);
  assert.ok(Math.abs(cascadeDelay(9) - 0.18) < 1e-9);
});

test("a group rises 14 px on the morph spring and fades like content, with no delay of its own to override the cascade", () => {
  assert.deepEqual(GROUP_IN.hidden, { opacity: 0, transform: "translateY(14px)" });
  const s = GROUP_IN.shown();
  assert.equal(s.transform, "translateY(0px)");
  assert.equal(s.transition.default, springs.morph);
  assert.equal(s.transition.opacity.duration, content.enter.duration);
  assert.equal(s.transition.opacity.ease, content.enter.ease);
  assert.equal("delay" in s.transition.opacity, false);
});
