// themes.css read as text: a change of style crossfades as one picture, so the colours must not also blend underneath it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dirname, "themes.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

test("switching the style turns the colours' 500 ms transition off, and wins over it by coming later", () => {
  const blend = css.search(/:root\s*\{\s*transition:/);
  const switching = css.search(/:root\[data-design-switching\]\s*\{\s*transition:\s*none;?\s*\}/);
  assert.ok(blend >= 0, "the colours' transition on :root");
  assert.ok(switching > blend, ":root[data-design-switching] { transition: none } after it");
});
