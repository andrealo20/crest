import { settings, updateSettings } from "../../settings/store";
import { Group, Row, Segmented, Select, Switch } from "../../ui/controls";
import { lang, t } from "../../i18n";
import { DATE_LANGUAGES } from "../todos/dates";
import { formatMinutes } from "./water";
import { waterActions } from "./store";
import { formatMl } from "./format";
import { SEARCH_ENGINES, type SearchSetting } from "../overview/search";
import { OVERVIEW_PARTS, TILES, setOverviewPart, type OverviewPart } from "../overview/parts";
import { stopAwake } from "../overview/store";
import { hueVar, useIconColors, type Hue } from "../themes/hues";
import { isMac } from "../../platform/native";
import { Clock, CloudSun, Coffee, Moon, Play, SlidersHorizontal, SpeakerHigh, Sun, type Icon } from "../../ui/iconset";

/** Each Overview part's name (a key for t()), icon and hue, in Overview's order. */
const partInfo: Record<OverviewPart, { label: string; icon: Icon; hue: Hue }> = {
  clock: { label: "Uhrzeit", icon: Clock, hue: "blue" },
  weather: { label: "Wetter", icon: CloudSun, hue: "sky" },
  activity: { label: "Aktivität", icon: Play, hue: "pink" },
  focus: { label: "Fokus", icon: Moon, hue: "indigo" },
  awake: { label: "Wach halten", icon: Coffee, hue: "amber" },
  volume: { label: "Lautstärke", icon: SpeakerHigh, hue: "sky" },
  brightness: { label: "Helligkeit", icon: Sun, hue: "amber" },
  controls: { label: "Schnellsteuerung", icon: SlidersHorizontal, hue: "teal" },
};

/**
 * Overview's parts, each with its switch, as the closed row's (SettingsView ClosedParts) but in a fixed order. The last part that
 * always shows stays on (parts.ts setOverviewPart); a Mac shows no tiles, so their switches are left out there.
 */
function OverviewParts() {
  const parts = settings.use().productivity.overview;
  const iconColors = useIconColors();
  const shown = OVERVIEW_PARTS.filter((id) => !(isMac && (TILES as readonly OverviewPart[]).includes(id)));
  const set = (id: OverviewPart, on: boolean) => {
    // Read now, as the Dock's trash does: the switch that cannot go off writes nothing.
    const cur = settings.get().productivity.overview, next = setOverviewPart(cur, id, on, isMac);
    if (next === cur) return;
    updateSettings((s) => ({ productivity: { ...s.productivity, overview: next } }));
    // Its tile is keep awake's switch in the notch (the bar's Keep awake widget is the other), and the closed row's cup opens
    // Overview: hidden, it must not keep the PC awake.
    if (id === "awake" && !on) stopAwake();
  };
  return (
    <div>
      <Row icon="widgets" label={t("Übersicht")} />
      <div className="divide-y divide-separator">
        {shown.map((id) => {
          const { label, icon: I, hue } = partInfo[id];
          const on = parts[id];
          return (
            <div key={id} className="flex h-9 items-center gap-2.5 px-3">
              <I size={15} weight="bold" className={on && iconColors ? "" : on ? "text-label-2" : "text-label-4"} style={on && iconColors ? { color: hueVar(hue) } : undefined} />
              <span className={`flex-1 text-body select-none ${on ? "text-label" : "text-label-3"}`}>{t(label)}</span>
              <Switch label={t(label)} checked={on} onChange={(v) => set(id, v)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const BOTTLES = [250, 330, 500, 750, 1000];
const GOALS = [1500, 2000, 2500, 3000];
const EVERY = [30, 45, 60, 90, 120];
const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: String(h * 60), label: formatMinutes(h * 60) }));

/** Settings → Tools: to-do reminders, the Overview quote and search line, Overview's parts, and the water reminder. */
export function ProductivitySettings() {
  const s = settings.use();
  const p = s.productivity;
  const w = p.water;
  const toolOn = (id: string) => s.tools.some((x) => x.id === id && x.enabled);
  const set = (patch: Partial<typeof p>) => updateSettings((cur) => ({ productivity: { ...cur.productivity, ...patch } }));
  // A saved value outside the chips (older version, other screen) still shows as its own chip.
  const withValue = (list: number[], v: number) => (list.includes(v) ? list : [...list, v].sort((a, b) => a - b));

  return (
    <>
      <Group id="settings-todos" title={t("To-Dos und Übersicht")}>
        <Row icon="music_note" label={t("Ton bei Erinnerungen")} hint={toolOn("todos") ? t("Der Alarm-Ton des Timers, einmal") : t("Braucht das Tool To-Dos")}>
          <Switch label={t("Ton bei Erinnerungen")} checked={p.reminderSound} onChange={(reminderSound) => set({ reminderSound })} />
        </Row>
        {DATE_LANGUAGES.includes(lang()) && (
          <Row icon="edit_calendar" label={t("Datum in neuen Aufgaben erkennen")} hint={toolOn("todos") ? t("Zeigt eine Fälligkeit unter dem Feld; Enter übernimmt sie") : t("Braucht das Tool To-Dos")}>
            <Switch label={t("Datum in neuen Aufgaben erkennen")} checked={p.nlDates} onChange={(nlDates) => set({ nlDates })} />
          </Row>
        )}
        <Row icon="format_quote" label={t("Zitat in der Übersicht")} hint={t("Eine kurze Zeile für die schweren Stunden")}>
          <Switch label={t("Zitat in der Übersicht")} checked={p.quotes} onChange={(quotes) => set({ quotes })} />
        </Row>
        <Row icon="travel_explore" label={t("Websuche in der Übersicht")} hint={t("Ein Feld, das im Standardbrowser sucht")}>
          <Select<SearchSetting>
            width="w-36"
            value={p.search}
            onChange={(search) => set({ search })}
            options={[{ value: "off", label: t("Aus") }, ...SEARCH_ENGINES.map((e) => ({ value: e.id, label: e.name }))]}
          />
        </Row>
        <OverviewParts />
      </Group>
      <Group id="settings-water" title={t("Wasser")}>
        <Row icon="water_drop" label={t("Erinnerungen")} hint={toolOn("water") ? t("Ein Hinweis in der geschlossenen Notch, bis das Tagesziel erreicht ist") : t("Braucht das Tool Wasser")}>
          <Switch label={t("Erinnerungen")} checked={w.remind} onChange={(remind) => waterActions.setConfig({ remind })} />
        </Row>
        <Row icon="water_full" label={t("Flasche")} hint={t("So viel zählt ein Klick auf Trinken")}>
          <Segmented label={t("Flasche")} id="water-bottle" size="sm" value={String(w.bottleMl)} onChange={(v) => waterActions.setConfig({ bottleMl: Number(v) })} options={withValue(BOTTLES, w.bottleMl).map((v) => ({ value: String(v), label: formatMl(v) }))} />
        </Row>
        <Row icon="flag" label={t("Tagesziel")}>
          <Segmented label={t("Tagesziel")} id="water-goal" size="sm" value={String(w.goalMl)} onChange={(v) => waterActions.setConfig({ goalMl: Number(v) })} options={withValue(GOALS, w.goalMl).map((v) => ({ value: String(v), label: formatMl(v) }))} />
        </Row>
        <Row icon="repeat" label={t("Erinnern alle")}>
          <Segmented label={t("Erinnern alle")} id="water-every" size="sm" value={String(w.everyMin)} onChange={(v) => waterActions.setConfig({ everyMin: Number(v) })} options={withValue(EVERY, w.everyMin).map((v) => ({ value: String(v), label: t("{n} Min.", { n: v }) }))} />
        </Row>
        <Row icon="avg_time" label={t("Zeitraum")} hint={t("Außerhalb davon keine Erinnerungen")}>
          <div className="flex items-center gap-1.5">
            <Select width="w-20" value={String(w.from - (w.from % 60))} onChange={(v) => waterActions.setConfig({ from: Number(v) })} options={HOURS} />
            <span className="text-caption text-label-3">{t("bis")}</span>
            <Select width="w-20" value={String(w.to - (w.to % 60))} onChange={(v) => waterActions.setConfig({ to: Number(v) })} options={HOURS} />
          </div>
        </Row>
      </Group>
    </>
  );
}
