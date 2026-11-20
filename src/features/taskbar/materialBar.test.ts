import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MENU_ROW_CLASS } from "../../ui/menu.ts";

const window = (name: string) => readFileSync(join(import.meta.dirname, "window", name), "utf8");

test("the bar's menus open from Material's 0.8 scale as the select menus do, in the shared menu look", () => {
  const src = window("BarMenu.tsx");
  assert.match(src, /const appDesign = design\.use\(\);/);
  assert.ok(src.includes('scale(${appDesign === "material" ? 0.8 : 0.96}) translateY(2px)'));
  assert.match(src, /exit=\{\{ opacity: 0, transform: "scale\(0\.98\)"/);
  assert.match(src, /\$\{MENU_PANEL_CLASS\}/);
  assert.match(src, /\$\{MENU_ROW_CLASS\}/);
});

test("a menu row keeps Material's focus ring inside itself, without the press scale of .pressable", () => {
  const classes = MENU_ROW_CLASS.split(/\s+/);
  assert.ok(classes.includes("pressable-wide"));
  assert.ok(!classes.includes("pressable"));
});
