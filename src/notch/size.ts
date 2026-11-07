import { createStore } from "../lib/store";
import { PANEL_MAX } from "../features/window/panelSize";

/*
 * A tool can change its open size at runtime (e.g. the image preview in the
 * clipboard). The notch then morphs there with a spring; `null` = default size
 * from tabs.ts. Only applies while that tool is active.
 */
export const sizeOverride = createStore<{ tabId: string; w: number; h: number } | null>(null);

/** Maximum usable area in the window (tauri.conf.json: 760 × 560). */
export const MAX_SIZE = PANEL_MAX;

/** `null` drops only `tabId`'s own request: a tool leaving runs its cleanup after the next one has asked for its size. */
export function requestSize(tabId: string, size: { w: number; h: number } | null) {
  if (!size && sizeOverride.get()?.tabId !== tabId) return;
  sizeOverride.set(
    size ? { tabId, w: Math.min(MAX_SIZE.w, Math.round(size.w)), h: Math.min(MAX_SIZE.h, Math.round(size.h)) } : null,
  );
}

/*
 * A tool can also grow by some height below what the user sized it to (the Music tool's lyrics, mixer or player list).
 * Unlike sizeOverride the user's size stays the base: the grips still resize it, and the extra rides on top.
 */
export const sizeExtra = createStore<{ tabId: string; h: number } | null>(null);

/** 0 drops only `tabId`'s own request, as requestSize does. */
export function requestExtra(tabId: string, h: number) {
  if (h > 0) sizeExtra.set({ tabId, h: Math.round(h) });
  else if (sizeExtra.get()?.tabId === tabId) sizeExtra.set(null);
}
