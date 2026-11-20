import { test } from "node:test";
import assert from "node:assert/strict";
import { springs } from "../design/motion.ts";
import { filledPress } from "./press.ts";

test("a filled or tonal button springs to 97 % under Material, and stays still under reduced motion and in Crest", () => {
  const press = filledPress("material", false);
  assert.deepEqual(press, { whileTap: { transform: "scale(0.97)", transition: springs.pop } });
  // The same object, which setMotionDesign rewrites in place when the Style changes.
  assert.equal(press.whileTap?.transition, springs.pop);
  assert.deepEqual(filledPress("material", true), {});
  assert.deepEqual(filledPress("crest", false), {});
});
