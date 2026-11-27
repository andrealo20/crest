import { createStore } from "../../lib/store";
import { isMac, isNative } from "../../platform/native";
import { pomeloWheel } from "../../platform/services";
import { storeBuild } from "../../platform/storeBuild";
import { settings } from "../../settings/store";
import { language, t } from "../../i18n";
import { engineLang } from "../files/model";
import { engine } from "../files/store";
import { defaultsOf, parseSchema, valuesOf, type SchemaPage, type WheelState } from "./model";

/*
 * The Pomelo wheel's state outside its pages: the switch sent from the notch, the wheel's state as Rust reports it, and the
 * settings schema with its values, read only once the Pomelo scope (or the settings search) asks for them.
 */

/** Windows only, never the Store build (policy 10.2.2); in the browser only while developing. */
export const pomeloOffered = !isMac && !storeBuild && (isNative || import.meta.env.DEV);

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

/** Writes one setting through the engine, which checks it; the error to show, null once saved. */
export async function setPomeloValue(key: string, value: unknown): Promise<string | null> {
  const before = pomeloValues.get();
  pomeloValues.set({ ...before, [key]: value });
  try {
    const answer = (await pomeloWheel.settings("set", { key, value })) as { ok?: boolean; error?: string } | null;
    if (answer?.ok) return null;
    pomeloValues.set(before);
    return answer?.error || t("Wird nicht angenommen");
  } catch {
    pomeloValues.set(before);
    return t("Wird nicht angenommen");
  }
}
