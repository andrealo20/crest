// Rules for the closed notch's status alerts (power, network, Bluetooth devices, the volume and brightness HUD, Caps Lock and Num Lock, the microphone mute,
// the sound output, Do not disturb, Energy saver and the power mode, airplane mode, monitors): which transition deserves a short message. Pure; `tr` is passed in so this stays free of i18n.

import type { Hue } from "../../features/themes/themes";

/**
 * `charging`: taking charge now; the charger can be in while a full battery or a charge limit leaves it false.
 * `saver`: battery saver or Energy saver is on (sysevents.rs); Windows turns transparency off, and the glass follows.
 */
export interface PowerState { ac: boolean; percent: number | null; battery: boolean; charging: boolean; saver?: boolean }
export interface StatusAlert {
  kind: "power" | "net" | "bt" | "volume" | "brightness" | "lock" | "mic" | "clip" | "output" | "focus" | "saver" | "mode" | "airplane" | "display";
  icon:
    | "plug" | "battery" | "battery-full" | "wifi" | "wifi-off" | "headphones" | "speaker-hifi" | "mouse" | "keyboard" | "gamepad" | "phone" | "watch" | "bluetooth"
    | "speaker-high" | "speaker-low" | "speaker-none" | "speaker-x" | "sun" | "sun-dim" | "lock" | "lock-open" | "num-lock" | "microphone" | "microphone-slash"
    | "text" | "link" | "image" | "file" | "files" | "folder" | "moon" | "leaf" | "gauge" | "airplane" | "monitor";
  text: string;
  tone: "normal" | "warning" | "critical";
  /** The theme hue of the icon (the bar and the text keep the tone): volume blue, brightness yellow, Caps Lock switched on red, a copy teal and so on. */
  accent?: Hue;
  /** 0..100, drawn as a level bar (volume and brightness only). */
  level?: number;
  /** A key switched off or a device that left: the side edge, which shows only the icon, draws it dimmed. */
  off?: boolean;
  /** A power alert's battery, drawn as Stato draws it (glyphs.tsx BatteryGlyph) in place of the icon. */
  charge?: { percent: number | null; charging: boolean };
}
/** Which low-battery levels already fired in this discharge. */
export interface LowBattery { warned20: boolean; warned10: boolean }
type Tr = (de: string, vars?: Record<string, string | number>) => string;

/** `charged`: charging that stops on the charger from this level up is a full battery or a charge limit; `chargerSettleMs`: the charger has been in this long (plugging in flips the flag). */
export const STATUS = { showMs: 2500, low: 20, critical: 10, charged: 80, chargerSettleMs: 60_000 } as const;

/**
 * Plug/unplug, then low battery on reaching 20 % and 10 % (each once per discharge). Updates `low`; plugging in resets it.
 * Unplugging at a low level alerts once in that level's tone; a first state already low only marks the level as seen.
 */
export function powerAlert(prev: PowerState | null, next: PowerState, low: LowBattery, tr: Tr): StatusAlert | null {
  if (next.ac) { low.warned20 = low.warned10 = false; }
  if (!next.battery) return null;
  const p = next.percent;
  const level = next.ac || p === null ? null : p <= STATUS.critical ? "critical" : p <= STATUS.low ? "warning" : null;
  const fresh = level !== null && !(level === "critical" ? low.warned10 : low.warned20);
  if (level) { low.warned20 = true; low.warned10 ||= level === "critical"; }
  if (!prev) return null;
  // Charging green, as on an iPhone.
  if (prev.ac !== next.ac) return next.ac
    ? { kind: "power", icon: "plug", text: next.charging ? (p === null ? tr("Lädt") : tr("Lädt · {p} %", { p })) : p === null ? tr("Am Netzteil") : tr("Am Netzteil · {p} %", { p }), tone: "normal", ...(next.charging && { accent: "green" as const }), charge: { percent: p, charging: next.charging } }
    : { kind: "power", icon: "battery", text: p === null ? tr("Am Akku") : tr("Akku · {p} %", { p }), tone: level ?? "normal", charge: { percent: p, charging: false } };
  return fresh && level && p !== null ? { kind: "power", icon: "battery", text: tr("Akku {p} %", { p }), tone: level, charge: { percent: p, charging: false } } : null;
}

/** Since when the charger is in (ms, 0 when out) and whether this charge already said it was done. */
export interface Charge { since: number; done: boolean }

/**
 * Charging stopped while the charger stays in, at `STATUS.charged` or more: the battery is full or has reached a charge limit. Once
 * per charge, and not in the first `STATUS.chargerSettleMs`, while the flag still flips. Updates `charge`.
 */
export function chargedAlert(prev: PowerState | null, next: PowerState, charge: Charge, now: number, tr: Tr): StatusAlert | null {
  if (!next.ac) {
    charge.since = 0;
    charge.done = false;
    return null;
  }
  if (!prev?.ac || !charge.since) charge.since = now;
  const p = next.percent;
  if (!prev?.ac || !prev.charging || next.charging || charge.done || p === null || p < STATUS.charged || now - charge.since < STATUS.chargerSettleMs) return null;
  charge.done = true;
  return { kind: "power", icon: "battery-full", text: tr("Geladen · {p} %", { p }), tone: "normal", accent: "green", charge: { percent: p, charging: false } };
}

/** Energy saver switched on or off; the first reading, or one without the flag, says nothing. */
export function saverAlert(prev: PowerState | null, next: PowerState, tr: Tr): StatusAlert | null {
  if (prev?.saver === undefined || next.saver === undefined || prev.saver === next.saver) return null;
  return { kind: "saver", icon: "leaf", text: tr(next.saver ? "Energiesparen an" : "Energiesparen aus"), tone: "normal", ...(next.saver ? { accent: "green" } : { off: true }) };
}

/** What the alerts compare against: `null` (or no devices) until a seed or an event says otherwise. */
export interface StatusKnown { power: PowerState | null; online: boolean | null; devices: Set<string> }

/**
 * Merges a seed (the command or the event, in either order, partial or complete) into what is known: it fills only the
 * fields still unknown, so a later, fuller seed completes an early partial one and never overwrites what an event set.
 */
export function mergeSeed(known: StatusKnown, seed: { power: PowerState | null; online: boolean | null; devices: readonly string[] }): StatusKnown {
  return { power: known.power ?? seed.power, online: known.online ?? seed.online, devices: new Set([...known.devices, ...seed.devices]) };
}

/** Only a change of state; the first reading (`prev` null) is silent. */
export function netAlert(prev: boolean | null, next: boolean, tr: Tr): StatusAlert | null {
  if (prev === null || prev === next) return null;
  return { kind: "net", icon: next ? "wifi" : "wifi-off", text: tr(next ? "Online" : "Offline"), tone: "normal" };
}

/** A Bluetooth device connecting or leaving (sysevents.rs); `categories` are Windows' device categories, such as "Audio.Headphone" or "Input.Mouse". */
export interface BluetoothEvent { name: string; connected: boolean; battery: number | null; categories: string[] }

/** First match wins, so headphones and headsets are not taken for a phone. */
const BT_ICONS: [RegExp, StatusAlert["icon"]][] = [
  [/headphone|headset/, "headphones"], [/speaker/, "speaker-hifi"], [/mouse/, "mouse"], [/keyboard/, "keyboard"],
  [/gam|joystick/, "gamepad"], [/phone/, "phone"], [/watch|wearable/, "watch"],
];

/** The icon for a device by its categories; one Crest does not know shows the Bluetooth mark. */
export function btIcon(categories: readonly string[]): StatusAlert["icon"] {
  const c = categories.join(" ").toLowerCase();
  return BT_ICONS.find(([re]) => re.test(c))?.[1] ?? "bluetooth";
}

/** A device without a name says nothing useful, so it does not alert. */
export function btAlert(event: BluetoothEvent, tr: Tr): StatusAlert | null {
  const name = event.name.trim();
  if (!name) return null;
  const text = !event.connected ? tr("{n} · Getrennt", { n: name }) : event.battery === null ? name : tr("{n} · {p} %", { n: name, p: event.battery });
  return { kind: "bt", icon: btIcon(event.categories), text, tone: "normal", ...(event.connected ? {} : { off: true }) };
}

/** A volume or brightness reading from sysevents.rs and brightness.rs, which already drop repeats, Crest's own changes and the start. */
export interface LevelEvent { kind: "volume" | "brightness"; level: number; muted: boolean }

/** The HUD: the icon follows the level (half way splits low and high), the bar shows it, the text says the percent or that it is muted. */
export function levelAlert(e: LevelEvent, tr: Tr): StatusAlert {
  const p = Math.round(Math.min(100, Math.max(0, e.level)));
  if (e.kind === "brightness") return { kind: "brightness", icon: p < 50 ? "sun-dim" : "sun", text: tr("{p} %", { p }), tone: "normal", accent: "yellow", level: p };
  const icon = e.muted ? "speaker-x" : p === 0 ? "speaker-none" : p < 50 ? "speaker-low" : "speaker-high";
  return { kind: "volume", icon, text: e.muted ? tr("Stummgeschaltet") : tr("{p} %", { p }), tone: "normal", accent: "blue", level: p };
}

/** A Caps Lock or Num Lock toggle from sysevents.rs, which sends only changes, never the state at start. "insert" is a bare press of Insert, always `on`: programs keep their own overtype state. */
export interface LockEvent { key: "caps" | "num" | "insert"; on: boolean }

export function lockAlert(e: LockEvent, tr: Tr): StatusAlert {
  if (e.key === "insert") return { kind: "lock", icon: "keyboard", text: tr("Einfg"), tone: "normal" };
  if (e.key === "caps") return { kind: "lock", icon: e.on ? "lock" : "lock-open", text: tr(e.on ? "Feststelltaste an" : "Feststelltaste aus"), tone: "normal", ...(e.on ? { accent: "red" } : { off: true }) };
  return { kind: "lock", icon: "num-lock", text: tr(e.on ? "Num-Taste an" : "Num-Taste aus"), tone: "normal", ...(e.on ? {} : { off: true }) };
}

/** The default microphone was muted or unmuted: by the shortcut (mic.rs), a key on the laptop, Windows' settings or another app (sysevents.rs). */
export interface MicEvent { muted: boolean }

export function micAlert(e: MicEvent, tr: Tr): StatusAlert {
  return { kind: "mic", icon: e.muted ? "microphone-slash" : "microphone", text: tr(e.muted ? "Mikrofon ist stumm" : "Mikrofon ist an"), tone: "normal" };
}

/** A copy the Clipboard tool recorded (platform/clipboard): its kind, its text (for files their names, one per line) and how many are folders. */
export interface ClipEvent { kind: "text" | "link" | "image" | "files"; text: string; folders: number }

/**
 * A copy: the Clipboard tool's icon for its kind, in that tool's teal, and what was copied, never the copied text itself (a shared
 * screen would show it). Several files count their names; all of them folders say folders.
 */
export function clipAlert(e: ClipEvent, tr: Tr): StatusAlert {
  const base = { kind: "clip", tone: "normal", accent: "teal" } as const;
  if (e.kind === "text") return { ...base, icon: "text", text: tr("Text kopiert") };
  if (e.kind === "link") return { ...base, icon: "link", text: tr("Link kopiert") };
  if (e.kind === "image") return { ...base, icon: "image", text: tr("Bild kopiert") };
  const n = Math.max(1, e.text.split("\n").filter((name) => name.trim()).length);
  if (e.folders >= n) return { ...base, icon: "folder", text: n === 1 ? tr("Ordner kopiert") : tr("{n} Ordner kopiert", { n }) };
  return { ...base, icon: n === 1 ? "file" : "files", text: n === 1 ? tr("Datei kopiert") : tr("{n} Dateien kopiert", { n }) };
}

/** Windows moved the sound to another output (sysevents.rs): its name as the sound menu shows it and what kind of device it is. */
export interface OutputEvent { name: string; form: "headphones" | "speakers" | "display" | "other" }

const OUTPUT_ICONS: Record<OutputEvent["form"], StatusAlert["icon"]> = { headphones: "headphones", speakers: "speaker-hifi", display: "monitor", other: "speaker-high" };

/** An output without a name says nothing useful, so it does not alert. */
export function outputAlert(e: OutputEvent): StatusAlert | null {
  const name = e.name.trim();
  return name ? { kind: "output", icon: OUTPUT_ICONS[e.form] ?? "speaker-high", text: name, tone: "normal", accent: "blue" } : null;
}

/** Do not disturb or a focus session went on or off (sysevents.rs); `focus`: a focus session, the one starting or the one that ended. */
export interface FocusEvent { on: boolean; focus: boolean }

export function focusAlert(e: FocusEvent, tr: Tr): StatusAlert {
  const text = e.focus ? (e.on ? "Fokus an" : "Fokus aus") : e.on ? "Nicht stören an" : "Nicht stören aus";
  return { kind: "focus", icon: "moon", text: tr(text), tone: "normal", ...(e.on ? { accent: "violet" } : { off: true }) };
}

/**
 * The power mode the user chose (sysevents.rs, Windows' effective power mode): 1 best power efficiency, 2 balanced, 4 best performance.
 * Energy saver, game mode and mixed reality pass over it and come back, so Rust sends only a change of this one.
 */
export interface ModeEvent { mode: number }

const MODES: Record<number, [string, Hue]> = { 1: ["Beste Energieeffizienz", "green"], 2: ["Ausbalanciert", "sky"], 4: ["Beste Leistung", "orange"] };

export function modeAlert(e: ModeEvent, tr: Tr): StatusAlert | null {
  const mode = MODES[e.mode];
  return mode ? { kind: "mode", icon: "gauge", text: tr(mode[0]), tone: "normal", accent: mode[1] } : null;
}

/** Airplane mode went on or off (sysevents.rs). */
export function airplaneAlert(on: boolean, tr: Tr): StatusAlert {
  return { kind: "airplane", icon: "airplane", text: tr(on ? "Flugzeugmodus an" : "Flugzeugmodus aus"), tone: "normal", ...(on ? { accent: "orange" } : { off: true }) };
}

/** A monitor connected, disconnected or at another refresh rate (mirror.rs); `builtin`: the laptop's own screen, which often has no name. */
export interface DisplayEvent { name: string; hz: number | null; connected: boolean; builtin: boolean }

export function displayAlert(e: DisplayEvent, tr: Tr): StatusAlert {
  const n = e.name.trim() || (e.builtin ? tr("Eingebauter Bildschirm") : tr("Bildschirm"));
  const text = !e.connected ? tr("{n} · Getrennt", { n }) : e.hz ? tr("{n} · {hz} Hz", { n, hz: e.hz }) : n;
  return { kind: "display", icon: "monitor", text, tone: "normal", ...(e.connected ? { accent: "indigo" } : { off: true }) };
}

/** Alerts that answer something just done (a key, a level, a copy), as opposed to the ones that arrive on their own (charger, network, Bluetooth). */
export const INDICATORS: ReadonlySet<StatusAlert["kind"]> = new Set(["volume", "brightness", "lock", "mic", "clip"]);

/** Whether an alert is dropped for a fullscreen app on the notch's monitor: every one is, but an indicator with `everywhere` on. */
export const heldBack = (kind: StatusAlert["kind"], now: { fullscreen: boolean; everywhere: boolean }): boolean => now.fullscreen && !(now.everywhere && INDICATORS.has(kind));

type OsdAlerts = { volume: boolean; brightness: boolean; hideOsd: boolean; everywhere?: boolean };

/** Whether the option to hide the Windows indicator is in force: Crest's HUD stands in for both volume and brightness (Windows draws them in one flyout). */
export const osdArmed = (alerts: OsdAlerts): boolean => alerts.hideOsd && alerts.volume && alerts.brightness;

/**
 * Whether the Windows indicator is hidden now: the option is in force and Crest's HUD can show, so not in focus mode nor over a fullscreen
 * app, where status alerts are dropped, and not while a window rule or the hide shortcut hides Crest, which would leave no indicator at all
 * (#50). With `everywhere` on Crest's HUD shows over a fullscreen app and a hidden Crest, so the Windows indicator stays hidden there;
 * focus mode drops the HUD all the same.
 */
export function osdHidden(alerts: OsdAlerts, now: { focus: boolean; fullscreen: boolean; hidden: boolean }): boolean {
  return osdArmed(alerts) && !now.focus && (alerts.everywhere === true || (!now.fullscreen && !now.hidden));
}
