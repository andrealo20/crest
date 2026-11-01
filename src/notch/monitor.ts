import { createStore } from "../lib/store";
import { display, type MonitorInfo } from "../platform/services";
import { settings } from "../settings/store";

/** The monitor the notch sits on (the chosen one, else the primary, as display.rs picks it); null until loaded. */
export const monitor = createStore<MonitorInfo | null>(null);

/** Size and work area of that monitor in CSS px; before it loads, the screen with a 48 px taskbar at the bottom. */
export function monitorMetrics(): { width: number; height: number; workTop: number; workHeight: number; workLeft: number; workWidth: number } {
  const m = monitor.get();
  if (m) return { width: m.width, height: m.height, workTop: m.workTop, workHeight: m.workHeight, workLeft: m.workLeft, workWidth: m.workWidth };
  const height = window.screen.height;
  return { width: window.screen.width, height, workTop: 0, workHeight: height - 48, workLeft: 0, workWidth: window.screen.width };
}

let loaded: string | null | undefined;

/** Reads the monitor again; also when a drag starts, since resolution or taskbar may have changed since. */
export function reloadMonitor() {
  const name = (loaded = settings.get().display.monitor);
  void display.monitors().then((all) => {
    // A newer choice is already loading.
    if (settings.get().display.monitor !== name) return;
    monitor.set(all.find((m) => m.name === name) ?? all.find((m) => m.primary) ?? null);
  });
}

/** Loads the monitor at start and whenever `display.monitor` changes. */
export function startMonitorWatch() {
  const load = () => {
    if (settings.get().display.monitor !== loaded) reloadMonitor();
  };
  load();
  settings.subscribe(load);
}
