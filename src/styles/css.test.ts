// global.css read as text: the rules that keep presses still under reduced motion, the Material font and the platforms whole.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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

test("the contours variant follows roomy, so an opaque group wins over the roomy fill", () => {
  const contours = css.indexOf('@custom-variant contours (&:where([data-design="material"] [data-contours] *));');
  assert.ok(contours >= 0);
  assert.ok(contours > css.indexOf("@custom-variant roomy"));
});

test("nothing macOS 12 cannot read: no linear() easing and no color-mix()", () => {
  assert.doesNotMatch(css, /linear\(/);
  assert.doesNotMatch(css, /color-mix\(/);
});

const LAYER = "@layer components";

test("the tone layer sits in the components layer, fades only its opacity, and turns visible only on dark themes", () => {
  const tones = rules(css).filter((r) => r.selector.includes(".m3-tone"));
  assert.ok(tones.length >= 3, "no tone layer rules");
  for (const r of tones) {
    assert.ok(r.parents.includes(LAYER), `${r.selector} is outside ${LAYER}`);
    // Only the opacity moves: a transition on anything else would repaint, and the pressed corners snap with the button's own.
    const transition = /(?:^|[\s;])transition(?:-property)?\s*:([^;]*)/.exec(r.body);
    if (transition) assert.doesNotMatch(transition[1], /transform|box-shadow|background|border-radius|all/, r.selector);
    if (/:hover|:active/.test(r.selector) && /opacity\s*:/.test(r.body))
      for (const [, prop] of r.body.matchAll(/([\w-]+)\s*:/g)) assert.match(prop, /^(opacity|transition-[\w-]+)$/, `${r.selector} sets ${prop}`);
  }
  const base = tones.filter((r) => /position\s*:\s*absolute/.test(r.body) && /opacity\s*:\s*0\s*;/.test(r.body));
  assert.deepEqual(base.map((r) => r.selector), ['[data-design="material"] .m3-lift > .m3-tone']);
  for (const r of tones.filter((r) => /opacity\s*:\s*var\(--m3-tone-/.test(r.body)))
    assert.ok(r.selector.includes('[data-theme="dark"]'), `${r.selector} shows the tone on light themes`);
  for (const r of tones.filter((r) => r.selector.includes("[data-theme")))
    assert.match(r.selector, /:hover|:active/, `${r.selector} is neither the hover nor the press`);
});

test("the state layer reads its opacities from the variables a dark button sets to zero", () => {
  const layers = rules(css).filter(
    (r) => r.selector.includes(".pressable-fill)") && r.selector.endsWith("::after") && /:hover|:focus-visible|:active/.test(r.selector) && /opacity\s*:/.test(r.body),
  );
  assert.ok(layers.length >= 3, "no state layer rules");
  for (const r of layers) {
    const state = r.selector.includes(":hover") ? "hover" : r.selector.includes(":focus-visible") ? "focus" : "press";
    assert.match(r.body, new RegExp(`opacity\\s*:\\s*var\\(--m3-state-${state}[,)]`), r.selector);
  }
});

test("a morphing button leaves its transform to Motion's spring, outside the layers so it wins over .pressable", () => {
  const morph = rules(css).filter((r) => r.selector === '[data-design="material"] .m3-morph' && !r.parents.includes(LAYER) && /transition-property\s*:/.test(r.body));
  assert.equal(morph.length, 1, "no unlayered .m3-morph transition-property");
  assert.doesNotMatch(/transition-property\s*:([^;]*)/.exec(morph[0].body)![1], /transform|all/);
});

test("the menus take Material's corners and elevation without the ring", () => {
  const menu = readFileSync(join(import.meta.dirname, "../ui/menu.ts"), "utf8");
  for (const c of ["material:rounded-[16px]", "material:shadow-level2", "material:ring-0"]) assert.ok(menu.includes(c), c);
});

test("the Dock's buttons stay out of the state layer, since the drop is their hover there", () => {
  const layered = rules(css).filter((r) => r.selector.includes('.pressable[class*="rounded"]'));
  assert.ok(layered.length >= 5, "no state layer rules");
  for (const r of layered) assert.ok(r.selector.includes(":not([data-tool])"), `${r.selector} reaches the Dock`);
});

test("a dragged row's state layer sits in the components layer, only under Material, at 16 %", () => {
  const dragged = rules(css).filter((r) => r.selector.includes(".m3-dragged"));
  assert.deepEqual(dragged.map((r) => r.selector), ['[data-design="material"] .m3-dragged::after']);
  const [r] = dragged;
  assert.ok(r.parents.includes(LAYER), `${r.selector} is outside ${LAYER}`);
  assert.match(r.body, /background\s*:\s*currentColor\s*;/);
  assert.match(r.body, /opacity\s*:\s*0\.16\s*;/);
});

test("the bar's state layer sits in the components layer, reads the state variables and never :hover", () => {
  const layers = rules(css).filter((r) => r.selector.includes(".m3-layer"));
  assert.ok(layers.length >= 4, "no bar state layer rules");
  for (const r of layers) {
    assert.ok(r.parents.includes(LAYER), `${r.selector} is outside ${LAYER}`);
    assert.ok(r.selector.includes('[data-design="material"]'), `${r.selector} reaches Crest`);
    // The bar's window never sees the pointer leave, so :hover would stay on the last button.
    assert.doesNotMatch(r.selector, /:hover/);
    const transition = /(?:^|[\s;])transition(?:-property)?\s*:([^;]*)/.exec(r.body);
    if (transition) assert.doesNotMatch(transition[1], /transform|box-shadow|background|border-radius|all/, r.selector);
  }
  const base = layers.filter((r) => r.selector === '[data-design="material"] .m3-layer');
  assert.equal(base.length, 1, "no base .m3-layer rule");
  assert.match(base[0].body, /background\s*:\s*currentColor\s*;/);
  assert.match(base[0].body, /opacity\s*:\s*0\s*;/);
  assert.match(base[0].body, /pointer-events\s*:\s*none\s*;/);
  const state = (s: string) => layers.filter((r) => r.selector.includes(s));
  const [hover] = state("[data-hover]");
  assert.ok(hover, "no [data-hover] rule");
  assert.match(hover.body, /opacity\s*:\s*var\(--m3-state-hover[,)]/);
  assert.ok(hover.parents.includes("@media (hover: hover) and (pointer: fine)"), "a tap would leave the layer on");
  for (const [s, v] of [[":focus-visible", "focus"], [":active", "press"]]) {
    const [r] = state(s);
    assert.ok(r, `no ${s} rule`);
    assert.match(r.body, new RegExp(`opacity\\s*:\\s*var\\(--m3-state-${v}[,)]`), r.selector);
    // Stato's layer sits one span down, in the lifted pill; only under a button, since :active reaches every ancestor of the press.
    assert.ok(r.selector.includes(`button${s} > span > .m3-layer`), `${s} misses Stato's layer`);
  }
});

test("in Windows' high contrast a switch keeps its edge, and an on switch the outline a chosen segment has", () => {
  const forced = rules(css).filter((r) => r.parents.includes("@media (forced-colors: active)"));
  const body = (selector: string) =>
    forced
      .filter((r) => r.selector.split(",").map((s) => s.trim()).includes(selector))
      .map((r) => r.body.replace(/\s+/g, " "))
      .join(";");
  assert.match(body('[role="switch"]'), /border: 1px solid CanvasText/);
  assert.match(body('[role="switch"][aria-checked="true"]'), /outline: 2px solid Highlight;\s*outline-offset: -2px/);
});

test("a label on Crest's red takes the notch's ink, which every theme keeps readable there, never white", () => {
  // White on Material Dark's light red (#ffb4ab) reads at about 1.7:1; text-notch is the ink the themes check against red.
  const src = join(import.meta.dirname, "..");
  const white: string[] = [];
  for (const file of readdirSync(src, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".tsx"))) {
    for (const [cls] of readFileSync(join(src, file), "utf8").matchAll(/className=(?:"[^"]*"|\{`[^`]*`\})/g)) {
      if (/(^|[\s"`])bg-red(\s|"|`)/.test(cls) && /(^|[\s"`])text-white(\s|"|`)/.test(cls)) white.push(file);
    }
  }
  assert.deepEqual(white, []);
});
