import { StrictMode, useEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { createStore } from "../lib/store";
import { language, t } from "../i18n";
import { activeTool } from "../notch/header";
import { demoSettingsWindow, nav } from "../notch/nav";
import { SettingsWindow } from "../features/settings/window/SettingsWindow";
import { notchOpen, pinned } from "../notch/useNotchState";
import { demoOpen, settingsWindow } from "../platform/native";
import { launcher, mockStatus, taskbar } from "../platform/services";
import { settings, updateSettings } from "../settings/store";
import { launcherIcons } from "../features/launcher/store";
import { WidgetSources } from "../features/taskbar/feed";
import { closePanel, panel } from "../features/taskbar/panel";
import { barStatus } from "../features/taskbar/status";
import { barWindows, groupIcons } from "../features/taskbar/store";
import { trayPictures, trayState } from "../features/taskbar/tray";
import { TaskbarWindow } from "../features/taskbar/window/TaskbarWindow";
import { TRAY, appIcon, windowPicture } from "./demoBarArt";
import { framed } from "./showcase-data";
import { DEMO_APPS, launchApp, seedWindows, windowAction } from "./demoBarModel";

/*
 * The site's full-screen demo (/demo/?demo): Crest's real bar in the notch's own page, so both read the same settings and stores, and the
 * bar's widgets get the notch's sample data through WidgetSources as in the app. Where the app asks Windows (a window, Start, the
 * calendar, live thumbnails) or the settings window, the demo answers itself, with the closest thing it has. Loaded only by
 * src/dev/demo.ts, never in the app or in the site's small stage.
 */

/** How tall the bar's layer is, CSS px: the bar, the names over its buttons and the icons that grow; its panels and menus are fixed and leave it. */
const LAYER = 160;
/** How long a surface's views stay after it closes, ms: the notch's close spring (springs.close, 0.32 s) and a margin; the bar's panel is no slower. */
const EXIT_MS = 450;

/** The bar as the demo opens: on, its apps pinned, the widgets of a bar in use, the demo's tray icons kept visible. */
function applySettings() {
  updateSettings((s) => ({
    taskbar: {
      ...s.taskbar,
      enabled: true,
      pinned: DEMO_APPS.filter((a) => a.pinned).map((a) => ({ id: a.id, name: a.name })),
      zones: { left: ["readings", "weather", "rings", "tool:media"], center: ["start", "apps"], right: ["timer", "tool:notes", "tray", "status", "clock", "crest"] },
      trayShown: TRAY.map((t) => t.id),
      // The home page's screen shows the wallpaper through the bar
      ...(framed ? { transparency: 55 } : {}),
    },
    // Start opens the Launcher: the same apps as on the bar, which it starts there.
    launcher: { ...s.launcher, favorites: DEMO_APPS.map((a) => ({ id: a.id, name: a.name })) },
  }));
}

/** What Rust would send the bar: the open windows, the icons, the tray and Stato's power, network and volume (as the notch's samples have them). */
function seed() {
  barWindows.set(seedWindows());
  const icons = Object.fromEntries(DEMO_APPS.map((a) => [a.id, appIcon(a.id)]));
  launcherIcons.set((s) => ({ ...s, ...icons }));
  groupIcons.set(icons);
  trayState.set({ icons: TRAY.map((t, i) => ({ id: t.id, key: String(i + 1), tip: t.tip, img: t.id })) });
  trayPictures.set(Object.fromEntries(TRAY.map((t) => [t.id, t.picture])));
  barStatus.set({ power: mockStatus.seed().power, network: { kind: "wireless", wifi: true, bars: 4, ssid: "Home" }, sound: { level: 42, muted: false } });
}

/** The thumbnails over the preview card's boxes, by window id: fixed pictures above the card, as Rust's small windows are in the app. */
const thumbs = new Map<number, HTMLImageElement>();

function thumb(id: number, src: string, box: { x: number; y: number; w: number; h: number }) {
  let img = thumbs.get(id);
  if (!img) {
    img = document.createElement("img");
    img.alt = "";
    img.style.cssText = "position:fixed;z-index:45;pointer-events:none;object-fit:cover;border-radius:4px";
    document.body.append(img);
    thumbs.set(id, img);
  }
  if (img.src !== src) img.src = src;
  Object.assign(img.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
}

/** Takes away every thumbnail but `keep`'s: for a card that changed, closed, or went with the bar. */
function clearThumbs(keep: ReadonlySet<number> = new Set()) {
  for (const [id, img] of thumbs)
    if (!keep.has(id)) {
      img.remove();
      thumbs.delete(id);
    }
}

/** Bumped to drop the bar's tree at once (its key): a panel open or closing then goes without its exit animation. */
const epoch = createStore(0);
/** When the bar's panel and the notch last closed (performance.now()): their views go EXIT_MS later. */
let panelClosed = -Infinity;
let notchClosed = -Infinity;
/** The notch's tool when the press (or key) that ends in a click began, null with the notch closed: a second click on Start closes it again. */
let openOnPress: string | null = null;

/**
 * The bar's panel, open or still closing, goes now. The notch and the panel share this page, and with it the stores a tool's view writes for
 * the surface it is in: the header's buttons (notch/header.tsx), the size it asks for (notch/size.ts), the cover behind it. A view that
 * goes after the other surface's has come would undo them, so the panel's views are gone before the notch shows a tool. `sync` false where
 * React may be rendering (a store change inside an effect): the drop then lands a moment later.
 */
function dropPanel(sync = true) {
  if (!panel.get() && performance.now() - panelClosed > EXIT_MS) return;
  closePanel();
  panelClosed = -Infinity;
  clearThumbs();
  if (sync) flushSync(() => epoch.set((n) => n + 1));
  else epoch.set((n) => n + 1);
}

/** Opens the notch from the bar, as the app's notch_open does, once the bar's panel has gone. */
function openNotch(tab: string | null) {
  dropPanel();
  demoOpen(tab);
}

/** One surface at a time, each one's views gone before the other's come (dropPanel). */
function handoff() {
  let open = notchOpen.get();
  notchOpen.subscribe(() => {
    if (notchOpen.get() === open) return;
    open = notchOpen.get();
    if (!open) return void (notchClosed = performance.now());
    // Mostly done already, by the pointer reaching the notch; this catches the other ways in.
    dropPanel(false);
    // The bar's panel took the header's buttons for its tool, and the notch sets them only when its own tool changes.
    activeTool.set(nav.get().tabId);
  });
  // A panel asked for while the notch shows, or before its views have gone, waits for them; the notch closes first, pinned or not.
  let shown = false;
  let held = 0;
  panel.subscribe(() => {
    const p = panel.get();
    if (!p) {
      if (shown) panelClosed = performance.now();
      shown = false;
      return;
    }
    const wait = notchOpen.get() ? EXIT_MS : notchClosed + EXIT_MS - performance.now();
    window.clearTimeout(held);
    if (wait <= 0) return void (shown = true);
    panel.set(null);
    if (notchOpen.get()) {
      pinned.set(false);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    }
    held = window.setTimeout(() => !notchOpen.get() && panel.set(p), wait);
  });
  // A link in a tool shown in the bar's panel (its settings, another tool): in the app it opens in the notch, and so here.
  nav.subscribe(() => {
    if (panel.get() && !notchOpen.get()) openNotch(nav.get().tabId);
  });
  const press = () => void (openOnPress = notchOpen.get() ? nav.get().tabId : null);
  window.addEventListener("keydown", press, true);
  window.addEventListener(
    "pointerdown",
    (e) => {
      press();
      // A press anywhere but the bar, its panel and the menus a tool hangs from the page: the panel goes, at once.
      if (!(e.target as Element).closest?.("#demo-bar, [data-notch-menu]")) dropPanel();
    },
    true,
  );
  window.addEventListener(
    "pointerover",
    (e) => {
      const el = e.target as Element;
      if (el.closest?.("[data-notch-hit]") && !el.closest("#demo-bar")) dropPanel();
    },
    true,
  );
  settings.subscribe(() => {
    if (!settings.get().taskbar.enabled) clearThumbs();
  });
}

/** The demo's answers where the bar asks Windows or the settings window. Unknown ids keep the browser's own answer. */
function answer() {
  taskbar.window = (id, action) => {
    barWindows.set(windowAction(barWindows.get(), id, action));
    return Promise.resolve();
  };
  // Start opens the Launcher in the notch and Task Manager the Hardware tool, and a second click on Start closes it as Windows' does.
  // Win+X and the quick settings' links have nothing near them here.
  taskbar.shell = (action) => {
    if (action === "start" && openOnPress !== "launcher") openNotch("launcher");
    if (action === "taskmgr") openNotch("system");
    return Promise.resolve();
  };
  taskbar.calendar = () => {
    if (openOnPress !== "calendar") openNotch("calendar");
    return Promise.resolve();
  };
  // A minimized window has no thumbnail, as in the app: its box shows the app's icon.
  taskbar.preview = (slots) => {
    const windows = new Map(barWindows.get().groups.flatMap((g) => g.windows.map((w) => [w.id, { w, app: g.key }] as const)));
    const kept = new Set<number>();
    const answers = slots.map((s) => {
      const found = windows.get(s.id);
      const src = found && !found.w.minimized ? windowPicture(found.app, found.w.title) : null;
      if (!src) return null;
      kept.add(s.id);
      thumb(s.id, src, s);
      return { x: s.x, y: s.y, w: s.w, h: s.h };
    });
    clearThumbs(kept);
    return Promise.resolve(answers);
  };
  const open = launcher.open;
  launcher.open = (id, admin, reuse) => {
    const app = DEMO_APPS.find((a) => a.id === id);
    if (!app) return open(id, admin, reuse);
    // As in the app, a Launcher tile brings an open app's window forward instead of a second one (launcher.rs `open`).
    const shown = reuse ? barWindows.get().groups.find((g) => g.key === app.id)?.windows[0] : undefined;
    barWindows.set(shown ? windowAction(barWindows.get(), shown.id, "activate") : launchApp(barWindows.get(), app));
    return Promise.resolve();
  };
  // The settings open in a window over the desktop, as in the app (DemoSettings), on the page the menu or the gear asks for. The
  // notch closes, as it does when the app's window takes the focus; a tool the panel does not show opens in the notch.
  settingsWindow.open = (section) => {
    if (section) nav.set({ ...nav.get(), section });
    // Esc closes the notch and unpins it (useNotchState): sent before the window listens for it.
    dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    settingsShown.set(true);
    return Promise.resolve();
  };
  settingsWindow.notchOpen = (tab) => {
    openNotch(tab);
    return Promise.resolve();
  };
}

/** The demo's settings window: shown while true, closed by its X or Esc. */
const settingsShown = createStore(false);

/** The app's settings window (SettingsWindow, with the Notch, Taskbar and Pomelo switch) on the demo's desktop, centred and kept inside it. */
function DemoSettings() {
  language.use();
  const shown = settingsShown.use();
  useEffect(() => {
    if (!shown) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && settingsShown.set(false);
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [shown]);
  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {shown && (
          <motion.div
            key="settings"
            role="dialog"
            aria-label={t("Einstellungen")}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            className="pointer-events-auto absolute left-1/2 top-1/2 overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/10"
            style={{ width: "min(820px, calc(100vw - 32px))", height: "min(600px, calc(100vh - 140px))", x: "-50%", y: "-50%" }}
          >
            <SettingsWindow onClose={() => settingsShown.set(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

function DemoBar() {
  language.use();
  const on = settings.use().taskbar.enabled;
  const key = epoch.use();
  return (
    <MotionConfig reducedMotion="user">
      <WidgetSources />
      {on && (
        <div style={{ height: "100%" }}>
          <TaskbarWindow key={key} />
        </div>
      )}
    </MotionConfig>
  );
}

/** Puts the bar on the demo's desktop, over DesktopMock and under the notch (z-50). Once per page. */
export function mountDemoBar() {
  applySettings();
  seed();
  answer();
  handoff();
  // The layer lets the pointer through but on the bar and what opens from it, as Rust does around the app's bar.
  const style = document.createElement("style");
  style.textContent = "#demo-bar [data-bar],#demo-bar [data-notch-hit],#demo-bar [role=menu],#demo-bar [role=dialog]{pointer-events:auto}";
  document.head.append(style);
  const host = document.createElement("div");
  host.id = "demo-bar";
  host.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${LAYER}px;z-index:40;pointer-events:none`;
  document.body.append(host);
  createRoot(host).render(
    <StrictMode>
      <DemoBar />
    </StrictMode>,
  );
  // The settings window: over the desktop and the bar, under the notch (z-50), as in the app.
  demoSettingsWindow.set(true);
  const windowHost = document.createElement("div");
  windowHost.id = "demo-settings";
  windowHost.style.cssText = "position:fixed;inset:0;z-index:45;pointer-events:none";
  document.body.append(windowHost);
  createRoot(windowHost).render(
    <StrictMode>
      <DemoSettings />
    </StrictMode>,
  );
}
