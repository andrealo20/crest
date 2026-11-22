import { useEffect, useState } from "react";
import { createStore } from "../../lib/store";
import { isNotchWindow } from "../../lib/windowKind";
import { launcher } from "../../platform/services";
import { settings, updateSettings } from "../../settings/store";
import { fullscreen } from "../system/gaming";
import { insertPinned } from "../taskbar/model";
import { holdOpen } from "../../notch/useNotchState";
import { t } from "../../i18n";
import { detectAi, mergeApps, type Favorite, type LauncherApp } from "./apps";
import { hotkeysPaused, shortcutIds } from "./shortcuts";

/** The merged app list; null until it was read once (on first open of the tool). `readAt`: when it was last read without a failure, 0 before. */
export const launcherApps = createStore<{ apps: LauncherApp[] | null; loading: boolean; failed: boolean; readAt: number }>({ apps: null, loading: false, failed: false, readAt: 0 });

/** Icons by id (PNG data URL, null = none). Rust caches them too. */
export const launcherIcons = createStore<Record<string, string | null>>({});

/** Rust's answer to the last key registration: which slots Windows gave. */
export const shortcutResult = createStore<{ ids: string[]; ok: boolean[] } | null>(null);

/** Alt+N is switched on but rests right now (fullscreen app or gaming mode). */
export const hotkeysResting = createStore(false);

/** A launch that failed, shown under the tiles for a few seconds. */
export const launchError = createStore<string | null>(null);
let errorTimer = 0;

export function showLaunchError(id: string, code: unknown) {
  const name = settings.get().launcher.favorites?.find((f) => f.id === id)?.name ?? id;
  launchError.set(t(code === "not-found" ? "{name} ist nicht mehr installiert" : "{name} startet nicht", { name }));
  window.clearTimeout(errorTimer);
  errorTimer = window.setTimeout(() => launchError.set(null), 5000);
}

/** Pins apps Rust made of their files at the end, each once; one already pinned stays where it is. */
async function pinApps(apps: Favorite[]) {
  // Not seeded yet: the first list pins the AI apps before these, or it never would (it only seeds while favorites is null).
  // shortcut: after a failed first read the AI apps are not seeded any more; a "seeded" flag in settings would keep them for a later read.
  if (settings.get().launcher.favorites === null) await loadApps();
  updateSettings((s) => ({ launcher: { ...s.launcher, favorites: insertPinned(s.launcher.favorites ?? [], apps, null) } }));
}

/** Asks for an app's file and pins it: true when one was pinned, false when cancelled. Errors: unknown (no app on this PC). */
export async function addAppFromFile(): Promise<boolean> {
  // The picker takes the pointer off the notch; it stays open meanwhile.
  holdOpen(true);
  try {
    const app = await launcher.addFile();
    if (app) await pinApps([app]);
    return app !== null;
  } finally {
    holdOpen(false);
  }
}

let loading: Promise<void> | null = null;

export function loadApps(refresh = false): Promise<void> {
  if (loading) return loading;
  if (launcherApps.get().apps && !refresh) return Promise.resolve();
  launcherApps.set((s) => ({ ...s, loading: true }));
  loading = launcher
    .apps(refresh)
    .then((raw) => {
      const apps = mergeApps(raw);
      launcherApps.set({ apps, loading: false, failed: false, readAt: Date.now() });
      // First list ever: pin the AI apps found. An empty list is a failed read, not "nothing installed". The notch only.
      if (isNotchWindow && settings.get().launcher.favorites === null && raw.length > 0) {
        updateSettings((s) => ({ launcher: { ...s.launcher, favorites: detectAi(apps).map((a) => ({ id: a.id, name: a.name })) } }));
      }
    })
    .catch(() => launcherApps.set((s) => ({ ...s, loading: false, failed: true })))
    .finally(() => (loading = null));
  return loading;
}

/** Ids asked of Rust whose answer has not come yet, not asked again meanwhile: overlapping calls would make the shell extract the same icons twice. */
const asking = new Set<string>();
/** The waits before asking again after a failed call: the Start list's own (taskbar/mod.rs `START_LIST`), as a sign-in's first read of it can fail. */
const RETRY_MS = [5000, 20000, 60000];

/** Fetches the icons of these ids that are not known yet, and again after a call that failed (`RETRY_MS`). */
export function useIcons(ids: string[]) {
  const key = ids.join("\n");
  // How often the effect has asked again since a call last worked; in its deps, so a bump asks again.
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const known = launcherIcons.get();
    const missing = ids.filter((id) => !(id in known) && !asking.has(id));
    if (!missing.length) return;
    for (const id of missing) asking.add(id);
    let timer = 0;
    void launcher
      .icons(missing)
      .then(
        (icons) => {
          launcherIcons.set((s) => ({ ...s, ...icons }));
          if (retry) setRetry(0);
        },
        // Armed even after this run's cleanup: the run that followed skipped these ids while they were in flight.
        () => {
          if (retry < RETRY_MS.length) timer = window.setTimeout(() => setRetry(retry + 1), RETRY_MS[retry]);
        },
      )
      .finally(() => missing.forEach((id) => asking.delete(id)));
    return () => window.clearTimeout(timer);
  }, [key, retry]);
  return launcherIcons.use();
}

let lastKeys: string | null = null;

/** Keeps Alt+1..6 registered for the first six favourites while opted in, the tool is on, and no fullscreen app or gaming mode needs the keys. */
function syncShortcuts() {
  const s = settings.get();
  const toolOn = s.tools.some((x) => x.id === "launcher" && x.enabled);
  const resting = s.launcher.hotkeys && toolOn && hotkeysPaused(s.gaming.mode, fullscreen.get());
  if (resting !== hotkeysResting.get()) hotkeysResting.set(resting);
  const ids = shortcutIds(s.launcher.favorites ?? [], s.launcher.hotkeys && toolOn && !resting);
  const key = ids.join("\n");
  if (key === lastKeys) return;
  lastKeys = key;
  void launcher.shortcuts(ids).then((ok) => {
    if (lastKeys === key) shortcutResult.set({ ids, ok });
  }, () => {});
}

export function startLauncher() {
  syncShortcuts();
  settings.subscribe(syncShortcuts);
  fullscreen.subscribe(syncShortcuts);
  // A hotkey whose app did not start: Rust opens the notch on this tool, the message says why.
  launcher.onMissing(showLaunchError);
  // Exes and shortcuts dropped on the open Launcher, pinned by Rust.
  launcher.onPinned((apps) => void pinApps(apps));
}
