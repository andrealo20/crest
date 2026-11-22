import { Plus, X } from "../../ui/iconset";
import { t } from "../../i18n";
import { PART_IDS } from "../../notch/row/parts";
import { partInfo } from "../../notch/row/partInfo";
import { settings, updateSettings, type Settings } from "../../settings/store";
import { clocks } from "../clocks/store";
import { isZone } from "../clocks/zones";
import { Select, SubSwitch } from "../../ui/controls";
import { setMusic } from "../now-playing/music";
import { shownIds } from "../usage/cards";
import { CRYPTO_COINS, TOOL_BUTTONS, variantOf, type SysItem, type ToolItem, type Zone } from "./model";
import { setTaskbar } from "./store";
import { toolInfo } from "./toolInfo";
import { addableSys, addableTools, addWidget, barWidgets, clockHasSeconds, isSys, isTool, isWidget, removeWidget, sysOf, toolOf, toolShown, type Removable } from "./widgets";
import { SYS_INFO } from "./window/SysItems";

/*
 * The widgets' pieces of Settings → Taskbar → Items (TaskbarItems draws the rows): a widget's or a tool button's options in its row
 * and each zone's Add widget, Add tool and Add Windows button. Only the clock's switches are the bar's own; the others are the closed notch's settings,
 * as its parts page sets them.
 */

/** As on the closed notch's parts page: only these readings always show, so one of them stays on. */
const MAIN_READINGS = ["cpu", "ram", "gpu", "net"] as const;

/** What a widget shows nothing without, in the words of the notch's settings; false when it has it. `zoned`: Clocks has a zone. */
export const widgetNeeds = (s: Settings, zoned: boolean): Partial<Record<Removable, string | false>> => ({
  github: !s.github.user.trim() && t("Braucht deinen GitHub-Namen"),
  leetcode: !s.leetcode.user.trim() && t("Braucht deinen LeetCode-Namen"),
  script: !(s.notices.enabled && s.notices.cli) && t("Braucht Live-Mitteilungen und crest-notify"),
  calendar: !s.calendar.sources.length && t("Kein Kalender verbunden"),
  rings: !shownIds(s.aiUsage.order, s.usage).length && t("Keine Anbieter aktiv"),
  discord: !s.discord.clientId.trim() && t("Client-ID und Secret fehlen"),
  world: !zoned && t("Braucht eine Zeitzone in Uhren"),
});

/**
 * A widget's switches, what it shows nothing without, and the button that takes it off the bar. The clock's date is picked on the
 * Widgets page, with its versions; its seconds only where the version drawn has them (not Analog or Two time zones).
 */
export function WidgetOptions({ id }: { id: Removable }) {
  const s = settings.use();
  const readingsOn = MAIN_READINGS.filter((k) => s.closed.readings[k]).length;
  const zoned = isZone(clocks.use()[0]);
  const needs = widgetNeeds(s, zoned);
  const switches =
    id === "clock" ? (
      clockHasSeconds(s.taskbar.variants, zoned) && <SubSwitch label={t("Sekunden")} checked={s.taskbar.clock.seconds} onChange={(seconds) => setTaskbar((cur) => ({ clock: { ...cur.clock, seconds } }))} />
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
        {/* Only the scrolling line sings: the other versions show title and artist. */}
        {variantOf(s.taskbar.variants, "title") === "text" && <SubSwitch label={t("Songtext")} checked={s.music.titleLyrics} onChange={(titleLyrics) => setMusic({ titleLyrics })} />}
        <SubSwitch label={t("Endlos scrollen")} checked={s.music.titleLoop} onChange={(titleLoop) => setMusic({ titleLoop })} />
      </>
    ) : id === "crypto" ? (
      <Select value={s.taskbar.coin} options={CRYPTO_COINS.map((c) => ({ value: c, label: c }))} onChange={(coin) => setTaskbar({ coin })} width="w-24" />
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
  const off: Exclude<Removable, ToolItem | SysItem>[] = PART_IDS.filter((id) => !on.includes(id));
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

/** A zone's Add Windows button: Search, Task view, Windows widgets and Show desktop, those not on the bar (widgets.ts addableSys); the one picked goes where Add widget puts a widget. */
export function AddSys({ zone }: { zone: Zone }) {
  const offered = addableSys(settings.use().taskbar.zones);
  if (!offered.length) return null;
  return (
    <Select<string>
      width="shrink-0"
      value=""
      menuMax={480}
      options={offered.map((id) => ({ value: id, label: t(SYS_INFO[sysOf(id)].label) }))}
      onChange={(id) => isSys(id) && setTaskbar((cur) => ({ zones: addWidget(cur.zones, id, zone) }))}
      trigger={{
        label: t("Windows-Schaltfläche hinzufügen"),
        menuWidth: 220,
        className: "pressable pressable-fill flex h-7 items-center gap-1.5 rounded-full bg-fill-2 px-2.5 text-footnote font-medium text-label",
        content: (
          <>
            <Plus size={13} weight="bold" />
            <span>{t("Windows-Schaltfläche hinzufügen")}</span>
          </>
        ),
      }}
    />
  );
}
