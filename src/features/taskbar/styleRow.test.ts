import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(import.meta.dirname, "TaskbarSettings.tsx"), "utf8");

test("the taskbar's Appearance opens with the style in use, linking to Notch › Themes › Style", () => {
  const group = src.indexOf('<Group id="settings-taskbar-look">');
  assert.ok(group > 0);
  const start = src.indexOf("<Row", group);
  const row = src.slice(start, src.indexOf("</Row>", start));
  assert.match(row, /^<Row icon="style" label=\{t\("Stil"\)\} hint=\{t\("Gilt für die ganze App; ändern unter Themen"\)\}>/);
  assert.ok(row.includes('onClick={() => nav.set({ tabId: "settings", section: "design" })}'));
  assert.ok(row.includes('{appDesign === "material" ? "Material" : "Crest"}'));
  const look = src.slice(src.indexOf("export function TaskbarLook("), group);
  assert.match(look, /const appDesign = design\.use\(\);/);
});
