// global.css read as text: the rules that keep presses still under reduced motion, the Material font and the platforms whole.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dirname, "global.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every block with its selector or at-rule and the at-rules around it. Enough for this file: no strings hold braces or semicolons. */
function rules(text: string) {
  const out: { selector: string; body: string; parents: string[] }[] = [];
  const stack: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      // Statements before the block (@import, @custom-variant, declarations) end with a semicolon.
      stack.push(text.slice(start, i).split(";").pop()!.trim().replace(/\s+/g, " "));
      start = i + 1;
    } else if (text[i] === "}") {
      out.push({ selector: stack.pop()!, body: text.slice(start, i), parents: [...stack] });
      start = i + 1;
    }
  }
  return out;
}

const NO_PREFERENCE = "@media (prefers-reduced-motion: no-preference)";

test("every press that moves an element waits for no-preference, in both styles", () => {
  const presses = rules(css).filter((r) => r.selector.includes(":active") && /(^|[\s;])transform\s*:/.test(r.body));
  // The scale of Crest's .pressable and of .pressable-wide at least: no feedback at all is not the fix.
  assert.ok(presses.length >= 2, "no press rule found");
  for (const r of presses) assert.ok(r.parents.includes(NO_PREFERENCE), `${r.selector} moves under reduced motion`);
});

test("the icons' outline and fill crossfade runs only without reduced motion", () => {
  const fades = rules(css).filter((r) => r.selector === ".icon-fade");
  assert.ok(fades.length > 0, "no .icon-fade rule");
  for (const r of fades) assert.ok(r.parents.includes(NO_PREFERENCE), "the icon crossfade runs under reduced motion");
  const iconset = readFileSync(join(import.meta.dirname, "../ui/iconset.tsx"), "utf8");
  // An inline transition would run whatever the media query says.
  assert.doesNotMatch(iconset, /transition:/);
  assert.match(iconset, /className="icon-fade"/);
});

test("only Material's body sets font-variation-settings, so no rule can undo the axes cut into the font", () => {
  for (const r of rules(css).filter((r) => /font-variation-settings\s*:/.test(r.body)))
    assert.equal(r.selector, '[data-design="material"] body');
});

test("the material and roomy variants are declared as the design writes them", () => {
  assert.ok(css.includes('@custom-variant material (&:where([data-design="material"], [data-design="material"] *));'));
  assert.ok(css.includes('@custom-variant roomy (&:where([data-design="material"] [data-roomy], [data-design="material"] [data-roomy] *));'));
});

test("nothing macOS 12 cannot read: no linear() easing and no color-mix()", () => {
  assert.doesNotMatch(css, /linear\(/);
  assert.doesNotMatch(css, /color-mix\(/);
});
