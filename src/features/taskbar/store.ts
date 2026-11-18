import { createStore } from "../../lib/store";
import { isMac, isNative } from "../../platform/native";
import { taskbar } from "../../platform/services";
import { settings, updateSettings } from "../../settings/store";
import { normalizeFavorites } from "../launcher/apps";
import type { WindowList } from "./model";

/** In the bar's window: the open windows grouped by app, as Rust last sent them. */
export const barWindows = createStore<WindowList>({ groups: [], active: null });
/** In the bar's window: icons of the groups without an entry (the launcher has none for them), by group key; null = none. */
export const groupIcons = createStore<Record<string, string | null>>({});

/**
 * The notch applies the bar's on/off, height and hiding to Rust, the only window that does: as saved when Crest starts, then on every
 * change of each. The first time the bar is on and its pinned list was never filled, the notch fills it with Windows' pinned apps.
 */
export function startTaskbar() {
  if (!isNative || isMac) return;
  let last = "";
  let hides: boolean | null = null;
  let queue = Promise.resolve();
  let seeded = false;
  const sync = () => {
    const { enabled, height, pinned, autoHide } = settings.get().taskbar;
    // Outside the queue: a flag the display poll reads, which never waits for a bar to be built or taken down.
    if (autoHide !== hides) {
      hides = autoHide;
      void taskbar.autoHide(autoHide);
    }
    // One try per start: a failed read leaves the list to the next start, and an app pinned meanwhile is never overwritten.
    if (enabled && pinned === null && !seeded) {
      seeded = true;
      void taskbar.importPins().then((apps) => {
        if (settings.get().taskbar.pinned === null) updateSettings((s) => ({ taskbar: { ...s.taskbar, pinned: normalizeFavorites(apps) } }));
      }, () => {});
    }
    const key = `${enabled}|${height}`;
    if (key === last) return;
    last = key;
    // One change at a time, in their order: Rust finishes each (an Off once its window is gone) before the next is sent, after a
    // failed one too.
    const apply = () => taskbar.apply(enabled, height);
    queue = queue.then(apply, apply);
  };
  sync();
  settings.subscribe(sync);
}

/** The bar's entry only: follows Rust's list as the mirror follows its picture (src/mirror/main.ts), and fetches the icons it lacks. */
export function startBarWindows() {
  let fresh = false;
  taskbar.onWindows((list) => {
    fresh = true;
    barWindows.set(list);
  });
  // The list sent before this page loaded; a newer one may already be here.
  void taskbar.windows().then((list) => {
    if (!fresh) barWindows.set(list);
  });
  barWindows.subscribe(fetchGroupIcons);
}

const asked = new Set<string>();

/** Asks Rust once per group key, even while the list changes faster than it answers. */
function fetchGroupIcons() {
  const keys = barWindows.get().groups.filter((g) => !g.pins.length && !asked.has(g.key)).map((g) => g.key);
  if (!keys.length) return;
  for (const key of keys) asked.add(key);
  void taskbar.icons(keys).then(
    (icons) => {
      // A key Rust leaves out (a group it no longer lists) is asked again when the group comes back.
      for (const key of keys) if (!(key in icons)) asked.delete(key);
      groupIcons.set((s) => ({ ...s, ...icons }));
    },
    () => {},
  );
}
