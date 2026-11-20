// apply() (store.ts) in a fake page: what <html> and the closed notch's ink show as the Style or the system's contrast changes. Node
// cannot load what store.ts imports (the stores, Tauri, the settings), so the hook hands it this file's fakes instead, as in
// notch/glass/live.test.ts, and turns import.meta.env.DEV off; the colour code is the real one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { FONTS, THEME_DEFAULTS, fontStack } from "./themes.ts";

const STORE = new URL("./store.ts", import.meta.url).href;
/** What store.ts runs as it is, named without the ".ts" node needs. */
const REAL = ["./themes", "./material", "./daynight", "./history"];
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL !== STORE) return nextResolve(specifier, context);
    return REAL.includes(specifier) ? nextResolve(`${specifier}.ts`, context) : { url: import.meta.url, shortCircuit: true };
  },
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url !== STORE) return loaded;
    return { ...loaded, source: Buffer.from(loaded.source as Uint8Array).toString().replaceAll("import.meta.env.DEV", "false") };
  },
});

// ---------- What store.ts imports ----------

export function createStore<T>(state: T) {
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: T) {
      state = next;
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
export const useMemo = <T>(make: () => T) => make();
export const isNotchWindow = false;
export const themeFiles = {};
export const settings = createStore({ themes: { ...THEME_DEFAULTS, id: "light" }, weather: null });
export const updateSettings = () => {};
export const setRowFamily = () => {};
export const design = createStore("crest");
/** The Style apply() last gave the motion presets. */
let motion = "";
export const setMotionDesign = (style: string) => void (motion = style);

// ---------- The page ----------

/** What apply() wrote on <html>. */
const vars: Record<string, string> = {}, dataset: Record<string, string> = {};
/** The system's "more contrast", and the listener store.ts gives its query. */
const more = { matches: false, change: () => {} };
Object.assign(globalThis, {
  window: globalThis,
  document: { documentElement: { dataset, style: { setProperty: (name: string, value: string) => void (vars[name] = value) } } },
  matchMedia: (query: string) => ({
    get matches() {
      return query === "(prefers-contrast: more)" && more.matches;
    },
    addEventListener: (_: string, listener: () => void) => {
      if (query === "(prefers-contrast: more)") more.change = listener;
    },
  }),
});

const pick = (style: "crest" | "material") => settings.set({ ...settings.get(), themes: { ...settings.get().themes, design: style } });

test("apply() draws again when the Style or the system's contrast changes, and the closed notch's ink follows the Style", async () => {
  const store = (await import("./store.ts")) as typeof import("./store");
  store.startThemes();
  const seen = () => [dataset.design, design.get(), motion, vars["--color-notch"], vars["--color-primary"], store.darkInk()["--color-notch"], store.darkInk()["--color-primary"], vars["--font-sans"]];
  // Light in the Crest style; the black closed notch keeps Dark's ink.
  const crest = ["crest", "crest", "crest", "#fafafc", "#1d1d1f", "#000000", "rgb(255 255 255 / 0.96)", FONTS.inter];
  assert.deepEqual(seen(), crest);
  // Light's seed: a light panel, and on the closed notch the dark scheme of the same seed.
  pick("material");
  assert.deepEqual(seen(), ["material", "material", "material", "#f9f9ff", "#415e91", "#111318", "#aac7ff", fontStack("auto", "material")]);
  more.matches = true;
  more.change();
  assert.deepEqual(seen(), ["material", "material", "material", "#f9f9ff", "#042b5b", "#111318", "#ebf0ff", fontStack("auto", "material")]);
  pick("crest");
  assert.deepEqual(seen(), crest);
});
