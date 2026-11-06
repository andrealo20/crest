import { createStore } from "../../lib/store";
import { status, type StatusSeed } from "../../platform/services";
import { settings } from "../../settings/store";
import { focusMode } from "../../notch/focus";
import { fullscreen } from "../system/gaming";
import { presentingNow } from "../privacy/store";
import { t } from "../../i18n";
import { STATUS, btAlert, levelAlert, lockAlert, netAlert, osdArmed, osdHidden, powerAlert, mergeSeed, type LowBattery, type PowerState, type StatusAlert } from "../../notch/row/status";

/** The status alert on screen, for STATUS.showMs; a new one replaces it. */
export const statusAlert = createStore<StatusAlert | null>(null);

let started = false;

/** Listens to sysevents.rs from the seed on and turns each change into an alert by the rules in status.ts. */
export function startStatusWatch() {
  if (started) return;
  started = true;
  let power: PowerState | null = null, online: boolean | null = null, hide = 0;
  const low: LowBattery = { warned20: false, warned10: false };
  // Bluetooth devices connected now: one already there (from the seed) does not alert when reported again.
  let devices = new Set<string>();
  // Whether the alert went on screen. Not in focus mode nor over a fullscreen app; dropped rather than kept for later.
  // Not a device name while presenting or sharing the screen, as with a download's file name.
  const show = (alert: StatusAlert | null, on: boolean): boolean => {
    if (!alert || !on || focusMode.get() || fullscreen.get() || (alert.kind === "bt" && presentingNow())) return false;
    statusAlert.set(alert);
    clearTimeout(hide);
    hide = window.setTimeout(() => statusAlert.set(null), STATUS.showMs);
    return true;
  };
  // The command and the event may both deliver it, and the command can return a partial one while sysevents.rs still registers.
  const seed = (s: StatusSeed) => {
    if (s.power && !power) powerAlert(null, s.power, low, t);
    ({ power, online, devices } = mergeSeed({ power, online, devices }, s));
  };
  status.on({
    seed,
    power: (next) => {
      const before = { ...low };
      const alert = powerAlert(power, next, low, t);
      power = next;
      const on = settings.get().closed.statusAlerts.power;
      // A low-battery warning dropped for focus mode or a fullscreen app is not used up: the next reading gives it again.
      if (!show(alert, on) && on && alert && alert.tone !== "normal") Object.assign(low, before);
    },
    net: (next) => {
      const alert = netAlert(online, next, t);
      online = next;
      show(alert, settings.get().closed.statusAlerts.net);
    },
    bt: (e) => {
      const known = devices.has(e.name);
      if (e.connected) devices.add(e.name);
      else devices.delete(e.name);
      if (e.connected && known) return;
      show(btAlert(e, t), settings.get().closed.statusAlerts.bt);
    },
    level: (e) => show(levelAlert(e, t), settings.get().closed.statusAlerts[e.kind]),
    lock: (e) => show(lockAlert(e, t), settings.get().closed.statusAlerts.lock),
  });
  void status.seed().then(seed, () => {});
  // Tells Rust what to read and whether to hide the Windows indicator; sent again only when that changes.
  let sent = "";
  const configure = () => {
    const alerts = settings.get().closed.statusAlerts;
    const quiet = focusMode.get() || fullscreen.get();
    // Alerts are dropped while quiet, so the key poll rests too; Bluetooth and volume run while their own alerts are on.
    const c = { ddc: alerts.brightness, locks: alerts.lock && !quiet, bt: alerts.bt, volume: alerts.volume, hideOsd: osdHidden(alerts, focusMode.get(), fullscreen.get()), osdArmed: osdArmed(alerts) };
    if (JSON.stringify(c) === sent) return;
    sent = JSON.stringify(c);
    status.configure(c);
  };
  settings.subscribe(configure);
  focusMode.subscribe(configure);
  fullscreen.subscribe(configure);
  configure();
}
