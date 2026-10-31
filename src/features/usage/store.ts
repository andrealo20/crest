import { useEffect } from "react";
import { createStore } from "../../lib/store";
import { rowVisible } from "../../notch/row/visibility";
import { fetchUsage, type UsageId, type UsageProvider } from "../../platform/services";
import { settings } from "../../settings/store";

/** Rust caches per provider (Claude 5 min), so polling more often costs nothing. */
const POLL_MS = 60_000;

/**
 * Quotas shared by the AI usage tool and the rings in the closed row. Polled only while one
 * of them is on screen; `updatedAt` (when the last answer came) stays null until the first.
 */
export const usage = createStore<{ providers: UsageProvider[]; loading: boolean; updatedAt: number | null }>({ providers: [], loading: false, updatedAt: null });

/** Mounted views that show the quotas (see `useUsageViewer`). */
const viewers = createStore(0);

let timer: ReturnType<typeof setInterval> | null = null;
let timerKey = "";
let latest = 0;

function enabledIds(): UsageId[] {
  const enabled = settings.get().usage;
  return (Object.keys(enabled) as UsageId[]).filter((id) => enabled[id]);
}

export function refreshUsage(): Promise<void> {
  const call = ++latest;
  usage.set((u) => ({ ...u, loading: true }));
  return fetchUsage(enabledIds()).then((providers) => {
    // An older answer (providers changed meanwhile) must not overwrite a newer one.
    if (call === latest) usage.set({ providers, loading: false, updatedAt: Date.now() });
  });
}

function apply() {
  const s = settings.get();
  if (!((s.closed.parts.rings && rowVisible.get()) || viewers.get() > 0)) {
    if (timer) clearInterval(timer);
    timer = null;
    return;
  }
  // Providers changed: read again right away, not after the next tick.
  const key = enabledIds().join(",");
  if (timer && timerKey === key) return;
  if (timer) clearInterval(timer);
  void refreshUsage();
  timer = setInterval(() => void refreshUsage(), POLL_MS);
  timerKey = key;
}

export function startUsagePolling() {
  apply();
  settings.subscribe(apply);
  rowVisible.subscribe(apply);
  viewers.subscribe(apply);
}

/** For views that show the quotas: polling while mounted. */
export function useUsageViewer() {
  useEffect(() => {
    viewers.set((n) => n + 1);
    return () => viewers.set((n) => n - 1);
  }, []);
}
