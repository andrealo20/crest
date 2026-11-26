// The settings the bar's search changes by name: the bar's size, look and switches, the volume, the brightness, Do Not Disturb,
// the desktop icons and the theme, each with a number, a step or an option. A colour by name opens Themes, since the accent lives
// in the theme. Names are the Settings pages' own t() keys, read in the interface's language and in English. Pure.

import { fold } from "../../settings/search.ts";
import { HEIGHT, ICON, TRANSPARENCY, WIDGET_SIZE } from "../model.ts";
import type { Hit, SettingId, Tr } from "./model.ts";

export type SettingSpec = { id: SettingId; names: readonly string[]; section: string | null } & (
  | { kind: "number"; min: number; max: number; step: number; unit: "px" | "%" }
  | { kind: "toggle" }
  | { kind: "choice"; options: readonly { value: string; label: string }[] }
);
type NumberSpec = SettingSpec & { kind: "number" };

/** How the names are read: t() and English (english(t(key)) in the panel), and the themes a theme's name picks from. */
export interface NamesContext {
  tr: Tr;
  en: (key: string) => string;
  themes: readonly { id: string; name: string }[];
}

const BAR = "Taskleiste";
/** `section`: SettingsView's page that shows it, null for what lives in Windows (no page to open). */
export const SETTINGS: readonly SettingSpec[] = [
  { id: "height", names: ["Höhe", BAR], section: "taskbar-look", kind: "number", min: HEIGHT[0], max: HEIGHT[1], step: 2, unit: "px" },
  { id: "iconSize", names: ["Symbolgröße", BAR], section: "taskbar-look", kind: "number", min: ICON[0], max: ICON[1], step: 2, unit: "px" },
  { id: "widgetSize", names: ["Widgetgröße", BAR], section: "taskbar-look", kind: "number", min: WIDGET_SIZE[0], max: WIDGET_SIZE[1], step: 5, unit: "%" },
  { id: "transparency", names: ["Transparenz", BAR], section: "taskbar-look", kind: "number", min: TRANSPARENCY[0], max: TRANSPARENCY[1], step: 5, unit: "%" },
  {
    id: "glass",
    names: ["Glas", BAR],
    section: "taskbar-look",
    kind: "choice",
    options: [
      { value: "off", label: "Aus" },
      { value: "crest", label: "Glas" },
      { value: "plus", label: "Liquid Glass +" },
    ],
  },
  { id: "autoHide", names: ["Automatisch ausblenden", BAR], section: "taskbar", kind: "toggle" },
  { id: "batteryPercent", names: ["Akkustand in Prozent", BAR], section: "taskbar", kind: "toggle" },
  { id: "clockSeconds", names: ["Sekunden", BAR], section: "taskbar-widgets", kind: "toggle" },
  { id: "volume", names: ["Lautstärke"], section: null, kind: "number", min: 0, max: 100, step: 5, unit: "%" },
  { id: "brightness", names: ["Helligkeit"], section: null, kind: "number", min: 0, max: 100, step: 5, unit: "%" },
  { id: "dnd", names: ["Nicht stören"], section: null, kind: "toggle" },
  { id: "desktopIcons", names: ["Desktopsymbole"], section: null, kind: "toggle" },
  // The options are the themes there are now (NamesContext.themes).
  { id: "theme", names: ["Themen"], section: "themes", kind: "choice", options: [] },
];

/** Colours by name, as t() keys: typed, they open Themes. */
export const COLOUR_KEYS: readonly string[] = ["Rosa", "Rot", "Orange", "Gelb", "Grün", "Türkis", "Blau", "Lila", "Schwarz", "Weiß", "Grau"];

/** A typed value inside the setting's limits, in whole units. */
export const clampSetting = (spec: NumberSpec, value: number): number => Math.round(Math.min(spec.max, Math.max(spec.min, value)));

/** One step up or down from `current`, held to the limits. */
export const nudged = (spec: NumberSpec, current: number, by: 1 | -1): number => clampSetting(spec, current + by * spec.step);

const NUMBER = /^-?\d+(?:[.,]\d+)?(?:%|px)?$/;
// Latin words of one or two letters ("a", "to", "di") are glue; CJK names can be two characters long and stay.
const GLUE = /^[a-z]{1,2}$/;

/** The words of the text that may name a setting, and the number in it, if any. */
function parse(query: string): { words: string[]; value: number | null } {
  let value: number | null = null;
  const words: string[] = [];
  for (const token of fold(query).split(/\s+/).filter(Boolean)) {
    if (NUMBER.test(token)) value = Number(token.replace(/%|px/, "").replace(",", "."));
    else if (!GLUE.test(token)) words.push(token);
  }
  return { words, value };
}

const both = (key: string, ctx: NamesContext) => fold(`${ctx.tr(key)} ${ctx.en(key)}`);

/** Whether a word of the text is a colour's name, in the interface's language or English, or the text is a #rrggbb code. */
export function isColourQuery(query: string, ctx: NamesContext): boolean {
  if (/^#[0-9a-f]{6}$/i.test(query.trim())) return true;
  const names = new Set(COLOUR_KEYS.flatMap((k) => both(k, ctx).split(" ")));
  return fold(query)
    .split(/\s+/)
    .some((w) => w.length > 2 && names.has(w));
}

/** The setting rows for the text: set to its number, a step up and down and its page, a switch flipped, or an option picked. */
export function settingHits(query: string, ctx: NamesContext): Hit[] {
  const { tr } = ctx;
  if (isColourQuery(query, ctx)) {
    return [{ key: "setting:colour", kind: "setting", title: tr("Themen öffnen"), icon: { glyph: "setting" }, action: { do: "settings", section: "themes" } }];
  }
  const { words, value } = parse(query);
  if (!words.length) return [];
  const hits: Hit[] = [];
  for (const spec of SETTINGS) {
    const names = spec.names.map((n) => both(n, ctx)).join(" ");
    const rest = words.filter((w) => !names.includes(w));
    const name = tr(spec.names[0]);
    const row = (suffix: string, title: string, action: Hit["action"]): Hit => ({ key: `setting:${spec.id}:${suffix}`, kind: "setting", title, icon: { glyph: "setting" }, action });
    if (spec.kind === "choice") {
      // A word of the name, then any words left pick the option.
      if (rest.length === words.length) continue;
      if (spec.id === "theme") {
        if (!rest.length) hits.push(row("page", tr("{name} in den Einstellungen öffnen", { name }), { do: "settings", section: spec.section }));
        else for (const theme of ctx.themes) if (rest.every((w) => fold(theme.name).includes(w))) hits.push(row(theme.id, `${name}: ${theme.name}`, { do: "set", id: "theme", to: theme.id }));
        continue;
      }
      for (const option of spec.options) {
        if (rest.every((w) => both(option.label, ctx).includes(w))) hits.push(row(option.value, `${name}: ${tr(option.label)}`, { do: "set", id: spec.id, to: option.value }));
      }
      continue;
    }
    if (rest.length) continue;
    if (spec.kind === "toggle") {
      hits.push(row("toggle", tr("{name} umschalten", { name }), { do: "toggle", id: spec.id }));
      continue;
    }
    if (value !== null) {
      const to = clampSetting(spec, value);
      hits.push(row("set", tr("{name} auf {value} setzen", { name, value: `${to} ${spec.unit}` }), { do: "set", id: spec.id, to }));
      continue;
    }
    hits.push(row("up", tr("{name} erhöhen", { name }), { do: "nudge", id: spec.id, by: 1 }));
    hits.push(row("down", tr("{name} verringern", { name }), { do: "nudge", id: spec.id, by: -1 }));
    if (spec.section) hits.push(row("page", tr("{name} in den Einstellungen öffnen", { name }), { do: "settings", section: spec.section }));
  }
  return hits;
}
