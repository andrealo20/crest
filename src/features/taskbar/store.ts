import { followStores } from "../../lib/bridge";
import { createStore } from "../../lib/store";
import { listening, tauriTransport } from "../../lib/tauriTransport";
import { isMac, isNative } from "../../platform/native";
import { taskbar } from "../../platform/services";
import { settings } from "../../settings/store";
import { feedStores, panelStores } from "./barStores";
import type { WindowList } from "./model";

/** In the bar's window: the open windows grouped by app, as Rust last sent them. */
export const barWindows = createStore<WindowList>({ groups: [], active: null });
/** In the bar's window: icons of the groups without an entry (the launcher has none for them), by group key; null = none. */
export const groupIcons = createStore<Record<string, string | null>>({});
/** In the bar's window: whether the bar shows; its widgets rest while it does not. */
export const barShown = createStore(true);

/** The notch applies the bar's on/off and height to Rust, the only window that does: as saved when Crest starts, then on every change of either. */
export function startTaskbar() {
  if (!isNative || isMac) return;
  let last = "";
  let queue = Promise.resolve();
  const sync = () => {
    const { enabled, height } = settings.get().taskbar;
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

/** The bar's entry only: follows the notch's stores (barStores.ts) and whether the bar shows. The hello goes through Rust, as the bar may not emit. */
export function followNotch() {
  let heard = false;
  taskbar.onShown((on) => {
    heard = true;
    barShown.set(on);
  });
  followStores(tauriTransport, { ...feedStores, ...panelStores }, () =>
    void listening()
      .then(() => taskbar.hello())
      .then((on) => {
        // A change heard while the hello was on its way is newer than its answer.
        if (!heard) barShown.set(on);
      }, () => {}),
  );
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
