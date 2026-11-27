// Carries out what a row of the bar's search does (model.ts SearchAction): opens, copies, or changes a setting and says how to
// put it back. Capisci's answer from Ask comes through here too, so it meets the same limits.

import { t, tBackend } from "../../../i18n";
import { settingsWindow } from "../../../platform/native";
import { launcher, openFile, revealFile, systemControls, taskbar, webSearchBrowser } from "../../../platform/services";
import { settings } from "../../../settings/store";
import type { SearchEngine } from "../../overview/search";
import { activeThemeId } from "../../themes/daynight";
import { allThemes, pickTheme } from "../../themes/store";
import { openPanel, panel } from "../panel";
import { setTaskbar } from "../store";
import { addWidget, removeWidget } from "../widgets";
import type { SearchAction, SettingId, SettingValue } from "./model";
import { SETTINGS, clampSetting, nudged, type SettingSpec } from "./settingsTable";

export interface RunOutcome {
  /** What changed, for the line under the field. */
  done?: string;
  /** What puts it back, for "Annulla". */
  undo?: SearchAction;
  error?: string;
  /** Something opened elsewhere: the panel closes. */
  close?: boolean;
}

/** The setting's value now. The brightness is null where Crest cannot set it (brightness.rs). */
async function read(id: SettingId): Promise<SettingValue | null> {
  const s = settings.get();
  switch (id) {
    case "height":
      return s.taskbar.height;
    case "iconSize":
      return s.taskbar.iconSize;
    case "widgetSize":
      return s.taskbar.widgetSize;
    case "transparency":
      return s.taskbar.transparency;
    case "glass":
      return s.taskbar.glass ? s.taskbar.glassLook : "off";
    case "autoHide":
      return s.taskbar.autoHide;
    case "batteryPercent":
      return s.taskbar.batteryPercent;
    case "clockSeconds":
      return s.taskbar.clock.seconds;
    case "volume":
      return Math.round((await systemControls.volume()).level * 100);
    case "brightness":
      return systemControls.brightness();
    case "dnd":
      return (await systemControls.focus()).active;
    case "desktopIcons":
      return taskbar.desktopIcons();
    case "theme":
      return activeThemeId(s.themes, new Date(), s.weather);
  }
}

async function write(id: SettingId, to: SettingValue): Promise<void> {
  switch (id) {
    case "height":
      return setTaskbar({ height: Number(to) });
    case "iconSize":
      return setTaskbar({ iconSize: Number(to) });
    case "widgetSize":
      return setTaskbar({ widgetSize: Number(to) });
    case "transparency":
      return setTaskbar({ transparency: Number(to) });
    case "glass":
      return setTaskbar(to === "crest" || to === "plus" ? { glass: true, glassLook: to } : { glass: false });
    case "autoHide":
      return setTaskbar({ autoHide: Boolean(to) });
    case "batteryPercent":
      return setTaskbar({ batteryPercent: Boolean(to) });
    case "clockSeconds":
      return setTaskbar((cur) => ({ clock: { ...cur.clock, seconds: Boolean(to) } }));
    case "volume":
      return void (await systemControls.setVolume({ level: Number(to) / 100 }));
    case "brightness":
      return systemControls.setBrightness(Number(to));
    case "dnd":
      return void (await systemControls.setFocus(Boolean(to)));
    case "desktopIcons":
      return taskbar.desktopIconsSet(Boolean(to));
    case "theme":
      return pickTheme(String(to));
  }
}

/** A value as the line under the field says it. */
function shown(spec: SettingSpec, value: SettingValue): string {
  if (spec.kind === "number") return `${value} ${spec.unit}`;
  if (spec.kind === "toggle") return t(value ? "An" : "Aus");
  if (spec.id === "theme") return allThemes().find((th) => th.id === value)?.name ?? String(value);
  const option = spec.options.find((o) => o.value === value);
  return option ? t(option.label) : String(value);
}

/** A setting set, stepped or flipped; the outcome names it with its new value and keeps the old one for "Annulla". */
async function change(action: Extract<SearchAction, { do: "set" | "nudge" | "toggle" }>): Promise<RunOutcome> {
  const spec = SETTINGS.find((s) => s.id === action.id);
  if (!spec) return {};
  const before = await read(spec.id);
  if (before === null) return { error: t("Crest kann die Helligkeit hier nicht einstellen") };
  let to: SettingValue;
  if (action.do === "toggle") to = !before;
  else if (action.do === "nudge") {
    if (spec.kind !== "number") return {};
    to = nudged(spec, Number(before), action.by);
  } else to = spec.kind === "number" ? clampSetting(spec, Number(action.to)) : action.to;
  await write(spec.id, to);
  return { done: `${t(spec.names[0])}: ${shown(spec, to)}`, undo: { do: "set", id: spec.id, to: before } };
}

/** Runs a row's action. Capisci ("understand") is the panel's to ask Ask about; it hands back what Ask meant, to run here. */
export async function runAction(action: SearchAction, engine: SearchEngine): Promise<RunOutcome> {
  try {
    switch (action.do) {
      case "copy":
        await navigator.clipboard.writeText(action.text);
        return { done: t("Kopiert") };
      case "app":
        // An app with a window already open comes forward instead (launcher.rs `reuse`).
        await launcher.open(action.id, false, true);
        return { close: true };
      case "tool": {
        // Over the same item: in the panel, or in the notch for a tool the panel does not show (openPanel).
        const at = panel.get()?.anchor;
        if (at) openPanel({ kind: "tool", tool: action.tool }, at);
        return {};
      }
      case "settings":
        await settingsWindow.open(action.query ? null : action.section, action.query);
        return { close: true };
      case "widget":
        setTaskbar((cur) => ({ zones: action.add ? addWidget(cur.zones, action.id, "right") : removeWidget(cur.zones, action.id) }));
        return { done: t(action.add ? "Zur Leiste hinzugefügt" : "Von der Leiste entfernt"), undo: { ...action, add: !action.add } };
      case "file":
      case "path":
        await openFile(action.path);
        return { close: true };
      case "reveal":
        await revealFile(action.path);
        return { close: true };
      case "web":
        await webSearchBrowser(action.query, engine);
        return { close: true };
      case "understand":
        return {};
      case "set":
      case "nudge":
      case "toggle":
        return await change(action);
    }
  } catch (e) {
    // A path that is not there: openFile checks it first (lib.rs `open_path`).
    return { error: action.do === "path" ? t("Pfad nicht gefunden") : tBackend(String(e)) };
  }
}
