import { createStore } from "../../lib/store";
import { status, type StatusSeed } from "../../platform/services";
import { settings } from "../../settings/store";
import { focusMode } from "../../notch/focus";
import { fullscreen } from "../system/gaming";
import { t } from "../../i18n";
import { STATUS, btAlert, netAlert, powerAlert, type LowBattery, type PowerState, type StatusAlert } from "../../notch/row/status";

/** The status alert on screen, for STATUS.showMs; a new one replaces it. */
export const statusAlert = createStore<StatusAlert | null>(null);

let started = false;

/** Listens to sysevents.rs from the seed on and turns each change into an alert by the rules in status.ts. */
export function startStatusWatch() {
  if (started) return;
  started = true;
  let power: PowerState | null = null, online: boolean | null = null, seeded = false, hide = 0;
  const low: LowBattery = { warned20: false, warned10: false };
  // Headsets connected now: one already there (from the seed) does not alert when reported again.
  const headsets = new Set<string>();
  const show = (alert: StatusAlert | null, on: boolean) => {
    // Not in focus mode nor over a fullscreen app; dropped rather than kept for later.
    if (!alert || !on || focusMode.get() || fullscreen.get()) return;
    statusAlert.set(alert);
    clearTimeout(hide);
    hide = window.setTimeout(() => statusAlert.set(null), STATUS.showMs);
  };
  // The command and the event may both deliver it; only the first counts, and only for what no event has set yet.
  const seed = (s: StatusSeed) => {
    if (seeded) return;
    seeded = true;
    if (s.power && !power) { powerAlert(null, s.power, low, t); power = s.power; }
    online ??= s.online;
    s.headsets.forEach((n) => headsets.add(n));
  };
  status.on({
    seed,
    power: (next) => {
      const alert = powerAlert(power, next, low, t);
      power = next;
      show(alert, settings.get().closed.statusAlerts.power);
    },
    net: (next) => {
      const alert = netAlert(online, next, t);
      online = next;
      show(alert, settings.get().closed.statusAlerts.net);
    },
    bt: (e) => {
      const known = headsets.has(e.name);
      if (e.connected) headsets.add(e.name);
      else headsets.delete(e.name);
      if (e.connected && known) return;
      show(btAlert(e, t), settings.get().closed.statusAlerts.bt);
    },
  });
  void status.seed().then(seed, () => {});
}
