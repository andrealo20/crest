import { followStores } from "../../lib/bridge";
import { createStore } from "../../lib/store";
import { listening, tauriTransport } from "../../lib/tauriTransport";
import { isMac, isNative } from "../../platform/native";
import { taskbar } from "../../platform/services";
import { settings, updateSettings } from "../../settings/store";
import { normalizeFavorites } from "../launcher/apps";
import { feedStores, panelStores } from "./barStores";
import { trayWanted, type TaskbarSettings, type WindowList } from "./model";

/** In the bar's window: the open windows grouped by app, as Rust last sent them. */
export const barWindows = createStore<WindowList>({ groups: [], active: null });
/** In the bar's window: icons of the groups without an entry (the launcher has none for them), by group key; null = none. */
export const groupIcons = createStore<Record<string, string | null>>({});
/** In the bar's window: whether this bar shows (followBar); its widgets rest and its glass stops while it does not. */
export const barShown = createStore(true);

/** A change to the bar's settings, from the Taskbar pages and their widget rows; the notch applies on/off and the height to Rust (startTaskbar), the bar reads the rest itself. */
export function setTaskbar(patch: Partial<TaskbarSettings> | ((cur: TaskbarSettings) => Partial<TaskbarSettings>)) {
  updateSettings((s) => ({ taskbar: { ...s.taskbar, ...(typeof patch === "function" ? patch(s.taskbar) : patch) } }));
}

/**
 * The notch applies the bar's on/off, height, docking and hiding to Rust, the only window that does: as saved when Crest starts, then
 * on every change of any. The first time the bar is on and its pinned list was never filled, the notch fills it with Windows' pinned apps.
 */
export function startTaskbar() {
  if (!isNative || isMac) return;
  let last = "";
  let hides: boolean | null = null;
  let tray: boolean | null = null;
  let queue = Promise.resolve();
  let seeded = false;
  const sync = () => {
    const { enabled, height, shape, pinned, autoHide } = settings.get().taskbar;
    const wantTray = trayWanted(settings.get().taskbar);
    // Outside the queue: a flag the display poll reads, which never waits for a bar to be built or taken down.
    if (autoHide !== hides) {
      hides = autoHide;
      void taskbar.autoHide(autoHide);
    }
    // Likewise: Rust starts the spy only while a bar shows the tray and stops it, giving Explorer every icon back, otherwise.
    if (wantTray !== tray) {
      tray = wantTray;
      void taskbar.trayOn(wantTray).catch(() => {});
    }
    // One try per start: a failed read leaves the list to the next start, and an app pinned meanwhile is never overwritten.
    if (enabled && pinned === null && !seeded) {
      seeded = true;
      void taskbar.importPins().then((apps) => {
        if (settings.get().taskbar.pinned === null) updateSettings((s) => ({ taskbar: { ...s.taskbar, pinned: normalizeFavorites(apps) } }));
      }, () => {});
    }
    // A docked bar takes no gaps off the work area; the other shapes differ only in the bar's page.
    const docked = shape === "docked";
    const key = `${enabled}|${height}|${docked}`;
    if (key === last) return;
    last = key;
    // One change at a time, in their order: Rust finishes each (an Off once its window is gone) before the next is sent, after a
    // failed one too.
    const apply = () => taskbar.apply(enabled, height, docked);
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

/**
 * The bar's entry: follows whether this bar shows (Rust tells each bar its own), on every monitor, since a hidden bar's glass must
 * stop; the primary also follows the notch's stores (barStores.ts). The hello goes through Rust, as the bar may not emit, and only the
 * primary's has the notch send them.
 */
export function followBar(primary: boolean) {
  let heard = false;
  taskbar.onShown((on) => {
    heard = true;
    barShown.set(on);
  });
  const hello = () =>
    void listening()
      .then(() => taskbar.hello())
      .then((on) => {
        // A change heard while the hello was on its way is newer than its answer.
        if (!heard) barShown.set(on);
      }, () => {});
  if (primary) followStores(tauriTransport, { ...feedStores, ...panelStores }, hello);
  else hello();
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
