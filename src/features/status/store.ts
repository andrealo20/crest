import { createStore } from "../../lib/store";
import { display, status, windowShell, type StatusSeed } from "../../platform/services";
import { clipboard } from "../../platform/clipboard";
import { notchOpen } from "../../notch/useNotchState";
import { settings } from "../../settings/store";
import { focusMode } from "../../notch/focus";
import { fullscreen } from "../system/gaming";
import { screen } from "../window/store";
import { presentingNow } from "../privacy/store";
import { t } from "../../i18n";
import {
  INDICATORS, STATUS, airplaneAlert, btAlert, chargedAlert, clipAlert, displayAlert, focusAlert, heldBack, levelAlert, lockAlert, micAlert, modeAlert, netAlert, osdArmed, osdHidden,
  outputAlert, powerAlert, saverAlert, mergeSeed, type Charge, type LowBattery, type PowerState, type StatusAlert,
} from "../../notch/row/status";

/** After the last indicator, the window a rule or the hide shortcut keeps hidden goes again once the HUD has shrunk away (springs.close). */
const REVEAL_TAIL_MS = 450;
/** A copy older than this when its list comes is not one just made (the history read at start, a list sent again). */
const COPY_FRESH_MS = 3000;
/** Copies made in Crest come while the notch is open or just after it closed (Paste directly copies, then gives the keyboard back). */
const OWN_COPY_MS = 1500;
/** Headphones that connect over Bluetooth also take the sound: their own alert, with the battery, says it, so the output that follows within this is not told. */
const BT_OUTPUT_MS = 5000;
/** Windows can keep one power mode on battery and another on the charger: the charger's alert says enough when the mode follows it. */
const MODE_AFTER_CHARGER_MS = 5000;
/** Which of the two Windows tells first varies: a mode waits this long for a charger that may come just after it. */
const MODE_WAIT_MS = 800;
/** Airplane mode takes the internet away: the "Offline" that follows it says nothing new. */
const NET_AFTER_AIRPLANE_MS = 8000;

/** The status alert on screen, for STATUS.showMs; a new one replaces it. */
export const statusAlert = createStore<StatusAlert | null>(null);

/** The power state as sysevents.rs last told it, null until then; the glass reads its `saver` (src/notch/glass). */
export const powerState = createStore<PowerState | null>(null);

let started = false;

/** Listens to sysevents.rs from the seed on and turns each change into an alert by the rules in status.ts. */
export function startStatusWatch() {
  if (started) return;
  started = true;
  let power: PowerState | null = null, online: boolean | null = null, hide = 0;
  const low: LowBattery = { warned20: false, warned10: false };
  const charge: Charge = { since: 0, done: false };
  // When the charger last came or went, airplane mode last went on, and the Bluetooth device that last connected.
  let chargerAt = 0, airplaneAt = 0, joined: { name: string; at: number } | null = null;
  // Bluetooth devices connected now: one already there (from the seed) does not alert when reported again.
  let devices = new Set<string>();
  // An indicator shown everywhere brings out the window a rule or the hide shortcut keeps hidden, for as long as it shows.
  let revealed = false, unreveal = 0;
  const reveal = (on: boolean) => {
    clearTimeout(unreveal);
    if (on) {
      if (!revealed) display.alert((revealed = true));
    } else if (revealed) unreveal = window.setTimeout(() => display.alert((revealed = false)), REVEAL_TAIL_MS);
  };
  // Whether the alert went on screen. Not in focus mode, and not over a fullscreen app but an indicator with `everywhere` on; dropped rather
  // than kept for later. Not a device name (Bluetooth, the sound output) while presenting or sharing the screen, as with a download's file name.
  const show = (alert: StatusAlert | null, on: boolean): boolean => {
    const everywhere = settings.get().closed.statusAlerts.everywhere;
    if (!alert || !on || focusMode.get() || heldBack(alert.kind, { fullscreen: fullscreen.get(), everywhere }) || ((alert.kind === "bt" || alert.kind === "output") && presentingNow())) return false;
    statusAlert.set(alert);
    reveal((everywhere || settings.get().behavior.behind) && INDICATORS.has(alert.kind));
    clearTimeout(hide);
    hide = window.setTimeout(() => {
      statusAlert.set(null);
      reveal(false);
    }, STATUS.showMs);
    return true;
  };
  // The command and the event may both deliver it, and the command can return a partial one while sysevents.rs still registers.
  const seed = (s: StatusSeed) => {
    if (s.power && !power) powerAlert(null, s.power, low, t);
    ({ power, online, devices } = mergeSeed({ power, online, devices }, s));
    powerState.set(power);
  };
  status.on({
    seed,
    power: (next) => {
      const before = { ...low }, now = Date.now();
      const alert = powerAlert(power, next, low, t), saver = saverAlert(power, next, t), charged = chargedAlert(power, next, charge, now, t);
      if (power && power.ac !== next.ac) chargerAt = now;
      power = next;
      powerState.set(next);
      const alerts = settings.get().closed.statusAlerts;
      // One alert per reading: the charger or the battery first, then Energy saver (which can switch on with the 20 % warning), then a charged battery.
      if (show(alert, alerts.power)) return;
      // A low-battery warning dropped for focus mode or a fullscreen app is not used up: the next reading gives it again.
      if (alerts.power && alert && alert.tone !== "normal") Object.assign(low, before);
      if (!show(saver, alerts.saver)) show(charged, alerts.power);
    },
    net: (next) => {
      const alert = netAlert(online, next, t);
      online = next;
      if (!next && Date.now() - airplaneAt < NET_AFTER_AIRPLANE_MS) return;
      show(alert, settings.get().closed.statusAlerts.net);
    },
    bt: (e) => {
      const known = devices.has(e.name);
      if (e.connected) devices.add(e.name);
      else devices.delete(e.name);
      if (e.connected && known) return;
      if (e.connected) joined = { name: e.name.trim().toLowerCase(), at: Date.now() };
      show(btAlert(e, t), settings.get().closed.statusAlerts.bt);
    },
    level: (e) => show(levelAlert(e, t), settings.get().closed.statusAlerts[e.kind]),
    lock: (e) => show(lockAlert(e, t), settings.get().closed.statusAlerts[e.key === "insert" ? "insert" : "lock"]),
    mic: (e) => show(micAlert(e, t), settings.get().closed.statusAlerts.mic),
    output: (e) => {
      if (joined?.name && Date.now() - joined.at < BT_OUTPUT_MS && e.name.toLowerCase().includes(joined.name)) return;
      show(outputAlert(e), settings.get().closed.statusAlerts.output);
    },
    focus: (e) => show(focusAlert(e, t), settings.get().closed.statusAlerts.focus),
    mode: (e) => {
      const at = Date.now();
      window.setTimeout(() => {
        if (Math.abs(chargerAt - at) < MODE_AFTER_CHARGER_MS) return;
        show(modeAlert(e, t), settings.get().closed.statusAlerts.saver);
      }, MODE_WAIT_MS);
    },
    airplane: (on) => {
      if (on) airplaneAt = Date.now();
      show(airplaneAlert(on, t), settings.get().closed.statusAlerts.airplane);
    },
    display: (e) => show(displayAlert(e, t), settings.get().closed.statusAlerts.display),
  });
  void status.seed().then(seed, () => {});
  // A copy, as the Clipboard tool records it (its history comes as a whole list): the newest entry, when it is newer than the last one
  // seen and fresh. Not one made in Crest: the notch is open then, or has just closed.
  let seenCopy = clipboard.get()[0]?.copiedAt ?? 0, closedAt = 0;
  notchOpen.subscribe(() => {
    if (!notchOpen.get()) closedAt = Date.now();
  });
  clipboard.subscribe(() => {
    const top = clipboard.get()[0];
    if (!top || top.copiedAt <= seenCopy) return;
    seenCopy = top.copiedAt;
    const now = Date.now();
    if (now - top.copiedAt > COPY_FRESH_MS || notchOpen.get() || now - closedAt < OWN_COPY_MS) return;
    show(clipAlert(top, t), settings.get().closed.statusAlerts.clip);
  });
  // Tells Rust what to read and whether to hide the Windows indicator; sent again only when that changes.
  let sent = "";
  // Hidden by the hide shortcut; a window rule's hiding comes as `screen`.
  let windowHidden = false;
  const configure = () => {
    const alerts = settings.get().closed.statusAlerts;
    const inFocus = focusMode.get();
    const quiet = inFocus || fullscreen.get();
    // Alerts are dropped while quiet, so the key poll rests too (over a fullscreen app not when the indicators show everywhere, in focus mode
    // always), and so does the Do not disturb poll: Windows can switch it on for a game or a fullscreen app, and its end would alert as the game
    // closes. Bluetooth, volume and microphone run while their own alerts are on.
    // Off, the watcher forgets the devices; the next scan is a new baseline, so the ones remembered here would hide a reconnect.
    if (!alerts.bt) devices.clear();
    const keys = !inFocus && (!fullscreen.get() || alerts.everywhere);
    const c = { ddc: alerts.brightness, locks: alerts.lock && keys, insert: alerts.insert && keys, bt: alerts.bt, volume: alerts.volume, mic: alerts.mic, focus: alerts.focus && !quiet, hideOsd: osdHidden(alerts, { focus: inFocus, fullscreen: fullscreen.get(), hidden: screen.get() === "hide" || windowHidden }), osdArmed: osdArmed(alerts) };
    if (JSON.stringify(c) === sent) return;
    sent = JSON.stringify(c);
    status.configure(c);
  };
  settings.subscribe(configure);
  focusMode.subscribe(configure);
  fullscreen.subscribe(configure);
  screen.subscribe(configure);
  windowShell.onHidden((hidden) => {
    windowHidden = hidden;
    configure();
  });
  configure();
}
