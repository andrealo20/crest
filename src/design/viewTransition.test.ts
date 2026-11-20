import { test } from "node:test";
import assert from "node:assert/strict";
import { wantsViewTransition } from "./viewTransition.ts";

test("only a change of style on an engine with view transitions crossfades, never the first paint", () => {
  assert.equal(wantsViewTransition(undefined, "material", true), false);
  assert.equal(wantsViewTransition("crest", "material", true), true);
  assert.equal(wantsViewTransition("crest", "crest", true), false);
  assert.equal(wantsViewTransition("crest", "material", false), false);
});
