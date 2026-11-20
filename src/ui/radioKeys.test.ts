import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { arrowStep } from "./radioKeys.ts";

test("arrows step through a radio group, mirrored right to left only on the horizontal ones", () => {
  assert.equal(arrowStep("ArrowRight", false), 1);
  assert.equal(arrowStep("ArrowRight", true), -1);
  assert.equal(arrowStep("ArrowLeft", false), -1);
  assert.equal(arrowStep("ArrowLeft", true), 1);
  assert.equal(arrowStep("ArrowDown", true), 1);
  assert.equal(arrowStep("ArrowUp", false), -1);
  assert.equal(arrowStep("Enter", false), 0);
});

test("the controls read the direction without :dir(), which macOS 12's WebKit does not know", () => {
  const source = readFileSync(new URL("./controls.tsx", import.meta.url), "utf8");
  assert.ok(!source.includes(":dir("));
});
