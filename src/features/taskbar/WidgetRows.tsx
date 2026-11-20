import { Plus, X } from "@phosphor-icons/react";
import { t } from "../../i18n";
import { PART_IDS } from "../../notch/row/parts";
import { partInfo } from "../../notch/row/partInfo";
import { settings, updateSettings } from "../../settings/store";
import { Select, SubSwitch } from "../../ui/controls";
import { setMusic } from "../now-playing/music";
import { shownIds } from "../usage/cards";
import { TOOL_BUTTONS, type ToolItem, type Zone } from "./model";
import { setTaskbar } from "./store";
import { toolInfo } from "./toolInfo";
import { addableTools, addWidget, barWidgets, isTool, isWidget, removeWidget, toolOf, toolShown, type Removable } from "./widgets";

/*
 * The widgets' pieces of Settings → Taskbar → Items (TaskbarItems draws the rows): a widget's or a tool button's options in its row
 * and each zone's Add widget and Add tool. Only the clock's switches are the bar's own; the others are the closed notch's settings,
 * as its parts page sets them.
 */

/** As on the closed notch's parts page: only these readings always show, so one of them stays on. */
const MAIN_READINGS = ["cpu", "ram", "gpu", "net"] as const;

/** A widget's switches, what it shows nothing without, and the button that takes it off the bar. */
export function WidgetOptions({ id }: { id: Removable }) {
  const s = settings.use();
  const readingsOn = MAIN_READINGS.filter((k) => s.closed.readings[k]).length;
  // In the words of the notch's settings.
  const needs: Partial<Record<Removable, string | false>> = {
    github: !s.github.user.trim() && t("Braucht deinen GitHub-Namen"),
    leetcode: !s.leetcode.user.trim() && t("Braucht deinen LeetCode-Namen"),
    script: !(s.notices.enabled && s.notices.cli) && t("Braucht Live-Mitteilungen und crest-notify"),
    calendar: !s.calendar.sources.length && t("Kein Kalender verbunden"),
    rings: !shownIds(s.aiUsage.order, s.usage).length && t("Keine Anbieter aktiv"),
    discord: !s.discord.clientId.trim() && t("Client-ID und Secret fehlen"),
  };
  const switches =
    id === "clock" ? (
      <>
        <SubSwitch label={t("Datum")} checked={s.taskbar.clock.date} onChange={(date) => setTaskbar((cur) => ({ clock: { ...cur.clock, date } }))} />
        <SubSwitch label={t("Sekunden")} checked={s.taskbar.clock.seconds} onChange={(seconds) => setTaskbar((cur) => ({ clock: { ...cur.clock, seconds } }))} />
      </>
    ) : id === "readings" ? (
      MAIN_READINGS.map((k) => (
        <SubSwitch
          key={k}
          label={k.toUpperCase()}
          checked={s.closed.readings[k]}
          onChange={(v) => (v || readingsOn > 1) && updateSettings((cur) => ({ closed: { ...cur.closed, readings: { ...cur.closed.readings, [k]: v } } }))}
        />
      ))
    ) : id === "title" ? (
      <>
        <SubSwitch label={t("Songtext")} checked={s.music.titleLyrics} onChange={(titleLyrics) => setMusic({ titleLyrics })} />
        <SubSwitch label={t("Endlos scrollen")} checked={s.music.titleLoop} onChange={(titleLoop) => setMusic({ titleLoop })} />
      </>
    ) : null;
  // A tool button whose tool is off in the notch stays here, hidden on the bar until the tool is on again.
  const caption =
    id === "readings" || id === "title" ? t("Gilt auch für die Notch") : isTool(id) ? !toolShown(toolOf(id), s.tools) && t("In der Notch ausgeschaltet") : needs[id];
  return (
    <div className="flex min-w-0 items-center gap-3">
      {(switches || caption) && (
        <div className="flex min-w-0 flex-col items-end gap-0.5">
          {switches && (
            <div onPointerDown={(e) => e.stopPropagation()} className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
              {switches}
            </div>
          )}
          {caption && <span className="text-end text-caption text-label-3 select-none">{caption}</span>}
        </div>
      )}
      <button
        aria-label={t("Entfernen")}
        title={t("Entfernen")}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setTaskbar((cur) => ({ zones: removeWidget(cur.zones, id) }))}
        className="pressable flex size-6 shrink-0 items-center justify-center rounded-full text-label-3 hover:bg-fill-2 hover:text-label-2"
      >
        <X size={12} weight="bold" />
      </button>
    </div>
  );
}

/** A zone's "+": the widgets, the tray and Stato not on the bar; the one picked goes last in the zone, before the Crest button (addWidget). */
export function AddWidget({ zone }: { zone: Zone }) {
  const zones = settings.use().taskbar.zones;
  const on = barWidgets(zones);
  const off: Exclude<Removable, ToolItem>[] = PART_IDS.filter((id) => !on.includes(id));
  for (const id of ["tray", "status"] as const) if (!Object.values(zones).some((items) => items.includes(id))) off.push(id);
  if (!off.length) return null;
  return (
    <Select<string>
      width="shrink-0"
      value=""
      menuMax={480}
      options={off.map((id) => ({ value: id, label: t(id === "tray" ? "Infobereich" : id === "status" ? "Status" : partInfo[id].label) }))}
      onChange={(id) => (isWidget(id) || id === "tray" || id === "status") && setTaskbar((cur) => ({ zones: addWidget(cur.zones, id, zone) }))}
      trigger={{
        label: t("Widget hinzufügen"),
        menuWidth: 220,
        className: "pressable pressable-fill flex h-7 items-center gap-1.5 rounded-full bg-fill-2 px-2.5 text-footnote font-medium text-label",
        content: (
          <>
            <Plus size={13} weight="bold" />
            <span>{t("Widget hinzufügen")}</span>
          </>
        ),
      }}
    />
  );
}

/** A zone's Add tool: the tools a button can open, not on the bar and able to open (widgets.ts addableTools); the one picked goes where Add widget puts a widget. */
export function AddTool({ zone }: { zone: Zone }) {
  const s = settings.use();
  const offered = addableTools(s.taskbar.zones, s.tools);
  if (!offered.length) return null;
  return (
    <Select<string>
      width="shrink-0"
      value=""
      menuMax={480}
      options={offered.map((id) => ({ value: id, label: t(toolInfo[id].label) }))}
      onChange={(id) => TOOL_BUTTONS.includes(id) && setTaskbar((cur) => ({ zones: addWidget(cur.zones, `tool:${id}`, zone) }))}
      trigger={{
        label: t("Tool hinzufügen"),
        menuWidth: 220,
        className: "pressable pressable-fill flex h-7 items-center gap-1.5 rounded-full bg-fill-2 px-2.5 text-footnote font-medium text-label",
        content: (
          <>
            <Plus size={13} weight="bold" />
            <span>{t("Tool hinzufügen")}</span>
          </>
        ),
      }}
    />
  );
}
