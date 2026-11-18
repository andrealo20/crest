// The rules of the bar's Stato item: which glyph each state draws, what its name says, how wide it is. Pure, so they can be tested
// without the app around them; the state comes from Rust's events (sysevents.rs, services.ts status.onBar).

import type { PowerState } from "../../notch/row/status.ts";

/** The connection in use (`status://network`): its kind, whether a Wi-Fi radio is on (null: none), its signal 0..5 and its name, Wi-Fi only. */
export interface NetworkState { kind: "wired" | "wireless" | "none"; wifi: boolean | null; bars: number | null; ssid: string | null }
/** The default output's volume (`status://sound`), 0..100. */
export interface SoundState { level: number; muted: boolean }
/** What Stato draws; null where Rust has said nothing yet, or never will (no battery reading). */
export interface BarStatus { power: PowerState | null; network: NetworkState | null; sound: SoundState | null }

/** The network's glyph: the cable, Wi-Fi off, on with no network, its signal in four steps, or no network at all. */
export function netGlyph(n: NetworkState): "wired" | "wifi-off" | "wifi-unlinked" | "wifi-0" | "wifi-1" | "wifi-2" | "wifi-3" | "offline" {
  if (n.kind === "wired") return "wired";
  if (n.kind === "wireless") return n.bars === null || n.bars >= 4 ? "wifi-3" : n.bars >= 3 ? "wifi-2" : n.bars >= 1 ? "wifi-1" : "wifi-0";
  return n.wifi === null ? "offline" : n.wifi ? "wifi-unlinked" : "wifi-off";
}

/**
 * The quick panel's Wi-Fi tile: its line (the SSID when Windows gives it, else a text key) and its glyph. While a cable carries the
 * internet it says only On or Off, with no glyph, since Windows may keep Wi-Fi associated beside the cable.
 */
export function wifiTile(on: boolean, n: NetworkState | null): { key: "An" | "Aus" | "Verbunden" | "Nicht verbunden"; ssid: string | null; glyph: ReturnType<typeof netGlyph> | null } {
  const glyph = n && n.kind !== "wired" ? netGlyph(n) : null;
  if (!on) return { key: "Aus", ssid: null, glyph };
  if (n?.kind === "wireless") return { key: "Verbunden", ssid: n.ssid, glyph };
  return { key: n?.kind === "wired" ? "An" : "Nicht verbunden", ssid: null, glyph };
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

/** Stato's glyphs at two thirds of the app icon, as the tray's icons (design 5.2). */
export const glyphSize = (size: number) => Math.round((size * 2) / 3);
/** Stato's width for `count` glyphs: the glyphs 4 px apart, with the 8 px a bar button keeps on each side. */
export const statusWidth = (size: number, count: number) => count * glyphSize(size) + (count - 1) * 4 + 16;
