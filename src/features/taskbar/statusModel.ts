// The rules of the bar's Stato item: which glyph each state draws, what its name says, how wide it is. Pure, so they can be tested
// without the app around them; the state comes from Rust's events (sysevents.rs, services.ts status.onBar).

import type { PowerState } from "../../notch/row/status.ts";
import { batteryWidth, type NetGlyphName } from "../../ui/glyphModel.ts";
import { trayIcon } from "./model.ts";

/** The connection in use (`status://network`): its kind, whether a Wi-Fi radio is on (null: none), its signal 0..5 and its name, Wi-Fi only. */
export interface NetworkState { kind: "wired" | "wireless" | "none"; wifi: boolean | null; bars: number | null; ssid: string | null }
/** The default output's volume (`status://sound`), 0..100. */
export interface SoundState { level: number; muted: boolean }
/** What Stato draws; null where Rust has said nothing yet, or never will (no battery reading). */
export interface BarStatus { power: PowerState | null; network: NetworkState | null; sound: SoundState | null }

/** A network's signal (0..5, null unknown) as the fan's level: four bars or more, or none known, light the whole fan. */
export function barsGlyph(bars: number | null): "wifi-0" | "wifi-1" | "wifi-2" | "wifi-3" {
  return bars === null || bars >= 4 ? "wifi-3" : bars >= 3 ? "wifi-2" : bars >= 1 ? "wifi-1" : "wifi-0";
}

/** The network's glyph: the cable, Wi-Fi off, on with no network, its signal in four steps, or no network at all. */
export function netGlyph(n: NetworkState): NetGlyphName {
  if (n.kind === "wired") return "wired";
  if (n.kind === "wireless") return barsGlyph(n.bars);
  return n.wifi === null ? "offline" : n.wifi ? "wifi-unlinked" : "wifi-off";
}

/**
 * The quick panel's Wi-Fi tile: its line, the SSID when Windows gives it, else a text key. While a cable carries the internet it says
 * only On or Off, since Windows may keep Wi-Fi associated beside the cable.
 */
export function wifiTile(on: boolean, n: NetworkState | null): { key: "An" | "Aus" | "Verbunden" | "Nicht verbunden"; ssid: string | null } {
  if (!on) return { key: "Aus", ssid: null };
  if (n?.kind === "wireless") return { key: "Verbunden", ssid: n.ssid };
  return { key: n?.kind === "wired" ? "An" : "Nicht verbunden", ssid: null };
}

/** The speaker's glyph, with VolumeTile's thresholds; null until the volume is known. */
export function soundGlyph(s: SoundState | null): "muted" | "low" | "mid" | "high" | null {
  if (!s) return null;
  if (s.muted || s.level === 0) return "muted";
  return s.level < 34 ? "low" : s.level < 67 ? "mid" : "high";
}

/** The battery's glyph, none without a battery; under 10 % it warns only away from the charger. An unknown level draws as high. */
export function batteryGlyph(p: PowerState | null): "charging" | "full" | "high" | "medium" | "low" | "warning" | null {
  if (!p?.battery) return null;
  if (p.charging) return "charging";
  const v = p.percent;
  if (v === null) return "high";
  return v >= 90 ? "full" : v >= 60 ? "high" : v >= 30 ? "medium" : v >= 10 || p.ac ? "low" : "warning";
}

/** Stato's name as `t()` keys with their values, in the order of the glyphs: network, volume, battery (only with a level). */
export function statusParts(s: BarStatus): [string, Record<string, string | number>?][] {
  const parts: [string, Record<string, string | number>?][] = [];
  const n = s.network;
  if (n?.kind === "wireless") parts.push(n.ssid ? ["WLAN: {name}", { name: n.ssid }] : ["WLAN"]);
  else if (n?.kind === "wired") parts.push(["Ethernet"]);
  else if (n) parts.push([n.wifi === null ? "Keine Verbindung" : n.wifi ? "Nicht verbunden" : "WLAN aus"]);
  if (s.sound) parts.push(soundGlyph(s.sound) === "muted" ? ["Stummgeschaltet"] : ["Lautstärke {p} %", { p: s.sound.level }]);
  const p = s.power;
  if (p?.battery && p.percent !== null) parts.push([p.charging ? "Akku {p} %, lädt" : "Akku {p} %", { p: p.percent }]);
  return parts;
}

/** Stato's glyphs at the tray's icon size, two thirds of the app icon (design 5.2). */
export const glyphSize = trayIcon;
/** Stato's pill for a bar `height` tall: 70 % of it on an even number of px, so the glyphs centre on whole pixels, and a third of
 *  its own height on each side of the glyphs. */
export const statusPill = (height: number) => {
  const h = 2 * Math.round(height * 0.35);
  return { height: h, pad: Math.round(h / 3) };
};
/** The room between Stato's glyphs: 6 px in the pill, 4 px without it (Tiles, whose tile is already a rounded fill). */
export const glyphGap = (pill: boolean) => (pill ? 6 : 4);
/** Stato's width for `count` glyphs, the battery among them at its own width: glyphGap apart, inside the pill's sides for a bar
 *  `height` tall, or with no pill (`height` null) the 8 px a bar button keeps on each side. The pill is the whole button, so the
 *  bar's fit measures exactly this. */
export const statusWidth = (size: number, count: number, battery: boolean, height: number | null) =>
  (count - (battery ? 1 : 0)) * glyphSize(size) + (battery ? batteryWidth(glyphSize(size)) : 0) + (count - 1) * glyphGap(height !== null) +
  (height === null ? 16 : 2 * statusPill(height).pad);
