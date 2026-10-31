import { createStore } from "../lib/store";
import { display, type MonitorInfo } from "../platform/services";
import { settings } from "../settings/store";

/** The monitor the notch sits on (the chosen one, else the primary, as display.rs picks it); null until loaded. */
export const monitor = createStore<MonitorInfo | null>(null);

/** Height and work area of that monitor in CSS px; before it loads, the screen with a 48 px taskbar at the bottom. */
export function monitorMetrics(): { height: number; workTop: number; workHeight: number } {
  const m = monitor.get();
  if (m) return { height: m.height, workTop: m.workTop, workHeight: m.workHeight };
  const height = window.screen.height;
  return { height, workTop: 0, workHeight: height - 48 };
}

let loaded: string | null | undefined;

/** Loads the monitor at start and whenever `display.monitor` changes. */
export function startMonitorWatch() {
  const load = () => {
    const name = settings.get().display.monitor;
    if (name === loaded) return;
    loaded = name;
    void display.monitors().then((all) => {
      // A newer choice is already loading.
      if (settings.get().display.monitor !== name) return;
      monitor.set(all.find((m) => m.name === name) ?? all.find((m) => m.primary) ?? null);
    });
  };
  load();
  settings.subscribe(load);
}
