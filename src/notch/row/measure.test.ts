// measure.ts in a fake page: a canvas and a hidden span whose widths the test sets, to see where each width comes from. Node cannot
// load what measure.ts imports by those names, so the hook hands it this file's store and the real themes.ts, as in themes/store.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const MEASURE = new URL("./measure.ts", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL !== MEASURE) return nextResolve(specifier, context);
    return specifier === "../../lib/store" ? { url: import.meta.url, shortCircuit: true } : nextResolve(`${specifier}.ts`, context);
  },
});

export function createStore<T>(state: T) {
  return { get: () => state, set: (next: (s: T) => T) => void (state = next(state)) };
}

/** Width of one character on the canvas and in the page, and what tabular-nums adds in the page. */
const char = { canvas: 6, page: 6.02, tnum: 1 };
const span = {
  style: {} as Record<string, string>,
  textContent: "",
  getBoundingClientRect() {
    return { width: this.textContent.length * (char.page + (this.style.fontVariantNumeric === "tabular-nums" ? char.tnum : 0)) };
  },
};
/** The listener measure.ts gives the page's fonts, for "a font finished loading". */
let fontLoaded = () => {};
Object.assign(globalThis, {
  document: {
    fonts: { addEventListener: (_: string, listener: () => void) => void (fontLoaded = listener) },
    createElement: (tag: string) => (tag === "canvas" ? { getContext: () => ({ font: "", measureText: (text: string) => ({ width: text.length * char.canvas }) }) } : span),
    body: { append: () => {} },
  },
});

test("widths come from the canvas while it draws the check's line as the page does, else from the page; tabular ones from the page in Material", async () => {
  const m = (await import("./measure.ts")) as typeof import("./measure");
  // The check's line (19 characters) 0.38 px apart: canvas widths, rounded up (the page's would be 31).
  assert.equal(m.measureText("12:45"), 30);
  // Tabular text stays on the canvas in the Crest style; in Material it comes from the page, tnum's wider characters included.
  assert.equal(m.measureTabular("12:45"), 30);
  m.setTabularFromDom(true);
  assert.deepEqual([m.measureTabular("12:45"), m.measureText("12:45")], [36, 30]);
  // The caption's tracking, per character, as setRowFamily is told; the row's own text has none.
  m.setRowFamily("Test", 0.11);
  assert.deepEqual([m.measureText("12:45", m.CAPTION_FONT), m.measureText("12:45")], [31, 30]);
  m.setRowFamily("Test", 0);
  assert.equal(m.measureText("12:45", m.CAPTION_FONT), 30);
  // A font finishes loading and the canvas draws the line 19 px apart from the page: from then on every width comes from the page.
  char.page = 7;
  fontLoaded();
  assert.deepEqual([m.measureText("12:45"), m.measureTabular("12:45"), m.measureText("12:45", m.CAPTION_FONT)], [35, 40, 35]);
});
