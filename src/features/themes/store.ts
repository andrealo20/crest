import { useMemo } from "react";
import { createStore } from "../../lib/store";
import { themeFiles } from "../../platform/services";
import { settings, updateSettings } from "../../settings/store";
import { activeThemeId, chooseTheme, nextChange } from "./daynight";
import { record, startHistory, undo, type History } from "./history";
import {
  BUILT_IN_THEMES,
  THEME_DEFAULTS,
  findTheme,
  importThemes,
  isBuiltIn,
  readableAccent,
  resolveTheme,
  setThemeColor,
  themeToText,
  uniqueId,
  type ImportResult,
  type ResolvedTheme,
  type ThemeFile,
  type ThemeKey,
} from "./themes";
import type { Rgba } from "./color";
import "./themes.css";

/** The editor's unsaved changes, drawn live on the whole panel; kept until saved or discarded, lost on exit. */
export const draft = createStore<History<ThemeFile> | null>(null);

const DARK = resolveTheme(BUILT_IN_THEMES[0]);
/** The theme on screen now (the draft while editing). */
export const activeTheme = createStore<ResolvedTheme>(DARK);

/** The saved theme due now (day/night included). */
export function savedTheme(now = new Date()): ThemeFile {
  const themes = settings.get().themes;
  return findTheme(activeThemeId(themes, now), themes.custom);
}

let lastKey = "";
function apply() {
  const file = draft.get()?.present ?? savedTheme();
  const key = JSON.stringify(file);
  if (key === lastKey) return;
  lastKey = key;
  const resolved = resolveTheme(file);
  const root = document.documentElement.style;
  for (const [name, value] of Object.entries(resolved.vars)) root.setProperty(name, value);
  document.documentElement.dataset.theme = resolved.dark ? "dark" : "light";
  activeTheme.set(resolved);
}

let timer = 0;
let lastSchedule = "";
/** One timeout to the next day/night change, no polling. */
function scheduleNext() {
  const s = settings.get().themes.schedule;
  const key = JSON.stringify(s);
  if (key === lastSchedule) return;
  lastSchedule = key;
  window.clearTimeout(timer);
  if (!s.on) return;
  const wait = nextChange(s, new Date()).getTime() - Date.now();
  // shortcut: capped at 10 min so a PC that slept through the change catches up soon after waking; an OS time-change event would be exact.
  timer = window.setTimeout(
    () => {
      lastSchedule = "";
      apply();
      scheduleNext();
    },
    Math.min(wait + 500, 10 * 60_000),
  );
}

export function startThemes() {
  apply();
  scheduleNext();
  settings.subscribe(() => {
    apply();
    scheduleNext();
  });
  draft.subscribe(apply);
}

/** Windows high contrast is on (forced colours): the system's colours replace every theme. */
const forcedQuery = typeof matchMedia === "function" ? matchMedia("(forced-colors: active)") : null;
export const forcedColors = createStore(forcedQuery?.matches ?? false);
forcedQuery?.addEventListener("change", (e) => forcedColors.set(e.matches));

/** The cover colour for the open panel: held to 3:1 on the theme's background; the theme accent when nothing plays. */
export function useThemedAccent(raw: string | undefined): string {
  const theme = activeTheme.use();
  return useMemo(() => (raw ? readableAccent(raw, theme) : theme.vars["--theme-accent"]), [raw, theme]);
}

/**
 * Tokens for the closed row: the Dark theme's, so the black notch keeps light text whatever the
 * theme, with the raw cover colour (tuned for black). Nothing when the theme colours the closed notch too.
 */
export function useClosedInk(raw: string | undefined): Record<string, string> | undefined {
  const theme = activeTheme.use();
  return useMemo(() => (theme.closedNotch ? undefined : { ...DARK.vars, "--accent": raw ?? DARK.vars["--theme-accent"] }), [raw, theme.closedNotch]);
}

// ---------- Choosing ----------

export const allThemes = (): ThemeFile[] => [...BUILT_IN_THEMES, ...settings.get().themes.custom];

export function pickTheme(id: string) {
  updateSettings((s) => ({ themes: chooseTheme(s.themes, id, new Date()) }));
}

export function deleteCustomTheme(id: string) {
  updateSettings((s) => {
    const t = s.themes;
    const gone = (v: string, fallback: string) => (v === id ? fallback : v);
    return {
      themes: {
        ...t,
        custom: t.custom.filter((c) => c.id !== id),
        id: gone(t.id, THEME_DEFAULTS.id),
        schedule: { ...t.schedule, day: gone(t.schedule.day, THEME_DEFAULTS.schedule.day), night: gone(t.schedule.night, THEME_DEFAULTS.schedule.night) },
      },
    };
  });
}

// ---------- Editing ----------

export function startEditing() {
  draft.set(startHistory(savedTheme()));
}

const edit = (change: (t: ThemeFile) => ThemeFile) => {
  const h = draft.get();
  if (h) draft.set(record(h, change(h.present), performance.now()));
};

export const editColor = (key: ThemeKey, value: Rgba) => edit((t) => setThemeColor(t, key, value));
export const editClosedNotch = (on: boolean) => edit((t) => ({ ...t, closedNotch: on ? "background" : undefined }));

export function undoEdit() {
  const h = draft.get();
  if (h) draft.set(undo(h));
}

export const discardEdits = () => draft.set(null);

/** Saves the draft as a new custom theme and switches to it. */
export function saveAsNew(name: string) {
  const h = draft.get();
  if (!h) return;
  const taken = new Set(allThemes().map((t) => t.id));
  const id = uniqueId(name, taken);
  const { colors, closedNotch } = h.present;
  const theme: ThemeFile = { format: 1, id, name: name.trim().slice(0, 60) || id, colors, ...(closedNotch ? { closedNotch } : {}) };
  updateSettings((s) => ({ themes: chooseTheme({ ...s.themes, custom: [...s.themes.custom, theme] }, id, new Date()) }));
  draft.set(null);
}

/** Writes the draft over the custom theme it started from. */
export function overwriteTheme() {
  const h = draft.get();
  if (!h || isBuiltIn(h.present.id)) return;
  const theme = h.present;
  updateSettings((s) => ({ themes: { ...s.themes, custom: s.themes.custom.map((c) => (c.id === theme.id ? theme : c)) } }));
  draft.set(null);
}

// ---------- Files ----------

/** Writes the saved theme due now into the themes folder; returns the file's path ("" in the browser). */
export function exportTheme(): Promise<string> {
  const theme = savedTheme();
  return themeFiles.write(theme.id, themeToText(theme));
}

/** Reads the themes folder and copies every valid file into the custom themes. */
export async function importFromFolder(): Promise<ImportResult> {
  const files = await themeFiles.read();
  const result = importThemes(settings.get().themes.custom, files);
  updateSettings((s) => ({ themes: { ...s.themes, custom: result.custom } }));
  return result;
}

export const themesFolder = () => themeFiles.folder();
