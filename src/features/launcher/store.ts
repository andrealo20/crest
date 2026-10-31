import { useEffect } from "react";
import { createStore } from "../../lib/store";
import { launcher } from "../../platform/services";
import { settings, updateSettings } from "../../settings/store";
import { detectAi, mergeApps, type LauncherApp } from "./apps";
import { shortcutIds } from "./shortcuts";

/** The merged app list; null until it was read once (on first open of the tool or its settings). */
export const launcherApps = createStore<{ apps: LauncherApp[] | null; loading: boolean }>({ apps: null, loading: false });

/** Icons by id (PNG data URL, null = none). Rust caches them too. */
export const launcherIcons = createStore<Record<string, string | null>>({});

/** Rust's answer to the last key registration: which slots Windows gave. */
export const shortcutResult = createStore<{ ids: string[]; ok: boolean[] } | null>(null);

let loading: Promise<void> | null = null;

export function loadApps(refresh = false): Promise<void> {
  if (loading) return loading;
  if (launcherApps.get().apps && !refresh) return Promise.resolve();
  launcherApps.set((s) => ({ ...s, loading: true }));
  loading = launcher
    .apps(refresh)
    .then((raw) => {
      const apps = mergeApps(raw);
      launcherApps.set({ apps, loading: false });
      // First list ever: pin the AI apps found, so the tool and Alt+1..6 work right away.
      if (settings.get().launcher.favorites === null) {
        updateSettings((s) => ({ launcher: { ...s.launcher, favorites: detectAi(apps).map((a) => ({ id: a.id, name: a.name })) } }));
      }
    })
    .catch(() => launcherApps.set((s) => ({ ...s, loading: false })))
    .finally(() => (loading = null));
  return loading;
}

/** Fetches the icons of these ids that are not known yet. */
export function useIcons(ids: string[]) {
  const key = ids.join("\n");
  useEffect(() => {
    const known = launcherIcons.get();
    const missing = ids.filter((id) => !(id in known));
    if (!missing.length) return;
    void launcher.icons(missing).then((icons) => launcherIcons.set((s) => ({ ...s, ...icons })), () => {});
  }, [key]);
  return launcherIcons.use();
}

let lastKeys: string | null = null;

/** Keeps Alt+1..6 registered for the first six favourites while the tool is on and the switch is set. */
function syncShortcuts() {
  const s = settings.get();
  const toolOn = s.tools.some((t) => t.id === "launcher" && t.enabled);
  const ids = shortcutIds(s.launcher.favorites ?? [], s.launcher.shortcuts && toolOn);
  const key = ids.join("\n");
  if (key === lastKeys) return;
  lastKeys = key;
  void launcher.shortcuts(ids).then((ok) => {
    if (lastKeys === key) shortcutResult.set({ ids, ok });
  }, () => {});
}

export function startLauncher() {
  // Never seeded: read the list once now, so the detected AI apps sit on Alt+1..6 without opening the tool.
  if (settings.get().launcher.favorites === null) void loadApps();
  syncShortcuts();
  settings.subscribe(syncShortcuts);
}
