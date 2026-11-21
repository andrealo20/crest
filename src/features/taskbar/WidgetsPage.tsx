import type { CSSProperties, KeyboardEvent } from "react";
import { AnimatePresence } from "motion/react";
import { Plus, X } from "@phosphor-icons/react";
import { t } from "../../i18n";
import { fontEpoch } from "../../notch/row/measure";
import { PART_IDS, type PartId } from "../../notch/row/parts";
import { partInfo } from "../../notch/row/partInfo";
import { settings, type Settings } from "../../settings/store";
import { Group, Row, Select } from "../../ui/controls";
import { clocks } from "../clocks/store";
import { isZone } from "../clocks/zones";
import { useClosedInk } from "../themes/store";
import type { Zone } from "./model";
import { SAMPLE_AT, SAMPLE_TIMER, sampleFeed } from "./sampleFeed";
import { statusPill } from "./statusModel";
import { setTaskbar } from "./store";
import { widgetNeeds } from "./WidgetRows";
import { addWidget, applyChoice, barWidgets, chosenChoice, pillWidget, removeWidget, variantKey, widgetChoices, type WidgetChoice } from "./widgets";
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
};
const choiceLabel = (c: WidgetChoice) => t(c.variant === "digital" ? (c.date ? "Uhrzeit und Datum" : "Nur Uhrzeit") : VARIANT_LABEL[c.variant ?? ""]);

export function WidgetsPage() {
  fontEpoch.use();
  const s = settings.use();
  const first = clocks.use()[0], zone = isZone(first) ? first : null;
  return (
    <Group id="settings-taskbar-widgets">
      {PART_IDS.map((id) => (
        <div key={id}>
          <WidgetRow id={id} s={s} />
          <Versions id={id} s={s} zone={zone} />
        </div>
      ))}
    </Group>
  );
}

/** A widget's name, what it shows nothing without, and its Remove button on the bar or its Add menu off it. */
function WidgetRow({ id, s }: { id: PartId; s: Settings }) {
  const on = barWidgets(s.taskbar.zones).includes(id);
  return (
    <Row label={t(partInfo[id].label)} hint={widgetNeeds(s)[id] || undefined}>
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
function Versions({ id, s, zone }: { id: PartId; s: Settings; zone: string | null }) {
  const choices = widgetChoices(id, zone !== null);
  const chosen = chosenChoice(id, s.taskbar.variants, s.taskbar.clock.date, zone !== null);
  if (choices.length === 1)
    return (
      <div className="flex flex-wrap gap-3 px-3 pb-3">
        <Preview id={id} choice={choices[0]} s={s} zone={zone} />
      </div>
    );
  // Decision 17: the version already chosen, or an empty patch, writes nothing.
  const pick = (i: number) => {
    if (i === chosen) return;
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
          // The ring marks the version chosen, an outline outside it the focus, which lands on that same version.
          className={`flex flex-col items-center gap-1 rounded-[10px] outline-offset-2 outline-label-2 focus-visible:outline-2 ${i === chosen ? "ring-2 ring-accent" : ""}`}
        >
          <Preview id={id} choice={c} s={s} zone={zone} />
          <span className={`px-1.5 pb-1 text-caption ${i === chosen ? "text-label" : "text-label-2"}`}>{choiceLabel(c)}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * One version on the bar's surface, as the bar draws it (decision 16): the closed notch's ink on its colour with Background Notch,
 * the theme's otherwise; 44 px tall, at scale 1, on the pill where the bar has one. Sample data only: the equalizer rests (paused),
 * the timer is SAMPLE_TIMER and the clocks show SAMPLE_AT, so the page never starts the audio capture, reads the real timer or ticks.
 */
function Preview({ id, choice, s, zone }: { id: PartId; choice: WidgetChoice; s: Settings; zone: string | null }) {
  const { taskbar, units, music } = s;
  const closed = useClosedInk(undefined);
  const surface: CSSProperties = taskbar.surface === "notch" ? { ...closed, background: "var(--notch-closed)" } : { background: "var(--color-notch)" };
  const { node, width } = widgetBody(id, {
    feed: sampleFeed(s.closed.readings),
    paused: true,
    hovered: false,
    clock: { ...taskbar.clock, date: choice.date ?? taskbar.clock.date },
    h12: units.clock === "12",
    titleLoop: music.titleLoop,
    timerRunning: true,
    timerDuration: SAMPLE_TIMER.duration,
    variants: choice.variant ? { [id]: choice.variant } : {},
    zone,
    at: SAMPLE_AT,
    sample: true,
  });
  const pill = pillWidget(id, taskbar.shape === "tiles") ? statusPill(44) : null;
  return (
    // Hidden from screen readers: a radio is named by its version, not by the sample's figures. Left to right, as the bar's ink is.
    <span aria-hidden dir="ltr" className="flex h-11 items-center rounded-[10px] px-2" style={surface}>
      <span className={pill ? "flex items-center rounded-full bg-fill-2" : "flex"} style={pill ? { height: pill.height, paddingInline: pill.pad } : undefined}>
        <span className="grid h-[30px] overflow-clip" style={{ width }}>
          <AnimatePresence initial={false}>{node}</AnimatePresence>
        </span>
      </span>
    </span>
  );
}
