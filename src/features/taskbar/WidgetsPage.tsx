import type { CSSProperties, KeyboardEvent } from "react";
import { AnimatePresence } from "motion/react";
import { Plus, X } from "../../ui/iconset";
import { t } from "../../i18n";
import { fontEpoch } from "../../notch/row/measure";
import { PART_IDS, type PartId } from "../../notch/row/parts";
import { partInfo } from "../../notch/row/partInfo";
import { settings, type Settings } from "../../settings/store";
import type { RowSymbol } from "../../ui/materialNames";
import { Group, Row, Select } from "../../ui/controls";
import { clocks } from "../clocks/store";
import { normalizeZones } from "../clocks/zones";
import { liveSupport } from "../../notch/glass/live";
import { darkInk, useClosedInk } from "../themes/store";
import { barLook } from "./look";
import type { Zone } from "./model";
import { SAMPLE_AT, SAMPLE_TIMER, sampleFeed } from "./sampleFeed";
import { statusPill } from "./statusModel";
import { setTaskbar } from "./store";
import { widgetNeeds } from "./WidgetRows";
import { addWidget, applyChoice, barWidgets, chosenChoice, pillWidget, previewInk, removeWidget, variantKey, widgetChoices, type WidgetChoice } from "./widgets";
import { widgetBody } from "./window/Widget";

/*
 * Settings → Taskbar → Widgets: every widget with how it looks on the bar, the versions to choose from, and Add or Remove. It only
 * saves, as the other Taskbar pages: the bar redraws on the settings.
 */

/** The bar's zones, physical, as Items names them. */
const ZONES: { zone: Zone; label: string }[] = [
  { zone: "left", label: "Linke Seite" },
  { zone: "center", label: "Mitte" },
  { zone: "right", label: "Rechte Seite" },
];

/** A version's name; the digital clock's two by its date. */
const VARIANT_LABEL: Record<string, string> = {
  temp: "Temperatur",
  icon: "Nur Symbol",
  condition: "Symbol und Wetterlage",
  hours: "Nächste Stunden",
  analog: "Analog",
  zones: "Zwei Zeitzonen",
  dials: "Rundanzeigen",
  bars: "Balken",
  line: "CPU-Verlauf",
  countdown: "Countdown",
  ring: "Ring",
  system: "Systemlaufwerk",
  all: "Alle Laufwerke",
  fullest: "Vollstes Laufwerk",
  net: "Netzwerkverlauf",
  cpu: "Nach CPU",
  ram: "Nach Speicher",
  cells: "Zellen",
  gauge: "Zeiger",
  dots: "Punkte",
  text: "Titelzeile",
  play: "Mit Wiedergabetaste",
  cover: "Cover und Tasten",
  disc: "Rund",
  track: "Mit Fortschritt",
  mic: "Nur Mikrofon",
  both: "Mikrofon und Ton",
  flip: "Klappzahlen",
  segment: "Segmentanzeige",
  weather: "Uhrzeit und Wetter",
  fulldate: "Wochentag und Datum",
  sheet: "Kalenderblatt",
  week: "Woche",
  world: "Andere Stadt",
  cities: "Weltuhren",
  // Today, not "Tag": that key is the daytime of the weather in several languages.
  day: "Heute",
  month: "Monat",
  year: "Jahr",
  details: "Details",
  forecast: "Nächste Tage",
  sun: "Sonnenaufgang und Sonnenuntergang",
};
/** Each widget's row symbol under Material: the Material name of its partInfo icon, as the Content and Items lists draw it; the brand logos have none and keep a symbol of their own. */
const SYMBOL: Record<PartId, RowSymbol> = {
  timer: "timer",
  discord: "record_voice_over",
  rings: "donut_large",
  title: "music_note",
  readings: "memory",
  equalizer: "graphic_eq",
  clock: "schedule",
  github: "trending_up",
  leetcode: "data_object",
  calendar: "calendar_today",
  script: "terminal",
  downloads: "download",
  weather: "partly_cloudy_day",
  disk: "storage",
  processes: "web_asset",
  battery: "battery_full",
  mic: "mic",
  stopwatch: "update",
  todo: "check_circle",
  note: "edit_square",
  progress: "speed",
  date: "looks_one",
  world: "public",
  currency: "swap_horiz",
  crypto: "show_chart",
};
const choiceLabel = (c: WidgetChoice) => t(c.variant === "digital" ? (c.date ? "Uhrzeit und Datum" : "Nur Uhrzeit") : VARIANT_LABEL[c.variant ?? ""]);

export function WidgetsPage() {
  fontEpoch.use();
  const s = settings.use();
  const zones = normalizeZones(clocks.use());
  return (
    <Group id="settings-taskbar-widgets">
      {PART_IDS.map((id) => (
        <div key={id}>
          <WidgetRow id={id} s={s} zoned={zones.length > 0} />
          <Versions id={id} s={s} zones={zones} />
        </div>
      ))}
    </Group>
  );
}

/** A widget's name, what it shows nothing without, and its Remove button on the bar or its Add menu off it. */
function WidgetRow({ id, s, zoned }: { id: PartId; s: Settings; zoned: boolean }) {
  const on = barWidgets(s.taskbar.zones).includes(id);
  return (
    <Row icon={SYMBOL[id]} label={t(partInfo[id].label)} hint={widgetNeeds(s, zoned)[id] || undefined}>
      {on ? (
        <button
          aria-label={t("Entfernen")}
          title={t("Entfernen")}
          onClick={() => setTaskbar((cur) => ({ zones: removeWidget(cur.zones, id) }))}
          className="pressable flex size-6 shrink-0 items-center justify-center rounded-full text-label-3 hover:bg-fill-2 hover:text-label-2"
        >
          <X size={12} weight="bold" />
        </button>
      ) : (
        <Select<string>
          width="shrink-0"
          value=""
          options={ZONES.map((z) => ({ value: z.zone, label: t(z.label) }))}
          onChange={(to) => {
            const z = ZONES.find((x) => x.zone === to);
            if (z) setTaskbar((cur) => ({ zones: addWidget(cur.zones, id, z.zone) }));
          }}
          trigger={{
            label: t("Hinzufügen"),
            menuWidth: 160,
            className: "pressable pressable-fill flex h-7 items-center gap-1.5 rounded-full bg-fill-2 px-2.5 text-footnote font-medium text-label",
            content: (
              <>
                <Plus size={13} weight="bold" />
                <span>{t("Hinzufügen")}</span>
              </>
            ),
          }}
        />
      )}
    </Row>
  );
}

/** A widget's previews: one alone, or its versions as a radio group, the saved one checked; the arrows move and pick. */
function Versions({ id, s, zones }: { id: PartId; s: Settings; zones: readonly string[] }) {
  const choices = widgetChoices(id, zones.length > 0);
  const chosen = chosenChoice(id, s.taskbar.variants, s.taskbar.clock.date, zones.length > 0);
  if (choices.length === 1)
    return (
      <div className="flex flex-wrap gap-3 px-3 pb-3">
        <Preview id={id} choice={choices[0]} s={s} zones={zones} />
      </div>
    );
  // Decision 17: a pick that changes nothing saved writes nothing; the version shown may differ from the saved one (applyChoice).
  const pick = (i: number) => {
    const p = applyChoice(settings.get().taskbar, id, choices[i]);
    if (Object.keys(p).length) setTaskbar(p);
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const j = variantKey(e.key, i, choices.length, document.documentElement.dir === "rtl");
    if (j === undefined) return;
    e.preventDefault();
    (e.currentTarget.parentElement?.children[j] as HTMLElement | undefined)?.focus();
    pick(j);
  };
  return (
    <div role="radiogroup" aria-label={t("Version")} className="flex flex-wrap gap-3 px-3 pb-3">
      {choices.map((c, i) => (
        <button
          key={i}
          role="radio"
          aria-checked={i === chosen}
          tabIndex={i === chosen ? 0 : -1}
          onClick={() => pick(i)}
          onKeyDown={(e) => onKey(e, i)}
          // The ring marks the version chosen, an outline outside it the focus, which lands on that same version. Under Material a
          // radio card as StyleCards draws it: the chosen one tonal with a primary ring, the others lit by a state layer on hover.
          className={`flex flex-col items-center gap-1 rounded-[10px] outline-offset-2 outline-label-2 focus-visible:outline-2 material:rounded-[16px] material:p-1 ${
            i === chosen ? "ring-2 ring-accent material:bg-secondary-container material:ring-primary" : "material:hover:bg-fill-2"
          }`}
        >
          <Preview id={id} choice={c} s={s} zones={zones} />
          <span className={`px-1.5 pb-1 text-caption ${i === chosen ? "text-label material:text-on-secondary-container" : "text-label-2"}`}>{choiceLabel(c)}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * One version on the bar's surface, as the bar draws it (decision 16): the bar's ink (previewInk: Dark's under Liquid Glass +, the
 * closed notch's with Background Notch, the theme's otherwise) on the surface's colour; 44 px tall, at scale 1, on the pill where the bar has one. Sample data only: the equalizer rests (paused),
 * the timer is SAMPLE_TIMER and the clocks show SAMPLE_AT, so the page never starts the audio capture, reads the real timer or ticks.
 */
function Preview({ id, choice, s, zones }: { id: PartId; choice: WidgetChoice; s: Settings; zones: readonly string[] }) {
  const { taskbar, units, music } = s;
  const closed = useClosedInk(undefined);
  const supported = liveSupport.use()?.supported === true;
  // The colour read through the ink's own tokens, as on the bar: Dark's surface under Liquid Glass +, so white text stays on dark.
  const ink = previewInk(barLook(taskbar, supported), taskbar.surface, closed, darkInk());
  const surface: CSSProperties = { ...ink, background: taskbar.surface === "notch" ? "var(--notch-closed)" : "var(--color-notch)" };
  const { node, width } = widgetBody(id, {
    // The network's line draws download and upload, so its sample has them with NET off for the notch too.
    feed: sampleFeed(choice.variant === "net" ? { ...s.closed.readings, net: true } : s.closed.readings),
    paused: true,
    hovered: false,
    clock: { ...taskbar.clock, date: choice.date ?? taskbar.clock.date },
    h12: units.clock === "12",
    titleLoop: music.titleLoop,
    timerRunning: true,
    timerDuration: SAMPLE_TIMER.duration,
    variants: choice.variant ? { [id]: choice.variant } : {},
    zones,
    at: SAMPLE_AT,
    sample: true,
  });
  const pill = pillWidget(id, taskbar.shape === "tiles") ? statusPill(44) : null;
  return (
    // Hidden from screen readers: a radio is named by its version, not by the sample's figures. Left to right, as the bar's ink is.
    <span aria-hidden dir="ltr" className="flex h-11 items-center rounded-[10px] px-2 material:rounded-[12px]" style={surface}>
      <span className={pill ? "flex items-center rounded-full bg-fill-2" : "flex"} style={pill ? { height: pill.height, paddingInline: pill.pad } : undefined}>
        <span className="grid h-[30px] overflow-clip" style={{ width }}>
          <AnimatePresence initial={false}>{node}</AnimatePresence>
        </span>
      </span>
    </span>
  );
}
