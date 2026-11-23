import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deskIconsName, deskIconsNote, ejectName, ejectNote, hotspotName, hotspotNote, hotspotOpens } from "./toggles.ts";
import type { Hotspot } from "../../platform/services.ts";

/** t() without a dictionary: the German text with its values put in. */
const tr = (key: string, values?: Record<string, string | number>) => key.replace(/\{(\w+)\}/g, (_, k: string) => String(values?.[k]));
const spot = (state: Hotspot["state"], clients = 0): Hotspot => ({ state, clients, max: 8 });

test("the desktop icons button is named by what its click does", () => {
  assert.equal(deskIconsName(true, tr), "Desktopsymbole ausblenden");
  assert.equal(deskIconsName(false, tr), "Desktopsymbole einblenden");
  // Not read: the click tries to hide them.
  assert.equal(deskIconsName(null, tr), "Desktopsymbole");
  assert.equal(deskIconsNote("desktop", tr), "Desktop nicht gefunden");
  assert.equal(deskIconsNote("failed", tr), "Das hat nicht geklappt");
  assert.equal(deskIconsNote(new Error("x"), tr), "Das hat nicht geklappt");
});

test("the hotspot button says what its click does, how many devices use it, or why it cannot be used", () => {
  assert.equal(hotspotName(spot("on"), tr), "Mobilen Hotspot ausschalten");
  assert.equal(hotspotName(spot("on", 1), tr), "Mobilen Hotspot ausschalten, 1 Gerät verbunden");
  assert.equal(hotspotName(spot("on", 2), tr), "Mobilen Hotspot ausschalten, 2 Geräte verbunden");
  assert.equal(hotspotName(spot("off"), tr), "Mobilen Hotspot einschalten");
  assert.equal(hotspotName(spot("turning"), tr), "Mobiler Hotspot");
  assert.equal(hotspotName(null, tr), "Mobiler Hotspot");
  assert.equal(hotspotName(spot("offline"), tr), "Mobiler Hotspot: Keine Verbindung");
  assert.equal(hotspotName(spot("policy"), tr), "Mobiler Hotspot: Von der Organisation gesperrt");
  assert.equal(hotspotName(spot("denied"), tr), "Mobiler Hotspot: Vom System nicht erlaubt");
  assert.equal(hotspotName(spot("unsupported"), tr), "Mobiler Hotspot: Dieser PC kann keinen Hotspot erstellen");
});

test("a hotspot that cannot be switched opens Windows' page instead", () => {
  for (const s of ["offline", "policy", "denied", "unsupported"] as const) assert.equal(hotspotOpens(spot(s)), true, s);
  for (const s of ["on", "off", "turning"] as const) assert.equal(hotspotOpens(spot(s)), false, s);
  // Never read (Windows would not answer): its page too.
  assert.equal(hotspotOpens(null), true);
});

test("each answer of a hotspot switch has its own words, an unknown one the general", () => {
  assert.equal(hotspotNote("wifi-off", tr), "WLAN ist ausgeschaltet");
  assert.equal(hotspotNote("bt-off", tr), "Bluetooth ist ausgeschaltet");
  assert.equal(hotspotNote("limited", tr), "Eingeschränkte Verbindung");
  assert.equal(hotspotNote("busy", tr), "Wird schon umgeschaltet");
  assert.equal(hotspotNote("operator", tr), "Vom Mobilfunkanbieter nicht erlaubt");
  assert.equal(hotspotNote("offline", tr), "Keine Verbindung");
  assert.equal(hotspotNote("failed", tr), "Das hat nicht geklappt");
  assert.equal(hotspotNote("policy", tr), "Das hat nicht geklappt");
  assert.equal(hotspotNote(undefined, tr), "Das hat nicht geklappt");
});

test("an eject says the drive can go, who holds it, or why not", () => {
  const name = "STICK (E:)";
  assert.equal(ejectNote(null, name, tr), "STICK (E:) kann entfernt werden");
  assert.equal(ejectNote("busy", name, tr), "STICK (E:) wird noch verwendet");
  // The app's file without its extension; a name with dots keeps all but the last.
  assert.equal(ejectNote("app:WINWORD.EXE", name, tr), "WINWORD verwendet STICK (E:) noch");
  assert.equal(ejectNote("app:my.tool.exe", name, tr), "my.tool verwendet STICK (E:) noch");
  assert.equal(ejectNote("app:robocopy", name, tr), "robocopy verwendet STICK (E:) noch");
  // No name to give: as busy.
  assert.equal(ejectNote("app:", name, tr), "STICK (E:) wird noch verwendet");
  assert.equal(ejectNote("app:.exe", name, tr), "STICK (E:) wird noch verwendet");
  assert.equal(ejectNote("rights", name, tr), "Nur direkt am PC möglich");
  assert.equal(ejectNote("fixed", name, tr), "Crest kann dieses Laufwerk nicht auswerfen");
  assert.equal(ejectNote("unknown", name, tr), "Laufwerk nicht mehr gefunden");
  assert.equal(ejectNote("failed", name, tr), "Das hat nicht geklappt");
  assert.equal(ejectNote("something new", name, tr), "Das hat nicht geklappt");
});

test("the eject button says so while no drive can be ejected", () => {
  assert.equal(ejectName([], tr), "USB-Laufwerk auswerfen: Kein USB-Laufwerk");
  assert.equal(ejectName([{ letter: "E:", name: "STICK", total: 8, free: 4, removable: true, system: false }], tr), "USB-Laufwerk auswerfen");
  // Not read yet: the plain name.
  assert.equal(ejectName(null, tr), "USB-Laufwerk auswerfen");
});

test("Keep awake reaches the bar with the feed's stores, so its widget hears it with no panel open", () => {
  const src = readFileSync(join(import.meta.dirname, "barStores.ts"), "utf8");
  const line = (name: string) => src.match(new RegExp(`export const ${name} = \\{([^}]*)\\}`))?.[1].split(",").map((s) => s.trim()) ?? [];
  assert.ok(line("feedStores").includes("awake"));
  assert.ok(!line("panelStores").includes("awake"));
});
