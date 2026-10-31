import { createStore } from "../../lib/store";
import { status, type StatusSeed } from "../../platform/services";
import { settings } from "../../settings/store";
import { focusMode } from "../../notch/focus";
import { fullscreen } from "../system/gaming";
import { t } from "../../i18n";
import { statusNotice } from "../../notch/row/columnNotice";
import { STATUS, btAlert, netAlert, powerAlert, mergeSeed, type LowBattery, type PowerState, type StatusAlert } from "../../notch/row/status";

/** The status alert on screen, for STATUS.showMs; a new one replaces it. */
export const statusAlert = createStore<StatusAlert | null>(null);

let started = false;

/** Sets the alert and, for the side column's icon line, its kind, icon and tone. */
function put(alert: StatusAlert | null) {
  statusAlert.set(alert);
  statusNotice.set(alert && { kind: alert.kind, icon: alert.icon, tone: alert.tone });
}

/** Listens to sysevents.rs from the seed on and turns each change into an alert by the rules in status.ts. */
export function startStatusWatch() {
  if (started) return;
  started = true;
  let power: PowerState | null = null, online: boolean | null = null, hide = 0;
  const low: LowBattery = { warned20: false, warned10: false };
  // Headsets connected now: one already there (from the seed) does not alert when reported again.
  let headsets = new Set<string>();
  const show = (alert: StatusAlert | null, on: boolean) => {
    // Not in focus mode nor over a fullscreen app; dropped rather than kept for later.
    if (!alert || !on || focusMode.get() || fullscreen.get()) return;
    put(alert);
    clearTimeout(hide);
    hide = window.setTimeout(() => put(null), STATUS.showMs);
  };
  // The command and the event may both deliver it, and the command can return a partial one while sysevents.rs still registers.
  const seed = (s: StatusSeed) => {
    if (s.power && !power) powerAlert(null, s.power, low, t);
    ({ power, online, headsets } = mergeSeed({ power, online, headsets }, s));
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
