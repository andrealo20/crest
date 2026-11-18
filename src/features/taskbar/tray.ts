import { createStore } from "../../lib/store";
import { isNative } from "../../platform/native";
import { taskbar } from "../../platform/services";
import type { TrayState } from "./model";

/** In the bar's window: the tray's icons as Rust last listed them, none while it does not run. */
export const trayState = createStore<TrayState>({ yielded: false, icons: [] });
/** In the bar's window: the pictures fetched so far, by `TrayIcon.img`; a key Rust could not answer is not here, so it is asked again. */
export const trayPictures = createStore<Record<string, string>>({});

const asked = new Set<string>();

/** Asks Rust for the pictures the icons now listed lack, once per key at a time, and drops those no icon shows any more. */
function fetchPictures() {
  const wanted = new Set(trayState.get().icons.flatMap((i) => i.img ?? []));
  const have = trayPictures.get();
  const keys = [...wanted].filter((k) => !(k in have) && !asked.has(k));
  if (Object.keys(have).some((k) => !wanted.has(k))) trayPictures.set((s) => Object.fromEntries(Object.entries(s).filter(([k]) => wanted.has(k))));
  if (!keys.length) return;
  for (const k of keys) asked.add(k);
  void taskbar.trayImages(keys).then(
    (found) => {
      for (const k of keys) asked.delete(k);
      // A null (the picture was replaced, as an animated icon does) is not kept: the next list brings the new key, or asks again.
      const got = Object.entries(found).flatMap(([k, v]) => (v !== null && wanted.has(k) ? [[k, v] as const] : []));
      if (got.length) trayPictures.set((s) => ({ ...s, ...Object.fromEntries(got) }));
    },
    () => {
      for (const k of keys) asked.delete(k);
    },
  );
}

/**
 * Follows Rust's list of the tray's icons and fetches their pictures; returns the stop. The bar runs it only while it draws the
 * tray, so a bar without one listens to nothing. Not in the browser, where the dev sample stands in (dev/barSample.ts).
 */
export function startTray(): () => void {
  if (!isNative) return () => {};
  let fresh = false;
  const off = taskbar.onTray((state) => {
    fresh = true;
    trayState.set(state);
  });
  // The list sent before this page loaded; a newer one may already be here.
  void taskbar.tray().then((state) => {
    if (!fresh) trayState.set(state);
  }, () => {});
  const stop = trayState.subscribe(fetchPictures);
  fetchPictures();
  return () => {
    off();
    stop();
  };
}
