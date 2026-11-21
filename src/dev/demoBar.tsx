import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { language } from "../i18n";
import { navigate } from "../notch/nav";
import { notchOpen } from "../notch/useNotchState";
import { demoOpen, settingsWindow } from "../platform/native";
import { launcher, mockStatus, taskbar } from "../platform/services";
import { settings, updateSettings } from "../settings/store";
import { launcherIcons } from "../features/launcher/store";
import { WidgetSources } from "../features/taskbar/feed";
import { closePanel } from "../features/taskbar/panel";
import { barStatus } from "../features/taskbar/status";
import { barWindows, groupIcons } from "../features/taskbar/store";
import { trayPictures, trayState } from "../features/taskbar/tray";
import { TaskbarWindow } from "../features/taskbar/window/TaskbarWindow";
import { TRAY, appIcon, windowPicture } from "./demoBarArt";
import { DEMO_APPS, launchApp, seedWindows, windowAction } from "./demoBarModel";

/*
 * The site's full-screen demo (/demo/?demo): Crest's real bar in the notch's own page, so both read the same settings and stores, and the
 * bar's widgets get the notch's sample data through WidgetSources as in the app. Where the app asks Windows (a window, Start, the
 * calendar, live thumbnails) or the settings window, the demo answers itself, with the closest thing it has. Loaded only by
 * src/dev/demo.ts, never in the app or in the site's small stage.
 */

/** How tall the bar's layer is, CSS px: the bar, the names over its buttons and the icons that grow; its panels and menus are fixed and leave it. */
const LAYER = 160;

/** The bar as the demo opens: on, its apps pinned, the widgets of a bar in use, the demo's tray icons kept visible. */
function applySettings() {
  updateSettings((s) => ({
    taskbar: {
      ...s.taskbar,
      enabled: true,
      pinned: DEMO_APPS.filter((a) => a.pinned).map((a) => ({ id: a.id, name: a.name })),
      zones: { left: ["readings", "weather", "rings", "tool:media"], center: ["start", "apps"], right: ["timer", "tool:notes", "tray", "status", "clock", "crest"] },
      trayShown: TRAY.map((t) => t.id),
    },
  }));
}

/** What Rust would send the bar: the open windows, the icons, the tray and Stato's power, network and volume (as the notch's samples have them). */
function seed() {
  barWindows.set(seedWindows());
  const icons = Object.fromEntries(DEMO_APPS.map((a) => [a.id, appIcon(a.id)]));
  launcherIcons.set((s) => ({ ...s, ...icons }));
  groupIcons.set(icons);
  trayState.set({ yielded: false, icons: TRAY.map((t, i) => ({ id: t.id, key: String(i + 1), tip: t.tip, img: t.id })) });
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

/** The demo's answers where the bar asks Windows or the settings window. Unknown ids keep the browser's own answer. */
function answer() {
  taskbar.window = (id, action) => {
    barWindows.set(windowAction(barWindows.get(), id, action));
    return Promise.resolve();
  };
  // Start opens the Launcher in the notch, Task Manager the Hardware tool; Win+X and the quick settings' links have nothing near them here.
  taskbar.shell = (action) => {
    if (action === "start") demoOpen("launcher");
    if (action === "taskmgr") demoOpen("system");
    return Promise.resolve();
  };
  taskbar.calendar = () => {
    demoOpen("calendar");
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
    for (const [id, img] of thumbs)
      if (!kept.has(id)) {
        img.remove();
        thumbs.delete(id);
      }
    return Promise.resolve(answers);
  };
  const open = launcher.open;
  launcher.open = (id) => {
    const app = DEMO_APPS.find((a) => a.id === id);
    if (!app) return open(id);
    barWindows.set(launchApp(barWindows.get(), app));
    return Promise.resolve();
  };
  const icons = launcher.icons;
  launcher.icons = (ids) => {
    const ours: Record<string, string> = {};
    for (const id of ids) {
      const src = appIcon(id);
      if (src) ours[id] = src;
    }
    return icons(ids.filter((id) => !(id in ours))).then((found) => ({ ...found, ...ours }));
  };
  // The settings open in the notch, on the bar's page the menu asks for; a tool the panel does not show opens there too.
  settingsWindow.open = (section) => {
    if (section) navigate("settings", section);
    demoOpen("settings");
    return Promise.resolve();
  };
  settingsWindow.notchOpen = (tab) => {
    demoOpen(tab);
    return Promise.resolve();
  };
}

/** The notch and the bar's panel share a page here, and some stores (the header's buttons, the cover behind a tool): one shows at a time. */
function oneAtATime() {
  notchOpen.subscribe(() => {
    if (notchOpen.get()) closePanel();
  });
}

function DemoBar() {
  language.use();
  const on = settings.use().taskbar.enabled;
  return (
    <MotionConfig reducedMotion="user">
      <WidgetSources />
      {on && (
        <div style={{ height: "100%", pointerEvents: "auto" }}>
          <TaskbarWindow />
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
  oneAtATime();
  const host = document.createElement("div");
  host.id = "demo-bar";
  // No pointer events of its own: with the bar off it leaves the desktop under it free.
  host.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${LAYER}px;z-index:40;pointer-events:none`;
  document.body.append(host);
  createRoot(host).render(
    <StrictMode>
      <DemoBar />
    </StrictMode>,
  );
}
