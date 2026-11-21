import { followStores } from "../../lib/bridge";
import { createStore } from "../../lib/store";
import { listening, tauriTransport } from "../../lib/tauriTransport";
import { isMac, isNative } from "../../platform/native";
import { status, taskbar } from "../../platform/services";
import { settings, updateSettings } from "../../settings/store";
import { normalizeFavorites } from "../launcher/apps";
import { feedStores, panelStores } from "./barStores";
import { applyWindowsPins, statusWanted, trayOnBar, type TaskbarSettings, type WindowList } from "./model";

/** In the bar's window: the open windows grouped by app, as Rust last sent them. */
export const barWindows = createStore<WindowList>({ groups: [], active: null });
/** In the bar's window: icons of the groups without an entry (the launcher has none for them), by group key; null = none. */
export const groupIcons = createStore<Record<string, string | null>>({});
/** In the bar's window: whether this bar shows (followBar); its widgets rest and its glass stops while it does not. */
export const barShown = createStore(true);
/** The site's full-screen demo offers a bar of its own, in the notch's page (src/dev/demo.ts); never set in the app. */
export const demoBarOffered = createStore(false);

/** A change to the bar's settings, from the Taskbar pages and their widget rows; the notch applies on/off and the height to Rust (startTaskbar), the bar reads the rest itself. */
export function setTaskbar(patch: Partial<TaskbarSettings> | ((cur: TaskbarSettings) => Partial<TaskbarSettings>)) {
  updateSettings((s) => ({ taskbar: { ...s.taskbar, ...(typeof patch === "function" ? patch(s.taskbar) : patch) } }));
}

/**
 * The notch applies the bar's on/off, height, docking and hiding to Rust, the only window that does: as saved when Crest starts, then
 * on every change of any. The first time the bar is on and its pinned list was never filled, the notch fills it with Windows' pinned apps;
 * while the bar is on, what is pinned or unpinned on Windows' taskbar follows on it (followPins).
 */
export function startTaskbar() {
  if (!isNative || isMac) return;
  let last = "";
  let hides: boolean | null = null;
  let tray: boolean | null = null;
  let statusOn: boolean | null = null;
  let spread: string | null = null;
  let queue = Promise.resolve();
  let seeded = false;
  let kept = false;
  let offPins: (() => void) | null = null;
  let reading = false;
  let again = false;
  // One read at a time; a change heard during one is read once more after it. Applied to the settings as they are then, to a pinned
  // list never seeded not at all (the seed brings Windows' pins), and only from a good read, so a failed one keeps the remembered ids.
  const followPins = () => {
    if (reading) {
      again = true;
      return;
    }
    reading = true;
    void taskbar
      .windowsPins(settings.get().taskbar.windowsPins)
      .then((r) => {
        if (!r.ok) return;
        const change = { added: normalizeFavorites(r.added) ?? [], removed: r.removed };
        updateSettings((s) => ({ taskbar: { ...s.taskbar, pinned: s.taskbar.pinned && applyWindowsPins(s.taskbar.pinned, change), windowsPins: r.now } }));
      }, () => {})
      .finally(() => {
        reading = false;
        if (again) {
          again = false;
          if (offPins) followPins();
        }
      });
  };
  const sync = () => {
    const { enabled, height, shape, pinned, autoHide, allScreens, appsOn } = settings.get().taskbar;
    const wantTray = trayOnBar(settings.get().taskbar.zones);
    // Outside the queue: a flag the display poll reads, which never waits for a bar to be built or taken down.
    if (autoHide !== hides) {
      hides = autoHide;
      void taskbar.autoHide(autoHide);
    }
    // Likewise, the other monitors' bars and which windows each lists: Rust takes the bars down or builds them and lists again.
    if (`${allScreens}|${appsOn}` !== spread) {
      spread = `${allScreens}|${appsOn}`;
      void taskbar.spread(allScreens, appsOn).catch(() => {});
    }
    // Likewise, whether a zone holds the tray: Rust runs the spy while it does and the bar is on, so the bar turned off stops the
    // spy in Rust after Windows' taskbar is back (mod.rs `stop`), and the tray taken off stops it here, giving Explorer every icon back.
    if (wantTray !== tray) {
      tray = wantTray;
      void taskbar.trayOn(wantTray).catch(() => {});
    }
    // Likewise, whether the bar is on and shows Stato: Rust follows the network and the volume for it only then.
    const wantStatus = statusWanted(settings.get().taskbar);
    if (wantStatus !== statusOn) {
      statusOn = wantStatus;
      void status.barOn(wantStatus).catch(() => {});
    }
    // One try per start: a failed read leaves the list to the next start, and an app pinned meanwhile is never overwritten.
    if (enabled && pinned === null && !seeded) {
      seeded = true;
      void taskbar.importPins().then((apps) => {
        if (settings.get().taskbar.pinned === null) updateSettings((s) => ({ taskbar: { ...s.taskbar, pinned: normalizeFavorites(apps) } }));
      }, () => {});
    }
    // Once per start: Rust forgets the own pins taken off the bar. Never again, as a later call could come between a pin Rust just
    // saved and the settings change that names it.
    if (enabled && pinned !== null && !kept) {
      kept = true;
      void taskbar.keepPins(pinned.map((f) => f.id)).catch(() => {});
    }
    // Once as the bar comes on, for what changed while Crest was closed, then on each change Rust hears.
    if (enabled && !offPins) {
      offPins = taskbar.onWindowsPins(followPins);
      followPins();
    } else if (!enabled && offPins) {
      offPins();
      offPins = null;
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
