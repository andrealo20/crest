import { test } from "node:test";
import assert from "node:assert/strict";
import { SETTINGS, clampSetting, isColourQuery, nudged, settingHits, type NamesContext } from "./settingsTable.ts";

const tr = (key: string, values?: Record<string, string | number>) => key.replace(/\{(\w+)\}/g, (_, k: string) => String(values?.[k] ?? ""));
const EN: Record<string, string> = { Desktopsymbole: "Desktop icons", Höhe: "Height", Taskleiste: "Taskbar", Transparenz: "Transparency", Lautstärke: "Volume", Glas: "Glass", Aus: "Off", Themen: "Themes", Rosa: "Pink" };
const ctx: NamesContext = { tr, en: (key) => EN[key] ?? key, themes: [{ id: "dracula", name: "Dracula" }, { id: "dark", name: "Dark" }] };
const spec = (id: string) => {
  const s = SETTINGS.find((x) => x.id === id);
  assert.ok(s && s.kind === "number", id);
  return s;
};
const actions = (query: string) => settingHits(query, ctx).map((h) => h.action);

test("a setting by name with a number sets it, held to its limits, in the interface language or in English", () => {
  assert.deepEqual(actions("höhe 48")[0], { do: "set", id: "height", to: 48 });
  assert.deepEqual(actions("taskbar height 48")[0], { do: "set", id: "height", to: 48 });
  assert.deepEqual(actions("höhe 999")[0], { do: "set", id: "height", to: 64 });
  assert.deepEqual(actions("transparenz -5")[0], { do: "set", id: "transparency", to: 0 });
  assert.deepEqual(actions("volume 150")[0], { do: "set", id: "volume", to: 100 });
  assert.deepEqual(actions("volume 30%")[0], { do: "set", id: "volume", to: 30 });
  assert.equal(clampSetting(spec("height"), 47.6), 48);
});

test("without a number a setting goes up or down a step, or opens where it lives", () => {
  assert.deepEqual(actions("höhe"), [
    { do: "nudge", id: "height", by: 1 },
    { do: "nudge", id: "height", by: -1 },
    { do: "settings", section: "taskbar-look" },
  ]);
  assert.deepEqual(actions("lautstärke"), [
    { do: "nudge", id: "volume", by: 1 },
    { do: "nudge", id: "volume", by: -1 },
  ]);
  assert.equal(nudged(spec("height"), 63, 1), 64);
  assert.equal(nudged(spec("height"), 40, -1), 38);
  assert.equal(nudged(spec("transparency"), 0, -1), 0);
});

test("a switch flips", () => {
  assert.deepEqual(actions("automatisch ausblenden"), [{ do: "toggle", id: "autoHide" }]);
});

test("a choice lists its options, or the one named", () => {
  assert.deepEqual(actions("glas"), [
    { do: "set", id: "glass", to: "off" },
    { do: "set", id: "glass", to: "crest" },
    { do: "set", id: "glass", to: "plus" },
  ]);
  assert.deepEqual(actions("glass off"), [{ do: "set", id: "glass", to: "off" }]);
  assert.deepEqual(actions("themen dracula"), [{ do: "set", id: "theme", to: "dracula" }]);
  assert.deepEqual(actions("themen"), [{ do: "settings", section: "themes" }]);
});

test("a colour by name or by code opens Themes and nothing else", () => {
  for (const q of ["rosa", "pink", "#ff69b4"]) assert.deepEqual(actions(q), [{ do: "settings", section: "themes" }], q);
  assert.equal(isColourQuery("holiday", ctx), false);
});

test("words that name no setting, or a number alone, give nothing", () => {
  assert.deepEqual(actions("holiday"), []);
  assert.deepEqual(actions("48"), []);
});

const IT: Record<string, string> = { Taskleiste: "Barra delle applicazioni", Höhe: "Altezza" };

test("a setting is found by the start of its name's words; the bar's own name alone finds none", () => {
  for (const q of ["bar", "task", "ask", "taskbar"]) assert.deepEqual(actions(q), [], q);
  const it: NamesContext = { ...ctx, tr: (key, values) => tr(IT[key] ?? key, values) };
  for (const q of ["barra", "app", "applicazioni"]) assert.deepEqual(settingHits(q, it), [], q);
  assert.deepEqual(settingHits("altezza barra 48", it)[0]?.action, { do: "set", id: "height", to: 48 });
  assert.equal(settingHits("altezza barra 48", it)[0]?.weak, undefined);
});

test("part of a name is a weak guess, which never takes Enter; the whole name is not", () => {
  const rows = (q: string) => settingHits(q, ctx).map((h) => [h.action.do, h.weak === true]);
  assert.deepEqual(rows("desktop"), [["toggle", true]]);
  assert.deepEqual(rows("aus"), [["toggle", true]]);
  assert.deepEqual(rows("desktop icons"), [["toggle", false]]);
  assert.deepEqual(rows("höhe 48"), [["set", false]]);
});
