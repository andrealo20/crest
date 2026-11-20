// apply() (store.ts) in a fake page: what <html> and the closed notch's ink show as the Style or the system's contrast changes. Node
// cannot load what store.ts imports (the stores, Tauri, the settings), so the hook hands it this file's fakes instead, as in
// notch/glass/live.test.ts, and turns import.meta.env.DEV off; the colour code is the real one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { FONTS, THEME_DEFAULTS, fontStack, systemTheme } from "./themes.ts";
import { resolveMaterial } from "./material.ts";

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

/** What the page saved before it was loaded, by `persist` key, and the stores that read it. */
const persisted: Record<string, unknown> = {};
const stores: Record<string, { get(): unknown }> = {};

export function createStore<T>(state: T, opts: { persist?: string } = {}) {
  const listeners = new Set<() => void>();
  if (opts.persist && opts.persist in persisted) state = persisted[opts.persist] as T;
  const store = {
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
  if (opts.persist) stores[opts.persist] = store;
  return store;
}
export const useMemo = <T>(make: () => T) => make();
/** A let, so a test can make this page the notch's: store.ts reads the live binding. */
export let isNotchWindow = false;
const beNotch = (on: boolean) => void (isNotchWindow = on);
/** The colours the notch gave the settings window to open in. */
const backgrounds: string[] = [];
export const settingsWindow = { background: async (color: string) => void backgrounds.push(color) };
export const flushSync = (write: () => void) => write();
/** Off: apply() writes at once. On: a change of style goes through document.startViewTransition, as on an engine that has it. */
let crossfades = false;
export const wantsViewTransition = (from: string | undefined, to: string) => crossfades && from !== to;
export const themeFiles = {};
/** The system's answer to systemAccent.get(), given when a test says so, and the listener store.ts gives the event. */
let answer: (a: unknown) => void = () => {};
let accentEvent: (a: unknown) => void = () => {};
export const systemAccent = {
  get: () => new Promise((done) => (answer = done)),
  listen(cb: (a: unknown) => void) {
    accentEvent = cb;
    return () => {};
  },
};
export const settings = createStore({ themes: { ...THEME_DEFAULTS, id: "light" }, weather: null });
export const updateSettings = () => {};
/** What applyFont() last gave measure.ts: the row's family, the caption's tracking, and whether tabular text is measured in the page. */
let family = "", spacing = -1, tabular: boolean | null = null;
export function setRowFamily(f: string, s: number) {
  family = f;
  spacing = s;
}
export const setTabularFromDom = (on: boolean) => void (tabular = on);
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
const settle = () => new Promise((done) => setImmediate(done));

// First: it needs startThemes()'s first apply(), before the system has answered.
test("a saved System card draws from the last accent read before the system answers, then from each new answer", async () => {
  persisted["system-accent"] = { accent: "#ff5500", dark: false };
  settings.set({ ...settings.get(), themes: { ...settings.get().themes, id: "system", design: "material" } });
  const store = (await import("./store.ts")) as typeof import("./store");
  const primary = (accent: string, dark: boolean) => resolveMaterial(systemTheme({ accent, dark })!).vars["--color-primary"];
  store.startThemes();
  // An orange seed on the light side, not Light's blue.
  assert.equal(dataset.theme, "light");
  assert.equal(vars["--color-primary"], primary("#ff5500", false));
  assert.notEqual(vars["--color-primary"], "#415e91");
  answer({ accent: "#0078d4", dark: true });
  await settle();
  assert.equal(dataset.theme, "dark");
  assert.equal(vars["--color-primary"], primary("#0078d4", true));
  assert.deepEqual(stores["system-accent"].get(), { accent: "#0078d4", dark: true });
  assert.equal(store.systemFile.get()?.colors.accent, "#0078d4");
  // A change the system reports later.
  accentEvent({ accent: "#ff5500", dark: false });
  assert.equal(dataset.theme, "light");
  assert.equal(vars["--color-primary"], primary("#ff5500", false));
  // Back to Light in the Crest style, where the next test starts.
  settings.set({ ...settings.get(), themes: { ...settings.get().themes, id: "light", design: "crest" } });
});

test("apply() draws again when the Style or the system's contrast changes, and the closed notch's ink and the row's widths follow the Style", async () => {
  const store = (await import("./store.ts")) as typeof import("./store");
  store.startThemes();
  const seen = () => [dataset.design, design.get(), motion, vars["--color-notch"], vars["--color-primary"], store.darkInk()["--color-notch"], store.darkInk()["--color-primary"], vars["--font-sans"], family, spacing, tabular];
  // Light in the Crest style; the black closed notch keeps Dark's ink, and the row measures as before.
  const crest = ["crest", "crest", "crest", "#fafafc", "#1d1d1f", "#000000", "rgb(255 255 255 / 0.96)", FONTS.inter, FONTS.inter, 0.11, false];
  assert.deepEqual(seen(), crest);
  // Light's seed: a light panel, and on the closed notch the dark scheme of the same seed. Captions without tracking, tabular text from the page.
  pick("material");
  const gsf = fontStack("auto", "material");
  assert.deepEqual(seen(), ["material", "material", "material", "#f9f9ff", "#415e91", "#111318", "#aac7ff", gsf, gsf, 0, true]);
  more.matches = true;
  more.change();
  assert.deepEqual(seen(), ["material", "material", "material", "#f9f9ff", "#042b5b", "#111318", "#ebf0ff", gsf, gsf, 0, true]);
  pick("crest");
  assert.deepEqual(seen(), crest);
  // A font picked by name keeps its stack in both styles, and the tracking and the tabular widths still follow the Style.
  settings.set({ ...settings.get(), themes: { ...settings.get().themes, font: "georgia" } });
  pick("material");
  assert.deepEqual(seen().slice(7), [FONTS.georgia, FONTS.georgia, 0, true]);
  pick("crest");
  assert.deepEqual(seen().slice(7), [FONTS.georgia, FONTS.georgia, 0.11, false]);
});

test("the notch alone tells the settings window its background, and only when --color-notch changes", async () => {
  const store = (await import("./store.ts")) as typeof import("./store");
  const theme = (id: string) => settings.set({ ...settings.get(), themes: { ...settings.get().themes, id } });
  store.startThemes();
  pick("material");
  theme("dark");
  assert.deepEqual(backgrounds, []);
  beNotch(true);
  theme("light");
  assert.deepEqual(backgrounds, [vars["--color-notch"]]);
  // More contrast draws again with a new primary on the same background: nothing new to send.
  const primary = vars["--color-primary"];
  more.matches = !more.matches;
  more.change();
  assert.notEqual(vars["--color-primary"], primary);
  assert.equal(backgrounds.length, 1);
  theme("dark");
  assert.equal(backgrounds.length, 2);
  assert.notEqual(backgrounds[1], backgrounds[0]);
  assert.equal(backgrounds[1], vars["--color-notch"]);
  beNotch(false);
});

test("a crossfade draws in its callback, and one that runs after a newer apply() leaves that one on screen", async () => {
  const store = (await import("./store.ts")) as typeof import("./store");
  store.startThemes();
  settings.set({ ...settings.get(), themes: { ...settings.get().themes, font: "auto" } });
  pick("crest");
  const crestNotch = vars["--color-notch"];
  const pending: (() => void)[] = [];
  let finish = () => {};
  Object.assign(document, {
    startViewTransition(update: () => void) {
      pending.push(update);
      return { finished: new Promise<void>((done) => (finish = done)) };
    },
  });
  crossfades = true;
  pick("material");
  // Nothing drawn until the engine calls back, and the colours' blend is off meanwhile.
  assert.equal(dataset.design, "crest");
  assert.equal(dataset.designSwitching, "");
  pending.shift()!();
  assert.equal(dataset.design, "material");
  // The font follows the Style drawn in the callback: Google Sans Flex, captions without tracking, tabular text from the page.
  const gsf = fontStack("auto", "material");
  assert.deepEqual([vars["--font-sans"], family, spacing, tabular], [gsf, gsf, 0, true]);
  finish();
  await settle();
  assert.equal("designSwitching" in dataset, false);
  // And back to Crest through a crossfade too.
  pick("crest");
  pending.shift()!();
  assert.equal(dataset.design, "crest");
  assert.deepEqual([vars["--font-sans"], family, spacing, tabular], [FONTS.inter, FONTS.inter, 0.11, false]);
  finish();
  await settle();
  // Material, then back to Crest before the engine calls back: Crest draws at once, and the late callback must not bring Material back.
  pick("material");
  pick("crest");
  pending.forEach((update) => update());
  assert.equal(dataset.design, "crest");
  assert.equal(vars["--color-notch"], crestNotch);
  crossfades = false;
});

test("an older crossfade that ends while a newer one runs leaves the colours' blend off", async () => {
  const store = (await import("./store.ts")) as typeof import("./store");
  store.startThemes();
  crossfades = false;
  pick("crest");
  const pending: (() => void)[] = [];
  const finishes: (() => void)[] = [];
  Object.assign(document, {
    startViewTransition(update: () => void) {
      pending.push(update);
      return { finished: new Promise<void>((done) => finishes.push(done)) };
    },
  });
  crossfades = true;
  // Crest, Material, Crest, Material in quick succession: each change starts its crossfade before the last one has ended.
  pick("material");
  pending.shift()!();
  pick("crest");
  pending.shift()!();
  pick("material");
  pending.shift()!();
  assert.equal(finishes.length, 3);
  finishes[0]();
  finishes[1]();
  await settle();
  assert.equal(dataset.designSwitching, "");
  finishes[2]();
  await settle();
  assert.equal("designSwitching" in dataset, false);
  crossfades = false;
});
