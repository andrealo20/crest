// The bar's search: the rows each source returns and the order they show in. Pure, so it runs under the tests; the panel
// (window/SearchPanel.tsx) shows the rows and run.ts carries out their actions.

import type { PartId } from "../../../notch/row/parts.ts";
import { searchEngineName, searchTarget, type SearchEngine } from "../../overview/search.ts";

/** t() handed in: the i18n module loads its dictionaries through Vite, which the tests do not have. */
export type Tr = (key: string, values?: Record<string, string | number>) => string;

/** What the search changes by name (settingsTable.ts). */
export type SettingId =
  | "height"
  | "iconSize"
  | "widgetSize"
  | "transparency"
  | "glass"
  | "autoHide"
  | "clockSeconds"
  | "batteryPercent"
  | "volume"
  | "brightness"
  | "dnd"
  | "desktopIcons"
  | "theme";
export type SettingValue = number | boolean | string;

/** What a row does, as data: run.ts carries it out, and Capisci's answer from Ask comes back in the same form. */
export type SearchAction =
  | { do: "copy"; text: string }
  | { do: "app"; id: string }
  | { do: "tool"; tool: string }
  | { do: "set"; id: SettingId; to: SettingValue }
  | { do: "nudge"; id: SettingId; by: 1 | -1 }
  | { do: "toggle"; id: SettingId }
  | { do: "settings"; section: string | null; query?: string }
  | { do: "widget"; id: PartId; add: boolean }
  | { do: "file"; path: string }
  | { do: "reveal"; path: string }
  | { do: "understand"; text: string }
  | { do: "web"; query: string }
  | { do: "path"; path: string };

export type HitKind = "answer" | "app" | "tool" | "setting" | "widget" | "file" | "understand" | "settings" | "web";
export type HitIcon =
  | { app: string }
  | { tool: string }
  | { part: PartId }
  | { file: string; folder: boolean }
  | { glyph: "calc" | "clock" | "setting" | "sparkle" | "web" | "gear" | "path" };

/** One row: `action` on Enter or a click, `alt` on Ctrl+Enter. */
export interface Hit {
  key: string;
  kind: HitKind;
  title: string;
  subtitle?: string;
  icon: HitIcon;
  action: SearchAction;
  alt?: SearchAction;
  /** A guess from part of a name, or a row with no value given: shown, never the row Enter runs before an arrow or the pointer picks it. */
  weak?: boolean;
}

/** The groups top to bottom, and the most rows each shows. */
const ORDER: HitKind[] = ["answer", "app", "tool", "setting", "widget", "file", "understand", "settings", "web"];
export const GROUP_LIMIT: Record<HitKind, number> = { answer: 1, app: 5, tool: 3, setting: 4, widget: 3, file: 6, understand: 1, settings: 1, web: 1 };

/** The rows in group order, each group cut to its limit, in the order its source gave them. */
export const arrange = (hits: Hit[]): Hit[] => ORDER.flatMap((kind) => hits.filter((h) => h.kind === kind).slice(0, GROUP_LIMIT[kind]));

/**
 * The row Enter runs as the list appears: the first, never Capisci, which spends the user's tokens only when chosen, nor the
 * Settings' search, nor a weak guess, so with nothing sure Enter still opens the path or searches the web as the box always did. -1 for none.
 */
export const firstSelected = (hits: Hit[]): number => hits.findIndex((h) => h.kind !== "understand" && h.kind !== "settings" && !h.weak);

/** The selected row once the list changed (files arrive late): the same row while it is there, so Enter runs what was picked. */
export function keepSelected(key: string | null, hits: Hit[]): number {
  const at = key === null ? -1 : hits.findIndex((h) => h.key === key);
  return at >= 0 ? at : firstSelected(hits);
}

/** Capisci: the sentence goes to Ask only when this row is chosen. */
export const understandHit = (text: string, tr: Tr): Hit => ({
  key: "understand",
  kind: "understand",
  title: tr("„{text}“ verstehen", { text }),
  subtitle: tr("Mit Ask, in deinen Worten"),
  icon: { glyph: "sparkle" },
  action: { do: "understand", text },
});

/** The Settings window opened on its own search with the text, for the settings the search does not change itself. */
export const settingsSearchHit = (query: string, tr: Tr): Hit => ({
  key: "settings",
  kind: "settings",
  title: tr("„{text}“ in den Einstellungen suchen", { text: query }),
  icon: { glyph: "gear" },
  action: { do: "settings", section: null, query },
});

/** What the box did before the search: a typed path opens with its app, anything else searches the web. Null for nothing typed. */
export function webOrPathHit(query: string, engine: SearchEngine, tr: Tr): Hit | null {
  const target = searchTarget(query);
  if (!target) return null;
  if (target.kind === "path") {
    return { key: `path:${target.path}`, kind: "web", title: target.path, subtitle: tr("Enter öffnet den Pfad"), icon: { glyph: "path" }, action: { do: "path", path: target.path } };
  }
  return {
    key: "web",
    kind: "web",
    title: tr("„{text}“ im Web suchen", { text: target.query }),
    subtitle: tr("Enter sucht mit {engine}", { engine: searchEngineName(engine) }),
    icon: { glyph: "web" },
    action: { do: "web", query: target.query },
  };
}
