// The theme preview on hover, read from the sources: node cannot render the cards or the settings window.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Checkouts on Windows have CRLF line ends.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const between = (text: string, from: string, to: string) => {
  const at = text.indexOf(from);
  assert.ok(at >= 0, from);
  return text.slice(at, text.indexOf(to, at + from.length));
};

test("a style card reports the pointer entering it, and the grid reports it leaving", () => {
  const cards = between(read("../../ui/controls.tsx"), "export function StyleCards<", "\n}\n");
  assert.ok(cards.includes("onHover?: (value: T | null) => void"), "prop");
  assert.ok(cards.includes("onPointerEnter={() => props.onHover?.(o.value)}"), "card");
  // Up to the grid's classes: the arrows inside its handlers hold a ">" of their own.
  const group = cards.slice(cards.indexOf('role="radiogroup"'), cards.indexOf("className=", cards.indexOf('role="radiogroup"')));
  assert.ok(group.includes("onPointerLeave={() => props.onHover?.(null)}"), group);
});

test("the theme grid previews after 220 ms in the focused settings window, and every choice, blur, prompt and unmount ends it", () => {
  const choice = between(read("./ThemeSettings.tsx"), "function ThemeChoice(", "\nfunction ");
  assert.match(choice, /<StyleCards[^>]*onHover=/);
  assert.match(choice, /window\.setTimeout\([\s\S]*?,\s*220,?\s*\)/);
  const preview = choice.slice(choice.indexOf("previewFor("));
  assert.ok(choice.includes("previewFor("), "previewFor");
  assert.ok(preview.slice(0, 400).includes('windowKind === "settings"'), "settings window");
  assert.ok(preview.slice(0, 400).includes("document.hasFocus()"), "focus");
  const choose = between(choice, "const choose = (id: string) => {", "\n  };");
  const ask = choose.indexOf("setPending(id)");
  assert.ok(ask > 0 && choose.lastIndexOf("stopPreview()", ask) > 0, choose);
  // After the pick, never before: updateSettings is synchronous and apply() would draw the old theme for a moment.
  const picked = choose.indexOf("pickTheme(id);");
  assert.ok(picked > ask, choose);
  assert.ok(choose.indexOf("stopPreview();", picked) > picked, choose);
  assert.ok(!choose.slice(ask, picked).includes("stopPreview"), choose);
  assert.ok(choice.includes('window.addEventListener("blur", stopPreview)'), "blur");
  assert.ok(choice.includes('window.removeEventListener("blur", stopPreview)'), "blur removed");
  assert.match(choice, /useEffect\(\(\) => \{\s*if \(pending\) stopPreview\(\);\s*\}, \[pending\]\);/);
  assert.match(choice, /return \(\) => \{\s*window\.removeEventListener\("blur", stopPreview\);\s*window\.removeEventListener\("keydown", stopPreview\);\s*stopPreview\(\);\s*\};/);
});

test("any key pressed in the settings window ends the preview, under the same Material-only condition as blur", () => {
  const choice = between(read("./ThemeSettings.tsx"), "function ThemeChoice(", "\nfunction ");
  const effect = between(choice, "useEffect(() => {\n    if (!previews) return;", "}, [previews]);");
  assert.ok(effect.includes('window.addEventListener("keydown", stopPreview)'), effect);
  assert.ok(effect.includes('window.removeEventListener("keydown", stopPreview)'), effect);
});

test("under Crest, and outside the settings window, the theme grid schedules no preview and writes no store", () => {
  const choice = between(read("./ThemeSettings.tsx"), "function ThemeChoice(", "\nfunction ");
  assert.ok(choice.includes('const previews = style === "material" && windowKind === "settings";'), "previews");
  assert.match(choice, /<StyleCards[^>]*onHover=\{previews \? hover : undefined\}/);
  const stop = between(choice, "const stopPreview = () => {", "\n  };");
  // storeCore's set always notifies, and each notify runs apply().
  assert.ok(stop.includes("if (previewTheme.get() !== null) previewTheme.set(null);"), stop);
  const blur = choice.slice(choice.lastIndexOf("useEffect(", choice.indexOf('window.addEventListener("blur"')));
  assert.match(blur, /^useEffect\(\(\) => \{\s*if \(!previews\) return;/);
  assert.match(blur, /\}, \[previews\]\);/);
});

test("apply() reads the style first and the preview under Material alone, and redraws when the preview changes", () => {
  const store = read("./store.ts");
  const apply = between(store, "function apply() {", "\n}\n");
  const style = apply.indexOf("const style: Design =");
  const file = apply.indexOf("const file =");
  assert.ok(style > 0 && file > style, apply.slice(0, 300));
  // The draft over the preview: the colour editor shows its own colours whatever card the pointer rests on.
  assert.ok(apply.includes('const file = draft.get()?.present ?? (style === "material" ? previewTheme.get() : null) ?? savedTheme();'), "file");
  const start = between(store, "export function startThemes() {", "\n}\n");
  assert.ok(start.includes("previewTheme.subscribe(apply);"), "subscribe");
});
