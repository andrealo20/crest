// Apps, Crest's tools and the bar's widgets by name, for the bar's search. The panel hands in the lists (the Launcher's apps, the
// tools that are on, the widgets with their names from partInfo), so this stays pure. Pure.

import type { LauncherApp } from "../../launcher/apps.ts";
import { searchApps } from "../../launcher/apps.ts";
import type { PartId } from "../../../notch/row/parts.ts";
import { fold } from "../../settings/search.ts";
import type { BarItem, Zone } from "../model.ts";
import type { Hit, Tr } from "./model.ts";

/** The tools whose button on the bar is their widget, so toolInfo has no entry for them: their names as src/notch/tabs.ts has them. */
export const WIDGET_TOOLS: Record<string, string> = {
  timer: "Timer",
  weather: "Wetter",
  discord: "Discord",
  github: "GitHub",
  leetcode: "LeetCode",
  calendar: "Kalender",
  screentime: "Bildschirmzeit",
};

/** A tool's name (a t() key): toolInfo's (handed in, it loads icons), else WIDGET_TOOLS'; undefined for a plugin's, which has its own. */
export const toolLabel = (id: string, info: Record<string, { label: string }>): string | undefined => info[id]?.label ?? WIDGET_TOOLS[id];

/** A tool or a widget: its id and its name, a t() key. */
export interface Named<Id extends string = string> {
  id: Id;
  label: string;
}

interface Names {
  tr: Tr;
  en: (key: string) => string;
}

/** The apps for the text, best first (searchApps, initials too); "Wechseln zu" on one already open, where Enter brings it forward. */
export function appHits(apps: LauncherApp[], query: string, running: (id: string) => boolean, tr: Tr): Hit[] {
  if (!query.trim()) return [];
  return searchApps(apps, query, 5).map((a) => ({
    key: `app:${a.id}`,
    kind: "app",
    title: a.name,
    subtitle: tr(running(a.id) ? "Wechseln zu" : "Öffnen"),
    icon: { app: a.id },
    action: { do: "app", id: a.id },
  }));
}

/** The entries whose name, in the interface's language or English, holds every word; names starting with the first word first. */
function byName<T extends Named>(query: string, list: readonly T[], { tr, en }: Names): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const named = list
    .map((item) => ({ item, name: fold(`${tr(item.label)} ${en(item.label)}`) }))
    .filter(({ name }) => words.every((w) => name.includes(w)));
  // Array.prototype.sort is stable: equal ranks keep the list's order.
  return named.sort((a, b) => Number(!a.name.startsWith(words[0])) - Number(!b.name.startsWith(words[0]))).map(({ item }) => item);
}

/** The tools handed in (the ones that are on) by name; Enter opens one where openPanel sends it. */
export const toolHits = (query: string, tools: readonly Named[], names: Names): Hit[] =>
  byName(query, tools, names).map((tool) => ({
    key: `tool:${tool.id}`,
    kind: "tool",
    title: names.tr(tool.label),
    subtitle: names.tr("Öffnen"),
    icon: { tool: tool.id },
    action: { do: "tool", tool: tool.id },
  }));

/** The widgets by name: onto the bar, or off it when one is there already. */
export function widgetHits(query: string, widgets: readonly Named<PartId>[], zones: Record<Zone, BarItem[]>, names: Names): Hit[] {
  const on = new Set<string>(Object.values(zones).flat());
  return byName(query, widgets, names).map((w) => {
    const add = !on.has(w.id);
    return {
      key: `widget:${w.id}`,
      kind: "widget",
      title: names.tr(w.label),
      subtitle: names.tr(add ? "Zur Leiste hinzufügen" : "Von der Leiste entfernen"),
      icon: { part: w.id },
      action: { do: "widget", id: w.id, add },
    };
  });
}
