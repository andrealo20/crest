import type { Group, Win, WindowList } from "../features/taskbar/model";

/*
 * The site's full-screen demo: the apps on Crest's bar and what becomes of their windows, standing in for Windows (taskbar/tasks.rs) as
 * pure functions over the bar's list. src/dev/demoBar.tsx stores what they return.
 */

/** An app on the demo's bar: its entry (also its pin), its name, whether it is pinned, and the titles of the windows it starts with. */
export interface DemoApp {
  id: string;
  name: string;
  pinned: boolean;
  windows: string[];
}

export const DEMO_APPS: DemoApp[] = [
  { id: "demo:explorer", name: "File Explorer", pinned: true, windows: ["Documents", "Downloads"] },
  { id: "demo:terminal", name: "Terminal", pinned: true, windows: ["Windows PowerShell"] },
  { id: "demo:notepad", name: "Notepad", pinned: true, windows: ["ideas.txt"] },
  { id: "demo:calculator", name: "Calculator", pinned: true, windows: [] },
  { id: "demo:photos", name: "Photos", pinned: false, windows: ["Lisbon, May 2026"] },
];

type App = Pick<DemoApp, "id" | "name">;
const groupOf = (app: App, windows: Win[]): Group => ({ key: app.id, name: app.name, pins: [{ id: app.id, name: app.name }], windows });
const newWindow = (id: number, title: string): Win => ({ id, title, minimized: false, flashing: false });

/** The desktop as the demo opens: every app's windows, Notepad's in front. */
export function seedWindows(): WindowList {
  let id = 0;
  const groups = DEMO_APPS.filter((a) => a.windows.length).map((a) => groupOf(a, a.windows.map((title) => newWindow(++id, title))));
  return { groups, active: groups.find((g) => g.key === "demo:notepad")?.windows[0].id ?? null };
}

/** Starting an app: a new window in front, in the app's group, made if the app had none. */
export function launchApp(list: WindowList, app: App): WindowList {
  const id = Math.max(0, ...list.groups.flatMap((g) => g.windows.map((w) => w.id))) + 1;
  const opened = newWindow(id, app.name);
  const groups = list.groups.some((g) => g.key === app.id)
    ? list.groups.map((g) => (g.key === app.id ? { ...g, windows: [...g.windows, opened] } : g))
    : [...list.groups, groupOf(app, [opened])];
  return { groups, active: id };
}

/** What Windows does on the bar's actions: a window brought forward (and restored), minimized, toggled between the two, or closed. */
export function windowAction(list: WindowList, id: number, action: "activate" | "toggle" | "minimize" | "close"): WindowList {
  if (!list.groups.some((g) => g.windows.some((w) => w.id === id))) return list;
  const behind = list.active === id ? null : list.active;
  if (action === "close") return { groups: list.groups.map((g) => ({ ...g, windows: g.windows.filter((w) => w.id !== id) })).filter((g) => g.windows.length), active: behind };
  const edit = (patch: Partial<Win>) => list.groups.map((g) => ({ ...g, windows: g.windows.map((w) => (w.id === id ? { ...w, ...patch } : w)) }));
  if (action === "minimize" || (action === "toggle" && list.active === id)) return { groups: edit({ minimized: true }), active: behind };
  return { groups: edit({ minimized: false, flashing: false }), active: id };
}
