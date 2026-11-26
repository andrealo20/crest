import { test } from "node:test";
import assert from "node:assert/strict";
import { STATUS, airplaneAlert, btAlert, btIcon, chargedAlert, clipAlert, displayAlert, focusAlert, heldBack, levelAlert, lockAlert, mergeSeed, micAlert, modeAlert, netAlert, osdArmed, osdHidden, outputAlert, powerAlert, saverAlert } from "./status.ts";

const tr = (k: string, v: Record<string, string | number> = {}) => k.replace(/\{(\w+)\}/g, (_, x) => String(v[x]));
const s = (ac: boolean, percent: number | null, battery = true, charging = ac) => ({ ac, percent, battery, charging });

test("power", () => {
  const low = { warned20: false, warned10: false };
  assert.equal(powerAlert(null, s(true, 64), low, tr), null);
  assert.deepEqual(powerAlert(s(true, 64), s(false, 64), low, tr), { kind: "power", icon: "battery", text: "Akku · 64 %", tone: "normal", charge: { percent: 64, charging: false } });
  assert.equal(powerAlert(s(false, 64), s(false, 63), low, tr), null);
  assert.equal(powerAlert(s(false, 21), s(false, 20), low, tr)?.tone, "warning");
  assert.equal(powerAlert(s(false, 20), s(false, 19), low, tr), null);
  assert.equal(powerAlert(s(false, 11), s(false, 10), low, tr)?.tone, "critical");
  assert.equal(powerAlert(s(false, 10), s(true, 10), low, tr)?.text, "Lädt · 10 %");
  // Plugged in but not taking charge (full, or a charge limit): it does not say it is charging.
  assert.equal(powerAlert(s(false, 100), s(true, 100, true, false), low, tr)?.text, "Am Netzteil · 100 %");
  assert.equal(powerAlert(s(false, null), s(true, null, true, false), low, tr)?.text, "Am Netzteil");
  // Its battery is not green and has no bolt.
  const idle = powerAlert(s(false, 100), s(true, 100, true, false), low, tr);
  assert.equal(idle?.accent, undefined);
  assert.deepEqual(idle?.charge, { percent: 100, charging: false });
  assert.deepEqual(low, { warned20: false, warned10: false });
  assert.equal(powerAlert(s(true, 50, false), s(false, 50, false), low, tr), null);
});
test("power: unplugging low takes the low tone at once", () => {
  const low = { warned20: false, warned10: false };
  assert.deepEqual(powerAlert(s(true, 18), s(false, 18), low, tr), { kind: "power", icon: "battery", text: "Akku · 18 %", tone: "warning", charge: { percent: 18, charging: false } });
  assert.equal(powerAlert(s(false, 18), s(false, 17), low, tr), null);
  assert.equal(powerAlert(s(false, 11), s(false, 10), low, tr)?.tone, "critical");
  assert.equal(powerAlert(s(true, 8), s(false, 8), { warned20: false, warned10: false }, tr)?.tone, "critical");
});
test("power: a first state already low is silent for that level", () => {
  const low = { warned20: false, warned10: false };
  assert.equal(powerAlert(null, s(false, 15), low, tr), null);
  assert.deepEqual(low, { warned20: true, warned10: false });
  assert.equal(powerAlert(s(false, 15), s(false, 14), low, tr), null);
  assert.equal(powerAlert(s(false, 11), s(false, 10), low, tr)?.tone, "critical");
});
test("power: a jump from 25 to 9 gives one critical and no later warning", () => {
  const low = { warned20: false, warned10: false };
  assert.equal(powerAlert(s(false, 25), s(false, 9), low, tr)?.tone, "critical");
  assert.equal(powerAlert(s(false, 9), s(false, 8), low, tr), null);
  assert.equal(powerAlert(s(false, 8), s(false, 20), low, tr), null);
});
test("power: the warning fires again after plugging in", () => {
  const low = { warned20: false, warned10: false };
  assert.equal(powerAlert(s(false, 21), s(false, 20), low, tr)?.tone, "warning");
  assert.equal(powerAlert(s(false, 20), s(true, 20), low, tr)?.icon, "plug");
  assert.equal(powerAlert(s(true, 30), s(false, 30), low, tr)?.tone, "normal");
  assert.equal(powerAlert(s(false, 21), s(false, 20), low, tr)?.tone, "warning");
});
test("power: plug and unplug without a percent", () => {
  const low = { warned20: false, warned10: false };
  assert.deepEqual(powerAlert(s(false, null), s(true, null), low, tr), { kind: "power", icon: "plug", text: "Lädt", tone: "normal", accent: "green", charge: { percent: null, charging: true } });
  assert.deepEqual(powerAlert(s(true, null), s(false, null), low, tr), { kind: "power", icon: "battery", text: "Am Akku", tone: "normal", charge: { percent: null, charging: false } });
  assert.equal(powerAlert(s(false, null), s(false, null), low, tr), null);
});
test("net", () => {
  assert.equal(netAlert(null, false, tr), null);
  assert.equal(netAlert(true, false, tr)?.icon, "wifi-off");
  assert.equal(netAlert(false, true, tr)?.text, "Online");
  assert.equal(netAlert(true, true, tr), null);
});
test("bt", () => {
  const bt = (name: string, connected: boolean, battery: number | null, categories = ["Audio.Headphone"]) => btAlert({ name, connected, battery, categories }, tr);
  assert.equal(bt("Buds", true, 80)?.text, "Buds · 80 %");
  assert.equal(bt("Buds", true, null)?.text, "Buds");
  assert.equal(bt("Buds", false, null)?.text, "Buds · Getrennt");
  assert.equal(bt("Buds", false, null)?.off, true);
  assert.equal(bt("Buds", true, null)?.off, undefined);
  assert.equal(bt("  ", true, 50), null);
  assert.equal(bt("", false, null), null);
  // The icon follows the device, also when it leaves.
  assert.equal(bt("Mouse", false, null, ["Input.Mouse"])?.icon, "mouse");
});
test("bt: icon by Windows' device categories", () => {
  assert.equal(btIcon(["Audio.Headphone"]), "headphones");
  // A headset is not taken for a phone.
  assert.equal(btIcon(["Communication.Headset.Bluetooth"]), "headphones");
  assert.equal(btIcon(["Audio.Speaker"]), "speaker-hifi");
  assert.equal(btIcon(["Input.Mouse"]), "mouse");
  assert.equal(btIcon(["Input.Keyboard"]), "keyboard");
  assert.equal(btIcon(["Input.Gaming"]), "gamepad");
  assert.equal(btIcon(["Input.Gaming.Gamepad"]), "gamepad");
  assert.equal(btIcon(["Communication.Phone"]), "phone");
  assert.equal(btIcon(["Wearable.Watch"]), "watch");
  assert.equal(btIcon(["Other"]), "bluetooth");
  assert.equal(btIcon([]), "bluetooth");
});

test("seed: fills only what is still unknown", () => {
  const none = { power: null, online: null, devices: new Set<string>() };
  // A partial seed (registration still running), then the complete one.
  const partial = mergeSeed(none, { power: s(true, 64), online: null, devices: [] });
  const full = mergeSeed(partial, { power: s(true, 64), online: true, devices: ["Buds"] });
  assert.deepEqual(full, { power: s(true, 64), online: true, devices: new Set(["Buds"]) });
  // An event before any seed stays; a seed after an event does not overwrite it.
  const evented = mergeSeed({ power: s(false, 40), online: false, devices: new Set<string>() }, { power: s(true, 64), online: true, devices: [] });
  assert.deepEqual([evented.power, evented.online], [s(false, 40), false]);
  // Devices are the union of what is known and what the seed lists.
  assert.deepEqual(mergeSeed({ ...none, devices: new Set(["A"]) }, { power: null, online: null, devices: ["A", "B"] }).devices, new Set(["A", "B"]));
});

test("level: volume icon, bar and text", () => {
  const v = (level: number, muted = false) => levelAlert({ kind: "volume", level, muted }, tr);
  assert.deepEqual(v(64), { kind: "volume", icon: "speaker-high", text: "64 %", tone: "normal", accent: "blue", level: 64 });
  assert.equal(v(49).icon, "speaker-low");
  assert.equal(v(50).icon, "speaker-high");
  assert.deepEqual([v(0).icon, v(0).text], ["speaker-none", "0 %"]);
  // Muted keeps the level for the bar and says so instead of the percent.
  assert.deepEqual(v(30, true), { kind: "volume", icon: "speaker-x", text: "Stummgeschaltet", tone: "normal", accent: "blue", level: 30 });
});
test("level: brightness and out of range readings", () => {
  const b = (level: number) => levelAlert({ kind: "brightness", level, muted: false }, tr);
  assert.deepEqual(b(80), { kind: "brightness", icon: "sun", text: "80 %", tone: "normal", accent: "yellow", level: 80 });
  assert.equal(b(20).icon, "sun-dim");
  assert.equal(b(140).level, 100);
  assert.equal(b(-5).level, 0);
  assert.equal(b(33.6).text, "34 %");
});
test("osd: hidden only while the HUD replaces both and can show", () => {
  const on = { volume: true, brightness: true, hideOsd: true };
  const shown = { focus: false, fullscreen: false, hidden: false };
  assert.equal(osdHidden(on, shown), true);
  assert.equal(osdHidden({ ...on, hideOsd: false }, shown), false);
  assert.equal(osdHidden({ ...on, brightness: false }, shown), false);
  assert.equal(osdHidden({ ...on, volume: false }, shown), false);
  assert.equal(osdHidden(on, { ...shown, fullscreen: true }), false);
  // Hidden by a window rule or the hide shortcut, Crest shows no HUD, so Windows' own indicator comes back (#50).
  assert.equal(osdHidden(on, { ...shown, hidden: true }), false);
  // Focus mode drops Crest's HUD, also with the indicators shown everywhere, so Windows' own comes back.
  assert.equal(osdHidden(on, { ...shown, focus: true }), false);
  assert.equal(osdHidden({ ...on, everywhere: true }, { ...shown, focus: true }), false);
  // Focus mode or a fullscreen app only pause it: the option stays in force, so the process that restores the indicator stays too.
  assert.equal(osdArmed(on), true);
  assert.equal(osdArmed({ ...on, volume: false }), false);
  // With the indicators shown everywhere Crest's HUD shows in both cases, so Windows' own stays hidden.
  assert.equal(osdHidden({ ...on, everywhere: true }, { ...shown, fullscreen: true, hidden: true }), true);
  assert.equal(osdHidden({ ...on, hideOsd: false, everywhere: true }, shown), false);
});
test("fullscreen: alerts wait it out, the indicators not when shown everywhere", () => {
  assert.equal(heldBack("volume", { fullscreen: true, everywhere: false }), true);
  assert.equal(heldBack("volume", { fullscreen: true, everywhere: true }), false);
  assert.equal(heldBack("lock", { fullscreen: true, everywhere: true }), false);
  assert.equal(heldBack("mic", { fullscreen: true, everywhere: true }), false);
  // Charger, network and Bluetooth arrive on their own and keep waiting.
  assert.equal(heldBack("bt", { fullscreen: true, everywhere: true }), true);
  assert.equal(heldBack("power", { fullscreen: true, everywhere: true }), true);
  assert.equal(heldBack("brightness", { fullscreen: false, everywhere: false }), false);
});
test("lock: Caps Lock and Num Lock", () => {
  // Caps Lock switched on is a red padlock, switched off an open one in the text's colour.
  assert.deepEqual(lockAlert({ key: "caps", on: true }, tr), { kind: "lock", icon: "lock", text: "Feststelltaste an", tone: "normal", accent: "red" });
  assert.equal(lockAlert({ key: "caps", on: false }, tr).text, "Feststelltaste aus");
  assert.equal(lockAlert({ key: "caps", on: false }, tr).icon, "lock-open");
  assert.equal(lockAlert({ key: "caps", on: false }, tr).accent, undefined);
  // Off differs from on beyond the text, for the side edge's icon.
  assert.equal(lockAlert({ key: "caps", on: false }, tr).off, true);
  assert.deepEqual(lockAlert({ key: "num", on: true }, tr), { kind: "lock", icon: "num-lock", text: "Num-Taste an", tone: "normal" });
  assert.equal(lockAlert({ key: "num", on: false }, tr).text, "Num-Taste aus");
  // No level bar: the alert is only the icon and the text.
  assert.equal(lockAlert({ key: "num", on: true }, tr).level, undefined);
});
test("lock: Insert says it was pressed, never on or off", () => {
  assert.deepEqual(lockAlert({ key: "insert", on: true }, tr), { kind: "lock", icon: "keyboard", text: "Einfg", tone: "normal" });
});
test("clip: what was copied, in the Clipboard tool's teal, never the copied text", () => {
  assert.deepEqual(clipAlert({ kind: "text", text: "hunter2", folders: 0 }, tr), { kind: "clip", tone: "normal", accent: "teal", icon: "text", text: "Text kopiert" });
  const shown = (kind: "text" | "link" | "image" | "files", text: string, folders = 0) => {
    const a = clipAlert({ kind, text, folders }, tr);
    return [a.icon, a.text];
  };
  assert.deepEqual(shown("link", "https://example.com"), ["link", "Link kopiert"]);
  assert.deepEqual(shown("image", "1600 × 1000"), ["image", "Bild kopiert"]);
  assert.deepEqual(shown("files", "Rechnung.pdf"), ["file", "Datei kopiert"]);
  // Names one per line; a mix of files and folders counts as files, only folders as folders.
  assert.deepEqual(shown("files", "a.pdf\nb.docx\nProjekte", 1), ["files", "3 Dateien kopiert"]);
  assert.deepEqual(shown("files", "Projekte", 1), ["folder", "Ordner kopiert"]);
  assert.deepEqual(shown("files", "Projekte\nFotos", 2), ["folder", "2 Ordner kopiert"]);
  // A copy answers something just done, so it shows over a fullscreen app when the indicators show everywhere.
  assert.equal(heldBack("clip", { fullscreen: true, everywhere: true }), false);
});
test("mic: the shortcut's mute and unmute", () => {
  assert.deepEqual(micAlert({ muted: true }, tr), { kind: "mic", icon: "microphone-slash", text: "Mikrofon ist stumm", tone: "normal" });
  assert.deepEqual(micAlert({ muted: false }, tr), { kind: "mic", icon: "microphone", text: "Mikrofon ist an", tone: "normal" });
});
test("charged: charging stops on the charger near the top, once per charge, not while the charger settles", () => {
  const charge = { since: 0, done: false };
  const at = (ac: boolean, percent: number | null, charging: boolean) => ({ ac, percent, battery: true, charging });
  const later = 1000 + STATUS.chargerSettleMs;
  // Plugged in at 1000: the flag can flip in the first minute, which says nothing.
  assert.equal(chargedAlert(at(false, 70, false), at(true, 70, true), charge, 1000, tr), null);
  assert.equal(chargedAlert(at(true, 90, true), at(true, 90, false), charge, 2000, tr), null);
  assert.equal(chargedAlert(at(true, 90, false), at(true, 90, true), charge, 3000, tr), null);
  // Past it, charging that stops at 80 % or more is a full battery or a charge limit.
  assert.deepEqual(chargedAlert(at(true, 100, true), at(true, 100, false), charge, later, tr), { kind: "power", icon: "battery-full", text: "Geladen · 100 %", tone: "normal", accent: "green", charge: { percent: 100, charging: false } });
  // Once per charge: trickle charging at the top flips it again.
  assert.equal(chargedAlert(at(true, 99, false), at(true, 99, true), charge, later + 1, tr), null);
  assert.equal(chargedAlert(at(true, 100, true), at(true, 100, false), charge, later + 2, tr), null);
  // Unplugging starts over; below 80 % a stop is a pause, not a charged battery.
  assert.equal(chargedAlert(at(true, 100, false), at(false, 100, false), charge, later + 3, tr), null);
  assert.deepEqual(charge, { since: 0, done: false });
  assert.equal(chargedAlert(at(false, 50, false), at(true, 50, true), charge, later + 4, tr), null);
  assert.equal(chargedAlert(at(true, 60, true), at(true, 60, false), charge, later + 4 + STATUS.chargerSettleMs, tr), null);
  assert.equal(chargedAlert(at(true, 80, true), at(true, 80, false), charge, later + 4 + STATUS.chargerSettleMs, tr)?.text, "Geladen · 80 %");
  // A first reading on the charger counts from then, as does a percent Windows does not know.
  const fresh = { since: 0, done: false };
  assert.equal(chargedAlert(null, at(true, 95, true), fresh, 5000, tr), null);
  assert.equal(fresh.since, 5000);
  assert.equal(chargedAlert(at(true, null, true), at(true, null, false), fresh, 5000 + STATUS.chargerSettleMs, tr), null);
});
test("saver: Energy saver on and off, nothing from a first reading or one without the flag", () => {
  const at = (saver?: boolean) => ({ ac: false, percent: 50, battery: true, charging: false, ...(saver === undefined ? {} : { saver }) });
  assert.deepEqual(saverAlert(at(false), at(true), tr), { kind: "saver", icon: "leaf", text: "Energiesparen an", tone: "normal", accent: "green" });
  assert.deepEqual(saverAlert(at(true), at(false), tr), { kind: "saver", icon: "leaf", text: "Energiesparen aus", tone: "normal", off: true });
  assert.equal(saverAlert(null, at(true), tr), null);
  assert.equal(saverAlert(at(), at(true), tr), null);
  assert.equal(saverAlert(at(true), at(true), tr), null);
});
test("output: the new output's name and an icon for its kind", () => {
  assert.deepEqual(outputAlert({ name: " Headphones (WH-1000XM5) ", form: "headphones" }), { kind: "output", icon: "headphones", text: "Headphones (WH-1000XM5)", tone: "normal", accent: "blue" });
  assert.equal(outputAlert({ name: "Speakers", form: "speakers" })?.icon, "speaker-hifi");
  assert.equal(outputAlert({ name: "DELL U2720Q", form: "display" })?.icon, "monitor");
  assert.equal(outputAlert({ name: "Line out", form: "other" })?.icon, "speaker-high");
  assert.equal(outputAlert({ name: "  ", form: "speakers" }), null);
});
test("focus: Do not disturb and a focus session, on and off", () => {
  assert.deepEqual(focusAlert({ on: true, focus: false }, tr), { kind: "focus", icon: "moon", text: "Nicht stören an", tone: "normal", accent: "violet" });
  assert.deepEqual(focusAlert({ on: false, focus: false }, tr), { kind: "focus", icon: "moon", text: "Nicht stören aus", tone: "normal", off: true });
  assert.equal(focusAlert({ on: true, focus: true }, tr).text, "Fokus an");
  assert.equal(focusAlert({ on: false, focus: true }, tr).text, "Fokus aus");
});
test("mode: the three power modes, nothing for one Windows passes over", () => {
  assert.deepEqual(modeAlert({ mode: 1 }, tr), { kind: "mode", icon: "gauge", text: "Beste Energieeffizienz", tone: "normal", accent: "green" });
  assert.equal(modeAlert({ mode: 2 }, tr)?.text, "Ausbalanciert");
  assert.equal(modeAlert({ mode: 4 }, tr)?.text, "Beste Leistung");
  for (const mode of [0, 3, 5, 6, -1]) assert.equal(modeAlert({ mode }, tr), null);
});
test("airplane: on in orange, off dimmed", () => {
  assert.deepEqual(airplaneAlert(true, tr), { kind: "airplane", icon: "airplane", text: "Flugzeugmodus an", tone: "normal", accent: "orange" });
  assert.deepEqual(airplaneAlert(false, tr), { kind: "airplane", icon: "airplane", text: "Flugzeugmodus aus", tone: "normal", off: true });
});
test("display: a monitor with its refresh rate, gone, or the laptop's own screen without a name", () => {
  assert.deepEqual(displayAlert({ name: "DELL U2720Q", hz: 60, connected: true, builtin: false }, tr), { kind: "display", icon: "monitor", text: "DELL U2720Q · 60 Hz", tone: "normal", accent: "indigo" });
  assert.deepEqual(displayAlert({ name: "DELL U2720Q", hz: null, connected: false, builtin: false }, tr), { kind: "display", icon: "monitor", text: "DELL U2720Q · Getrennt", tone: "normal", off: true });
  assert.equal(displayAlert({ name: "", hz: 120, connected: true, builtin: true }, tr).text, "Eingebauter Bildschirm · 120 Hz");
  assert.equal(displayAlert({ name: " ", hz: null, connected: true, builtin: false }, tr).text, "Bildschirm");
});
