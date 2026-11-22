import { createStore } from "../../lib/store";
import { isNative } from "../../platform/native";
import { taskbar, type InputLang } from "../../platform/services";

/** In the bar's window: the input language Rust last sent, null with one keyboard layout (Windows then shows none either). */
export const inputLang = createStore<InputLang | null>(null);

/**
 * Follows the input language while the bar draws its button; returns the stop. Not in the browser, where the dev sample stands in
 * (dev/barSample.ts).
 */
export function startInput(): () => void {
  if (!isNative) return () => {};
  let fresh = false;
  const off = taskbar.onInput((lang) => {
    fresh = true;
    inputLang.set(lang);
  });
  // The language before this page listened; a newer one may already be here.
  void taskbar.input().then((lang) => {
    if (!fresh) inputLang.set(lang);
  }, () => {});
  return off;
}
