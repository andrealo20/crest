// The words of the bar's Windows buttons that switch something of Windows: the desktop's icons, Eject and the mobile
// hotspot. Pure, with t() passed in, so it can be tested without the app around it.

import type { Hotspot } from "../../platform/services";
import type { DiskDrive } from "./disks";

/** t(), or in a test the German text with its values put in. */
type Tr = (key: string, values?: Record<string, string | number>) => string;

/** A button that reads Windows' state reads it again as the pointer comes over it, at most this often (ms). */
export const HOVER_GAP = 2000;
/** The hotspot is read this often while it is on and the bar shows: Windows turns it off by itself after a while without devices. */
export const HOTSPOT_EVERY = 60_000;

const FAILED = "Das hat nicht geklappt";

/** What the click does: hide or show them; not read yet, the click tries to hide them. */
export const deskIconsName = (shown: boolean | null, tr: Tr): string =>
  tr(shown === null ? "Desktopsymbole" : shown ? "Desktopsymbole ausblenden" : "Desktopsymbole einblenden");

/** A switch that failed: Explorer's desktop not there (restarting), or anything else. */
export const deskIconsNote = (code: unknown, tr: Tr): string => tr(code === "desktop" ? "Desktop nicht gefunden" : FAILED);

/** Why the hotspot cannot be used, by its state. */
const UNUSABLE: Partial<Record<Hotspot["state"], string>> = {
  offline: "Keine Verbindung",
  policy: "Von der Organisation gesperrt",
  denied: "Vom System nicht erlaubt",
  unsupported: "Dieser PC kann keinen Hotspot erstellen",
};

/** A click opens Windows' Mobile hotspot page: it cannot be switched from here, or Windows never answered. */
export const hotspotOpens = (h: Hotspot | null): boolean => !h || h.state in UNUSABLE;

/**
 * The hotspot button's name, as the clock's count joins its name (Widget.tsx): what a click does and how many devices use it, or
 * why it cannot be used.
 */
export function hotspotName(h: Hotspot | null, tr: Tr): string {
  const why = h && UNUSABLE[h.state];
  if (why) return `${tr("Mobiler Hotspot")}: ${tr(why)}`;
  if (h?.state === "off") return tr("Mobilen Hotspot einschalten");
  if (h?.state !== "on") return tr("Mobiler Hotspot");
  const off = tr("Mobilen Hotspot ausschalten");
  return h.clients ? `${off}, ${tr(h.clients === 1 ? "{n} Gerät verbunden" : "{n} Geräte verbunden", { n: h.clients })}` : off;
}

const HOTSPOT_NOTES: Record<string, string> = {
  "wifi-off": "WLAN ist ausgeschaltet",
  "bt-off": "Bluetooth ist ausgeschaltet",
  limited: "Eingeschränkte Verbindung",
  busy: "Wird schon umgeschaltet",
  operator: "Vom Mobilfunkanbieter nicht erlaubt",
  offline: "Keine Verbindung",
};

/** What a hotspot switch that failed says (toggles.rs tether_code). */
export const hotspotNote = (code: unknown, tr: Tr): string => tr((typeof code === "string" && Object.hasOwn(HOTSPOT_NOTES, code) && HOTSPOT_NOTES[code]) || FAILED);

/**
 * What an eject of the drive `name` says (disks.rs veto_code): null, it can be removed; an app that holds it by its file's name
 * without the extension, else that it is in use; then the reasons Crest can give.
 */
export function ejectNote(code: string | null, name: string, tr: Tr): string {
  if (code === null) return tr("{name} kann entfernt werden", { name });
  const app = code.startsWith("app:") ? code.slice(4).replace(/\.[^.]*$/, "") : null;
  if (app) return tr("{app} verwendet {name} noch", { app, name });
  if (code === "busy" || app === "") return tr("{name} wird noch verwendet", { name });
  if (code === "rights") return tr("Nur direkt am PC möglich");
  if (code === "fixed") return tr("Crest kann dieses Laufwerk nicht auswerfen");
  if (code === "unknown") return tr("Laufwerk nicht mehr gefunden");
  return tr(FAILED);
}

/** The Eject button's name: with no drive to eject it says so; not read yet, its plain name. */
export const ejectName = (removable: DiskDrive[] | null, tr: Tr): string =>
  removable && !removable.length ? `${tr("USB-Laufwerk auswerfen")}: ${tr("Kein USB-Laufwerk")}` : tr("USB-Laufwerk auswerfen");
