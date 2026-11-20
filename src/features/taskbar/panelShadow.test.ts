import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(import.meta.dirname, "window", "BarPanel.tsx"), "utf8");
const CLASS = "material:[--shadow-panel:var(--shadow-level3)]";

test("the panels above the bar float at Material's level 3, set on the box that holds their ink and zoom", () => {
  assert.equal(src.split(CLASS).length - 1, 1);
  const at = src.indexOf(CLASS);
  // The tag is one line; the checkout may end it with CRLF.
  const tag = src.slice(src.lastIndexOf("<div", at), src.indexOf("\n", at));
  assert.ok(tag.includes(`className="${CLASS}"`));
  assert.ok(tag.includes('data-theme-ink={surface.ink ? "" : undefined}'));
  assert.ok(tag.includes('style={{ zoom, ...(surface.ink && { ...surface.ink, color: "var(--color-label)" }) }}'));
  assert.match(src, /^const RADIUS = 30;\r?$/m);
});
