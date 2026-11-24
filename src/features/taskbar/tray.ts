import { createStore, type Store } from "../../lib/store";
import { isNative } from "../../platform/native";
import { taskbar } from "../../platform/services";
import type { TrayState } from "./model";
import type { Decor } from "./decorModel";
import { plainWhite } from "./trayModel";

/** In the bar's window: the tray's icons as Rust last listed them, none while it does not run. */
export const trayState = createStore<TrayState>({ icons: [] });
/** In the bar's window: the pictures fetched so far, by `TrayIcon.img`; a key Rust could not answer is not here, so it is asked again. */
export const trayPictures = createStore<Record<string, string>>({});

/** In the bar's window: which pictures of `trayPictures` are a plain white glyph (trayModel plainWhite), each read once. */
export const trayWhite = createStore<Record<string, boolean>>({});

/** In the bar's window: the bar has too little room even for the tray's kept icons, so they are back behind ^ and its panel lists every icon. */
export const trayFolded = createStore(false);

/** In every bar's window: the badges and progress apps report to the taskbar, by window id (taskband.rs), and their pictures. */
export const barDecor = createStore<Record<number, Decor>>({});
export const decorPictures = createStore<Record<string, string>>({});

/** Asks Rust for the pictures `wanted` lacks, once per key at a time, and drops those no longer wanted; returns the step to run on each change. */
function followPictures(wanted: () => Set<string>, pictures: Store<Record<string, string>>, fetch: (keys: string[]) => Promise<Record<string, string | null>>): () => void {
  const asked = new Set<string>();
  return () => fetchPictures(wanted(), pictures, fetch, asked);
}

function fetchPictures(wanted: Set<string>, pictures: Store<Record<string, string>>, fetch: (keys: string[]) => Promise<Record<string, string | null>>, asked: Set<string>) {
  const have = pictures.get();
  const keys = [...wanted].filter((k) => !(k in have) && !asked.has(k));
  if (Object.keys(have).some((k) => !wanted.has(k))) pictures.set((s) => Object.fromEntries(Object.entries(s).filter(([k]) => wanted.has(k))));
  if (!keys.length) return;
  for (const k of keys) asked.add(k);
  void fetch(keys).then(
    (found) => {
      for (const k of keys) asked.delete(k);
      // A null (the picture was replaced, as an animated icon does) is not kept: the next list brings the new key, or asks again.
      const got = Object.entries(found).flatMap(([k, v]) => (v !== null && wanted.has(k) ? [[k, v] as const] : []));
      if (got.length) pictures.set((s) => ({ ...s, ...Object.fromEntries(got) }));
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
  const fetch = followPictures(() => new Set(trayState.get().icons.flatMap((i) => i.img ?? [])), trayPictures, taskbar.trayImages);
  const stop = trayState.subscribe(fetch);
  fetch();
  return () => {
    off();
    stop();
  };
}

/**
 * Reads each picture of `trayPictures` once and notes in `trayWhite` whether it is a plain white glyph; returns the stop. Also in the
 * browser, where the dev sample's pictures stand in.
 */
export function followWhite(): () => void {
  const reading = new Set<string>();
  const read = () => {
    const pictures = trayPictures.get();
    const known = trayWhite.get();
    if (Object.keys(known).some((k) => !(k in pictures))) trayWhite.set((s) => Object.fromEntries(Object.entries(s).filter(([k]) => k in pictures)));
    for (const [key, url] of Object.entries(pictures)) {
      if (key in known || reading.has(key)) continue;
      reading.add(key);
      void pixels(url).then((rgba) => {
        reading.delete(key);
        // A picture that cannot be read keeps its own colours.
        if (key in trayPictures.get()) trayWhite.set((s) => ({ ...s, [key]: rgba !== null && plainWhite(rgba) }));
      });
    }
  };
  read();
  return trayPictures.subscribe(read);
}

/** A picture's pixels at its own size, or null when it cannot be read. */
async function pixels(url: string): Promise<Uint8ClampedArray | null> {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    return null;
  }
}

/** Follows the badges and progress Rust sends every bar, with their pictures, for the page's life. Not in the browser. */
export function startDecor() {
  if (!isNative) return;
  let fresh = false;
  const keep = (list: Decor[]) => barDecor.set(Object.fromEntries(list.map((d) => [d.id, d])));
  taskbar.onDecor((list) => {
    fresh = true;
    keep(list);
  });
  void taskbar.decor().then((list) => {
    if (!fresh) keep(list);
  }, () => {});
  const fetch = followPictures(() => new Set(Object.values(barDecor.get()).flatMap((d) => d.overlay ?? [])), decorPictures, taskbar.decorImages);
  barDecor.subscribe(fetch);
}
