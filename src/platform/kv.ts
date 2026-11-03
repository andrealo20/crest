import { invoke } from "@tauri-apps/api/core";
import { isNative } from "./native";

// localStorage is only a cache of Crest's own file (src-tauri/src/kv.rs): WebView2 has opened an empty one beside the
// real one, and Crest then started on its defaults.

let on = false;
const pending = new Map<string, number>();

/** Before the app's modules load (they read localStorage then): fills it from the file, and saves into the file what
 *  only localStorage has (the first start of this version, or a store the file has not seen yet). */
export async function restoreStorage(): Promise<void> {
  if (!isNative) return;
  try {
    const saved = await invoke<Record<string, string>>("kv_load");
    for (const [key, value] of Object.entries(saved)) {
      if (localStorage.getItem(key) !== value) localStorage.setItem(key, value);
    }
    on = true;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = key && localStorage.getItem(key);
      if (key?.startsWith("notch:") && value !== null && !(key in saved)) saveKey(key, value);
    }
  } catch (e) {
    // The file could not be read: run on localStorage alone, as before.
    console.error("kv_load", e);
  }
}

/** Mirrors one store into the file, at most every 400 ms per key (the scratchpad saves on every keystroke).
 *  shortcut: a change in the last 400 ms before a quit stays in localStorage only, fine for a typed character. */
export function saveKey(key: string, value: string) {
  if (!on) return;
  clearTimeout(pending.get(key));
  pending.set(
    key,
    window.setTimeout(() => {
      pending.delete(key);
      invoke("kv_set", { key, value }).catch((e) => console.error("kv_set", key, e));
    }, 400),
  );
}
