import { test } from "node:test";
import assert from "node:assert/strict";
import { windArrow } from "./wind.ts";

// Where each style's NavigationArrow points before any rotation, in compass degrees: Phosphor's north-west, Material's near_me north-east.
const REST = { crest: 315, material: 45 } as const;

test("the wind arrow points where the wind blows to in both styles, and turns as before in Crest's", () => {
  for (const style of ["crest", "material"] as const)
    for (const from of [0, 45, 90, 200, 359]) assert.equal((((REST[style] + windArrow(from, style)) % 360) + 360) % 360, (from + 180) % 360, `${style} ${from}`);
  assert.equal(windArrow(90, "crest"), -45);
});
