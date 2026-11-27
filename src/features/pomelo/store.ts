import { createStore } from "../../lib/store";
import { isMac, isNative } from "../../platform/native";
import { pomeloWheel } from "../../platform/services";
import { settings } from "../../settings/store";
import { language, t } from "../../i18n";
import { engineLang } from "../files/model";
import { engine } from "../files/store";
import { defaultsOf, parseSchema, valuesOf, type SchemaPage, type WheelState } from "./model";

/*
 * The Pomelo wheel's state outside its pages: the switch sent from the notch, the wheel's state as Rust reports it, and the
 * settings schema with its values, read only once the Pomelo scope (or the settings search) asks for them.
 */

/** Windows only (the Store build too, with the package inside its own); in the browser while developing and in the site's demo, on src/dev/pomelo-sample.ts. */
export const pomeloOffered = !isMac && (isNative || import.meta.env.DEV || import.meta.env.MODE === "demo");

export const wheelState = createStore<WheelState>({ phase: "off", locked: false });

let following = false;
/** Keeps `wheelState` up to date in this window. */
export function followWheel() {
  if (following) return;
  following = true;
  pomeloWheel.onState(wheelState.set);
  void pomeloWheel.state().then(wheelState.set).catch(() => {});
}

/** In the notch (main.tsx): starts the wheel when the switch is on at start, then follows the switch. Nothing runs while it is off. */
export function startPomeloWheel() {
  if (!pomeloOffered || !isNative) return;
  let sent = false;
  const apply = () => {
    const on = settings.get().pomelo.wheel;
    if (on === sent) return;
    sent = on;
    void pomeloWheel.set(on, engineLang(language.get())).catch(() => {});
  };
  apply();
  settings.subscribe(apply);
}

/** The schema's pages and the saved values, null until loaded; `failed` when the engine could not give them. */
export const schema = createStore<{ pages: SchemaPage[]; defaults: Record<string, unknown>; failed: boolean } | null>(null);
export const pomeloValues = createStore<Record<string, unknown>>({});

let loadedFor = "";
/** Asks the engine for the schema in `lang` (once per language and package) and for the values. */
export function loadSchema(lang: string) {
  const status = engine.get();
  if (!status?.wheel) return;
  const key = `${lang}|${status.version}`;
  if (loadedFor === key) return;
  loadedFor = key;
  Promise.all([pomeloWheel.settings("schema", { lang: engineLang(lang) }), pomeloWheel.settings("get")])
    .then(([answer, values]) => {
      const pages = parseSchema(answer);
      schema.set({ pages, defaults: defaultsOf(pages), failed: false });
      pomeloValues.set(valuesOf(values));
    })
    .catch(() => {
      loadedFor = "";
      schema.set({ pages: [], defaults: {}, failed: true });
    });
}

/** After a removal: nothing of the old package stays on screen. */
export function forgetSchema() {
  loadedFor = "";
  schema.set(null);
  pomeloValues.set({});
}

/**
 * Writes one setting through the engine, which checks it; the error to show, null once saved. `reload`: the engine may have changed
 * other values with it (a key moved between tabs), so all are read again.
 */
export async function setPomeloValue(key: string, value: unknown, reload = false): Promise<string | null> {
  const had = key in pomeloValues.get(), was = pomeloValues.get()[key];
  if (!reload) pomeloValues.set((v) => ({ ...v, [key]: value }));
  // Only this key goes back: another row changed meanwhile keeps its value.
  const undo = () =>
    pomeloValues.set((v) => {
      const next = { ...v };
      if (had) next[key] = was;
      else delete next[key];
      return next;
    });
  let answer: { ok?: boolean; error?: string; message?: string } | null;
  try {
    answer = (await pomeloWheel.settings("set", { key, value })) as typeof answer;
  } catch {
    undo();
    return t("Wird nicht angenommen");
  }
  if (!answer?.ok) {
    undo();
    // The engine's message says what it expects (in English); its code alone says nothing to the user.
    return answer?.message || t("Wird nicht angenommen");
  }
  if (reload) await reloadPomeloValues();
  return null;
}

/** Reads every value again (once the schema is loaded): after a change that moves others, or Pomelo's own window. */
export async function reloadPomeloValues() {
  if (!schema.get()?.pages.length) return;
  try {
    pomeloValues.set(valuesOf(await pomeloWheel.settings("get")));
  } catch {
    // The values on screen stay.
  }
}
