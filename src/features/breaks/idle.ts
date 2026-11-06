import { invoke } from "@tauri-apps/api/core";
import { isNative } from "../../platform/native";

/** Page input, for the browser build only (see below). */
let lastInput = Date.now();
let listening = false;

/**
 * Seconds since the user's last keyboard or mouse input (src-tauri/src/idle.rs), null when it cannot be read.
 * In the browser there is no desktop to ask, so the page's own pointer and keys stand in for it.
 */
export async function idleSeconds(): Promise<number | null> {
  if (isNative) {
    try {
      return await invoke<number>("idle_seconds");
    } catch {
      return null;
    }
  }
  if (!listening) {
    listening = true;
    for (const type of ["pointermove", "pointerdown", "keydown", "wheel"]) window.addEventListener(type, () => (lastInput = Date.now()), { passive: true });
  }
  return Math.floor((Date.now() - lastInput) / 1000);
}
