// The wallpaper every window follows (Rust's `wallpaper://changed`), the changes through the chosen source and the automatic change.

import { useEffect } from "react";
import { t } from "../../i18n";
import { createStore } from "../../lib/store";
import { isNative } from "../../platform/native";
import { wallpapers, type WallNow, type WallScreen } from "../../platform/services";
import { settings } from "../../settings/store";
import { COLLECTION } from "./collection";
import { baseName, dueIn } from "./model";
import { THUMBS } from "./thumbs";

/** The screens' wallpapers, from the first window that follows them (followWall) on. */
export const wallNow = createStore<WallNow | null>(null);

let followers = 0;
let unlisten: (() => void) | null = null;

/** Follows the wallpaper while anyone does: the first follower reads it and listens, the last one's stop stops listening. */
export function followWall(): () => void {
  if (followers++ === 0) {
    unlisten = wallpapers.onChanged((now) => wallNow.set(now));
    void wallpapers.current().then((now) => wallNow.set(now), () => {});
  }
  return () => {
    if (--followers === 0) {
      unlisten?.();
      unlisten = null;
    }
  };
}

/** The wallpaper, followed while the calling component is mounted. */
export function useWallNow(): WallNow | null {
  useEffect(followWall, []);
  return wallNow.use();
}

/** The screen a choice is for: the main one for every screen (`id` null), the first if none says it is the main one. */
export const screenOf = (now: WallNow | null, id: string | null): WallScreen | null =>
  now?.screens.find((s) => (id === null ? s.primary : s.id === id)) ?? (id === null ? (now?.screens[0] ?? null) : null);

/** A screen's picture as a small image: the bundled thumbnail of Crest's own, else the one Rust made of the main screen's. */
export const thumbOf = (now: WallNow | null, screen: WallScreen | null): string | null =>
  screen ? (screen.crest ? (THUMBS[screen.crest] ?? null) : screen.primary ? (now?.thumb ?? null) : null) : null;

/** Who a screen's picture is by: the photographer on Unsplash, "source unknown", or a folder's file name; null without a picture. */
export function creditOf(screen: WallScreen | null): string | null {
  if (!screen?.path) return null;
  if (screen.crest) {
    const author = COLLECTION.find((p) => p.id === screen.crest)?.author;
    return author ? t("Foto: {name} auf Unsplash", { name: author }) : t("Quelle unbekannt");
  }
  return baseName(screen.path);
}

/** When the wallpaper last changed through Crest, saved so a daily change survives a restart; each window's change resets the wait. */
export const wallShow = createStore<{ at: number }>({ at: 0 }, { persist: "wallpaper-show" });

const changed = () => wallShow.set({ at: Date.now() });

/** A picture of the collection or a file on one screen, or every screen with `screen` null, with the saved fit. */
export async function setWallpaper(pick: { crest?: string; path?: string }, screen: string | null): Promise<void> {
  await wallpapers.set(pick, screen, settings.get().wallpapers.fit);
  changed();
}

/** The next (1) or the previous (-1) picture of the source on every screen; rejects when there is none to step to. */
export async function stepWallpaper(by: 1 | -1): Promise<void> {
  const { source, folder, fit } = settings.get().wallpapers;
  await wallpapers.step(by, source, folder, fit);
  changed();
}

/**
 * The automatic change, run by the notch on Windows and on a Mac. It never waits more than a minute at a time, so a PC back from
 * sleep catches up. A change that fails also restarts the wait: offline, the next try comes an interval later, not every minute.
 */
export function startWallpaperShow(): void {
  if (!isNative) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stepping = false;
  const tick = () => {
    clearTimeout(timer);
    const due = dueIn(wallShow.get().at, settings.get().wallpapers.every, Date.now());
    if (due === null || stepping) return;
    if (due > 0) {
      timer = setTimeout(tick, Math.min(due, 60_000));
      return;
    }
    stepping = true;
    void stepWallpaper(1)
      .catch(changed)
      .finally(() => {
        stepping = false;
        tick();
      });
  };
  settings.subscribe(tick);
  wallShow.subscribe(tick);
  tick();
}
