import { useMemo } from "react";
import { flushSync } from "react-dom";
import { createStore } from "../../lib/store";
import { isNotchWindow } from "../../lib/windowKind";
import { systemAccent, themeFiles, type SystemAccent } from "../../platform/services";
import { settingsWindow } from "../../platform/native";
import { settings, updateSettings } from "../../settings/store";
import { design, type Design } from "../../design/design";
import { setMotionDesign } from "../../design/motion";
import { wantsViewTransition } from "../../design/viewTransition";
import { activeThemeId, chooseTheme, nextChange } from "./daynight";
import { record, startHistory, undo, type History } from "./history";
import { materialInk, resolveMaterial } from "./material";
import { setRowFamily, setTabularFromDom } from "../../notch/row/measure";
import {
  BUILT_IN_THEMES,
  THEME_DEFAULTS,
  captionSpacing,
  closedGlassInk,
  findTheme,
  fontStack,
  importThemes,
  isBuiltIn,
  readableAccent,
  resolveTheme,
  setThemeColor,
  systemTheme,
  takenIds,
  themeToText,
  uniqueId,
  type ImportResult,
  type ResolvedTheme,
  type ThemeFile,
  type ThemeKey,
} from "./themes";
import type { Rgba } from "./color";
import "./themes.css";

/**
 * The editor's unsaved changes, drawn live on every Crest window; kept until saved or discarded, lost on exit. Saved, so
 * the notch shows them while the settings window edits, and they outlive that window; the notch drops them when it starts.
 */
export const draft = createStore<History<ThemeFile> | null>(null, { persist: "theme-draft" });

/** The theme card under the pointer in the settings window, drawn there alone while it rests (not saved, so no other window sees it). */
export const previewTheme = createStore<ThemeFile | null>(null);

/** The theme a card under the pointer previews: none in the Crest style, outside the settings window or without focus, while editing, with forced colours, or for the theme in use. */
export function previewFor(
  hovered: ThemeFile | null,
  c: { current: string; material: boolean; settingsWindow: boolean; focused: boolean; editing: boolean; forced: boolean },
): ThemeFile | null {
  return hovered && c.material && c.settingsWindow && c.focused && !c.editing && !c.forced && hovered.id !== c.current ? hovered : null;
}

const DARK = resolveTheme(BUILT_IN_THEMES[0]);
/**
 * The black closed notch's ink, which keeps light text whatever the theme: Dark's tokens in the Crest style, in Material the dark
 * scheme of the theme's seed (materialInk).
 */
export const inkTheme = createStore<ResolvedTheme>(DARK);
/** The closed notch's ink tokens, for light text over a dark picture whatever the theme (the Music tool's cover backdrop). */
export const darkInk = (): Record<string, string> => inkTheme.get().vars;
/** The theme on screen now (the draft while editing). */
export const activeTheme = createStore<ResolvedTheme>(DARK);

/** The system's last accent and side, saved, so a window that starts draws the System card before Rust answers. */
const lastAccent = createStore<SystemAccent | null>(null, { persist: "system-accent" });
/** The System card's theme; null while the system gives no reading, and then the card is not there. */
export const systemFile = createStore<ThemeFile | null>(systemTheme(lastAccent.get()));

/** The saved theme due now (day/night included, by the sun at the Weather place when the schedule follows it). */
export function savedTheme(now = new Date()): ThemeFile {
  const { themes, weather } = settings.get();
  return findTheme(activeThemeId(themes, now, weather), themes.custom, systemFile.get());
}

/** The system asks for more contrast (Increase contrast on macOS): Material takes its scheme at contrast 1. */
const moreContrast = typeof matchMedia === "function" ? matchMedia("(prefers-contrast: more)") : null;
/** The system's side changes: read the accent again, for where its change event does not carry the side. */
const darkScheme = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
/** In development `?design=material` or `crest` sets the style of this page alone, unsaved, for screenshots. */
const pageDesign = import.meta.env.DEV ? new URLSearchParams(location.search).get("design") : null;

let lastKey = "";
let lastNotch = "";
/** The crossfade of the latest change of style. */
let switching: ViewTransition | null = null;
function apply() {
  const style: Design = pageDesign === "material" || pageDesign === "crest" ? pageDesign : settings.get().themes.design;
  // The style first: a preview left over when another window switches to Crest must not show there.
  const file = (style === "material" ? previewTheme.get() : null) ?? draft.get()?.present ?? savedTheme();
  const more = moreContrast?.matches ?? false;
  const key = JSON.stringify([style, more, file]);
  if (key === lastKey) return;
  lastKey = key;
  const contrast = more ? 1 : 0;
  const resolved = style === "material" ? resolveMaterial(file, { contrast }) : resolveTheme(file);
  const root = document.documentElement;
  const write = () => {
    // A crossfade's callback waits for a frame; a newer apply() in between has already drawn what is due.
    if (key !== lastKey) return;
    for (const [name, value] of Object.entries(resolved.vars)) root.style.setProperty(name, value);
    root.dataset.theme = resolved.dark ? "dark" : "light";
    root.dataset.design = style;
    setMotionDesign(style);
    design.set(style);
    // Here, not after apply(): a crossfade draws this later, and the font must follow the Style it draws.
    applyFont();
    // Before activeTheme, whose listeners (the glass) read the ink.
    inkTheme.set(style === "material" ? materialInk(file, { contrast }) : DARK);
    activeTheme.set(resolved);
  };
  if (wantsViewTransition(root.dataset.design as Design | undefined, style, typeof document.startViewTransition === "function")) {
    // Without the colours' own 500 ms blend under the crossfade, and with React's new tree drawn inside the callback, not after the snapshot.
    root.dataset.designSwitching = "";
    const transition = (switching = document.startViewTransition(() => flushSync(write)));
    // An older crossfade can end while a newer one still runs, and the blend stays off until the last one ends.
    transition.finished.finally(() => switching === transition && delete root.dataset.designSwitching);
  } else write();
  const notch = resolved.vars["--color-notch"];
  // The notch is always open, so it alone keeps Rust's colour for the next settings window current.
  if (isNotchWindow && notch !== lastNotch) {
    lastNotch = notch;
    void settingsWindow.background(notch);
  }
}

let timer = 0;
let lastSchedule = "";
/** One timeout to the next day/night change, no polling. */
function scheduleNext() {
  const { themes, weather } = settings.get();
  const s = themes.schedule;
  // The place counts only while the schedule follows the sun: its sunrise and sunset are the times then.
  const place = s.sun ? weather : null;
  const key = JSON.stringify([s, place?.lat, place?.lon]);
  if (key === lastSchedule) return;
  lastSchedule = key;
  window.clearTimeout(timer);
  if (!s.on) return;
  const wait = nextChange(s, new Date(), place).getTime() - Date.now();
  timer = window.setTimeout(refreshTheme, wait + 500);
}

/**
 * Checks the theme due now and sets the next timeout again. Runs on the timeout and whenever the
 * notch opens, which covers a PC that slept through the change and a daylight saving shift.
 */
export function refreshTheme() {
  lastSchedule = "";
  apply();
  scheduleNext();
}

let lastFont = "";
/** Runs once write() has set the Style it reads, and on every change of the settings for the font itself. */
function applyFont() {
  const style = design.get();
  const family = fontStack(settings.get().themes.font, style);
  // The style as well: a font picked by name keeps its stack in both, while the caption's tracking and the tabular widths change.
  const key = `${style}\n${family}`;
  if (key === lastFont) return;
  lastFont = key;
  document.documentElement.style.setProperty("--font-sans", family);
  setTabularFromDom(style === "material");
  setRowFamily(family, captionSpacing(style));
}

export function startThemes() {
  // Unsaved changes last while Crest runs (see `draft`).
  if (isNotchWindow) {
    draft.set(null);
    draftName.set("");
  }
  apply();
  applyFont();
  scheduleNext();
  settings.subscribe(() => {
    apply();
    applyFont();
    scheduleNext();
  });
  draft.subscribe(apply);
  previewTheme.subscribe(apply);
  moreContrast?.addEventListener("change", apply);
  // The saved reading, this window's own or another's: the timer and the bar cannot read the system, so they follow the notch's.
  lastAccent.subscribe(() => {
    systemFile.set(systemTheme(lastAccent.get()));
    apply();
  });
  const take = (a: SystemAccent | null) => lastAccent.set(a);
  // A failed read keeps the last one.
  const read = () => void systemAccent.get().then(take, () => {});
  read();
  systemAccent.listen(take);
  darkScheme?.addEventListener("change", read);
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
 * Tokens for the closed row: the closed notch's ink (inkTheme), so the black notch keeps light text whatever the
 * theme, with the raw cover colour (tuned for black). Nothing when the theme colours the closed notch too.
 */
export function useClosedInk(raw: string | undefined): Record<string, string> | undefined {
  const theme = activeTheme.use();
  const ink = inkTheme.use();
  return useMemo(() => (theme.closedNotch ? undefined : { ...ink.vars, "--accent": raw ?? ink.vars["--theme-accent"] }), [raw, theme.closedNotch, ink]);
}

/** The closed row's ink over its glass (themes.ts closedGlassInk), while that glass shows; undefined otherwise. */
export function useClosedGlassInk(accent: string, on: boolean): Record<string, string> | undefined {
  const theme = activeTheme.use();
  const ink = inkTheme.use();
  const hues = settings.use().themes.iconColors;
  return useMemo(() => (on ? closedGlassInk(theme.closedNotch ? theme : ink, accent, hues) : undefined), [on, theme, ink, accent, hues]);
}

// ---------- Choosing ----------

export const allThemes = (): ThemeFile[] => [...BUILT_IN_THEMES, ...settings.get().themes.custom];

export function pickTheme(id: string) {
  updateSettings((s) => ({ themes: chooseTheme(s.themes, id, new Date(), s.weather) }));
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

/** The name field under the editor; saved with the draft, so it survives the settings window being closed. */
export const draftName = createStore("", { persist: "theme-draft-name" });

export function startEditing(name: string) {
  draftName.set(name);
  draft.set(startHistory(savedTheme()));
}

const edit = (key: string, change: (t: ThemeFile) => ThemeFile) => {
  const h = draft.get();
  if (h) draft.set(record(h, change(h.present), Date.now(), key));
};

export const editColor = (key: ThemeKey, value: Rgba) => edit(key, (t) => setThemeColor(t, key, value));
export const editClosedNotch = (on: boolean) => edit("closedNotch", (t) => ({ ...t, closedNotch: on ? "background" : undefined }));

export function undoEdit() {
  const h = draft.get();
  if (h) draft.set(undo(h));
}

export const discardEdits = () => draft.set(null);

/** Saves the draft as a new custom theme and switches to it. */
export function saveAsNew(name: string) {
  const h = draft.get();
  if (!h) return;
  const id = uniqueId(name, takenIds(settings.get().themes.custom));
  const { colors, closedNotch } = h.present;
  const theme: ThemeFile = { format: 1, id, name: name.trim().slice(0, 60) || id, colors, ...(closedNotch ? { closedNotch } : {}) };
  updateSettings((s) => ({ themes: chooseTheme({ ...s.themes, custom: [...s.themes.custom, theme] }, id, new Date(), s.weather) }));
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

/**
 * Writes the theme on screen into the themes folder: the draft while editing, else the saved theme
 * due now. A changed built-in leaves under the editor's name, so its file never carries a built-in
 * id. Returns the file's path ("" in the browser).
 */
export function exportTheme(): Promise<string> {
  const h = draft.get();
  let theme = h?.present ?? savedTheme();
  if (h && h.past.length > 0 && isBuiltIn(theme.id)) {
    const name = draftName.get().trim().slice(0, 60) || theme.name;
    theme = { format: 1, id: uniqueId(name, takenIds([])), name, colors: theme.colors, ...(theme.closedNotch ? { closedNotch: theme.closedNotch } : {}) };
  }
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
