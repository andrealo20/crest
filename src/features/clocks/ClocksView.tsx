import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowCounterClockwise, ArrowDown, ArrowUp, MagnifyingGlass, MapPin, Moon, Plus, Sun, X } from "@phosphor-icons/react";
import { content, springs } from "../../design/motion";
import { HeaderActions, HeaderButton, activeTool } from "../../notch/header";
import { navigate } from "../../notch/nav";
import { windowShell } from "../../platform/services";
import { settings } from "../../settings/store";
import { formatTime } from "../../lib/format";
import { locale, t } from "../../i18n";
import { Button, Slider } from "../../ui/controls";
import { useHue } from "../themes/hues";
import { peekForecast } from "../weather/store";
import { moonPhase, sunDay, type MoonPhaseName } from "./astro";
import { clockActions, clocks } from "./store";
import { MAX_ZONES, allZones, cityName, dayDelta, formatClock, formatDiff, formatUtc, isDay, localZone, regionName, searchZones, wallTime, zoneOffset } from "./zones";

const QUARTER = 15 * 60_000;
/** The reference time moves in quarter hours, a day either way: Nepal's :45 and Adelaide's :30 stay reachable. */
const SLOTS = 96;

/*
 *  ☀ Here        Rome            tomorrow  +1 h   00:30   ← the reference time in every zone
 *  ☾ Tokyo       Asia            tomorrow  +9 h   08:30
 *  ──●────────────── +3 h 15 min  ↺          ← slides the reference time a day either way
 *  Right: sunrise, sunset, golden hour at the weather location, and the moon.
 */
export function ClocksView() {
  const zones = clocks.use();
  const cfg = settings.use();
  const onScreen = activeTool.use() === "clocks";
  const [hidden, setHidden] = useState(false);
  useEffect(() => windowShell.onHidden(setHidden), []);
  const now = useMinute(onScreen && !hidden);
  const home = useMemo(localZone, []);
  const h12 = cfg.units.clock === "12";

  // Slid away from now: the base is fixed on the first move, so the time chosen does not creep along with the clock.
  const [shift, setShift] = useState<{ base: number; slots: number } | null>(null);
  const at = shift ? shift.base + shift.slots * QUARTER : now;
  const move = (slots: number) => setShift(slots === 0 ? null : (s) => ({ base: s?.base ?? Math.floor(Date.now() / QUARTER) * QUARTER, slots }));

  const [adding, setAdding] = useState(false);
  const full = zones.length >= MAX_ZONES;

  return (
    <div className="relative flex h-full gap-2 px-4 pt-1 pb-3">
      <HeaderActions>
        <HeaderButton label={full ? t("Höchstens {n} Städte", { n: MAX_ZONES }) : t("Stadt hinzufügen")} active={adding} disabled={full && !adding} onClick={() => setAdding((a) => !a)}>
          <Plus size={14} weight="bold" />
        </HeaderButton>
      </HeaderActions>

      <div className="flex min-w-0 flex-1 flex-col">
        {adding ? (
          <ZonePicker taken={[home, ...zones]} now={now} onDone={() => setAdding(false)} />
        ) : (
          <>
            <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1" role="list">
              <div role="listitem">
                <ClockRow zone={home} here at={at} now={now} home={home} h12={h12} shifted={!!shift} />
              </div>
              <AnimatePresence initial={false}>
                {zones.map((zone, i) => (
                  <motion.div key={zone} role="listitem" layout="position" transition={springs.morph} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: content.enter }} exit={{ opacity: 0, transition: content.exit }}>
                    <ClockRow zone={zone} at={at} now={now} home={home} h12={h12} shifted={!!shift} first={i === 0} last={i === zones.length - 1} />
                  </motion.div>
                ))}
              </AnimatePresence>
              {zones.length === 0 && <p className="px-2.5 pt-2 text-caption text-label-3">{t("Füge Städte hinzu, um ihre Uhrzeit neben deiner zu sehen.")}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-3 px-2.5 pt-2">
              <Slider label={t("Vergleichszeit verschieben")} value={shift?.slots ?? 0} min={-SLOTS} max={SLOTS} onChange={move} />
              <span className="tabular w-[92px] shrink-0 text-end text-caption text-label-2">{shift ? formatShift(Math.round((at - now) / QUARTER) * 15) : t("Jetzt")}</span>
              <button
                aria-label={t("Zurück zu Jetzt")}
                title={t("Zurück zu Jetzt")}
                onClick={() => setShift(null)}
                className={`pressable pressable-fill flex size-6 shrink-0 items-center justify-center rounded-full text-label-2 ${shift ? "" : "invisible"}`}
              >
                <ArrowCounterClockwise size={13} weight="bold" />
              </button>
            </div>
          </>
        )}
      </div>

      <Sky now={now} place={cfg.weather} />
    </div>
  );
}

/** The time, renewed at each full minute while `on`: nothing runs while the tool is out of sight. */
function useMinute(on: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    let id = 0;
    const tick = () => {
      setNow(Date.now());
      id = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    id = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    return () => window.clearTimeout(id);
  }, [on]);
  return now;
}

/** "+3 h 15 min", "-45 min". */
function formatShift(minutes: number): string {
  const a = Math.abs(minutes);
  const text = [Math.floor(a / 60) && t("{n} Std.", { n: Math.floor(a / 60) }), a % 60 && t("{n} Min.", { n: a % 60 })].filter(Boolean).join(" ");
  return `${minutes < 0 ? "-" : "+"}${text}`;
}

function DayDot({ day }: { day: boolean }) {
  const color = useHue(day ? "amber" : "indigo");
  const I = day ? Sun : Moon;
  return (
    <span role="img" aria-label={day ? t("Tag") : t("Nacht")} title={day ? t("Tag") : t("Nacht")} className="flex shrink-0">
      <I size={16} weight="fill" className={color ? undefined : day ? "text-label-2" : "text-label-3"} style={color ? { color } : undefined} />
    </span>
  );
}

function ClockRow(props: { zone: string; at: number; now: number; home: string; h12: boolean; shifted: boolean; here?: boolean; first?: boolean; last?: boolean }) {
  const { zone, at, now, home, here } = props;
  const loc = locale();
  const days = dayDelta(at, zone, now, home);
  const diff = zoneOffset(at, zone) - zoneOffset(at, home);
  // "tomorrow", "yesterday", "in 2 days": the language's own words.
  const dayText = days === 0 ? "" : new Intl.RelativeTimeFormat(loc, { numeric: "auto" }).format(days, "day");
  return (
    <div className="group flex h-10 items-center gap-2 rounded-[10px] px-2.5 hover:bg-fill-1 focus-within:bg-fill-1">
      <DayDot day={isDay(at, zone)} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-body leading-[18px] font-medium text-label">{here ? t("Hier") : cityName(zone)}</div>
        <div className="truncate text-caption text-label-3">{here ? cityName(zone) : regionName(zone)}</div>
      </div>
      <span className="w-[62px] shrink-0 truncate text-end text-caption text-label-3" title={dayText}>
        {dayText}
      </span>
      <span className="tabular w-[46px] shrink-0 text-end text-caption text-label-2">{here ? "" : formatDiff(diff)}</span>
      <span className={`tabular w-[74px] shrink-0 text-end text-title font-semibold ${props.shifted ? "text-link" : "text-label"}`}>{formatClock(wallTime(at, zone), loc, props.h12)}</span>
      <div className="flex w-[60px] shrink-0 items-center justify-end opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {!here && (
          <>
            <RowButton label={t("Nach oben")} disabled={props.first} onClick={() => clockActions.move(zone, -1)}>
              <ArrowUp size={12} weight="bold" />
            </RowButton>
            <RowButton label={t("Nach unten")} disabled={props.last} onClick={() => clockActions.move(zone, 1)}>
              <ArrowDown size={12} weight="bold" />
            </RowButton>
            <RowButton label={t("Entfernen")} onClick={() => clockActions.remove(zone)}>
              <X size={12} weight="bold" />
            </RowButton>
          </>
        )}
      </div>
    </div>
  );
}

function RowButton(props: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button aria-label={props.label} title={props.label} disabled={props.disabled} onClick={props.onClick} className="pressable pressable-fill flex size-5 items-center justify-center rounded-full text-label-3 hover:text-label disabled:opacity-30">
      {props.children}
    </button>
  );
}

/** Search over the engine's own list of zones; the city is the last part of the name. */
function ZonePicker({ taken, now, onDone }: { taken: string[]; now: number; onDone: () => void }) {
  const [query, setQuery] = useState("");
  const zones = useMemo(allZones, []);
  const hits = useMemo(() => searchZones(query, zones), [query, zones]);
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2"
      // Escape closes the search, not the notch.
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onDone();
      }}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 rounded-[12px] bg-fill-1 px-3">
        <MagnifyingGlass size={14} weight="bold" className="text-label-3" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t("Stadt oder Zeitzone suchen")}
          placeholder={t("Stadt oder Zeitzone suchen, z. B. Tokio")}
          className="min-w-0 flex-1 bg-transparent text-body text-label outline-none placeholder:text-label-4"
        />
        <button onClick={onDone} className="text-caption text-label-3 hover:text-label-2">
          {t("Abbrechen")}
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {hits.map((zone) => (
          <button
            key={zone}
            disabled={taken.includes(zone)}
            onClick={() => {
              clockActions.add(zone);
              onDone();
            }}
            className="flex h-8 shrink-0 items-center gap-2 rounded-[8px] px-3 text-start hover:bg-fill-1 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <span className="text-footnote text-label">{cityName(zone)}</span>
            <span className="min-w-0 flex-1 truncate text-caption text-label-3">{regionName(zone)}</span>
            <span className="tabular shrink-0 text-caption text-label-3">{formatUtc(zoneOffset(now, zone))}</span>
          </button>
        ))}
        {query.trim() !== "" && hits.length === 0 && <span className="px-3 pt-2 text-caption text-label-3">{t("Keine Treffer")}</span>}
      </div>
    </div>
  );
}

const PHASE_NAMES: Record<MoonPhaseName, () => string> = {
  new: () => t("Neumond"),
  "waxing-crescent": () => t("Zunehmende Sichel"),
  "first-quarter": () => t("Erstes Viertel"),
  "waxing-gibbous": () => t("Zunehmender Mond"),
  full: () => t("Vollmond"),
  "waning-gibbous": () => t("Abnehmender Mond"),
  "last-quarter": () => t("Letztes Viertel"),
  "waning-crescent": () => t("Abnehmende Sichel"),
};

/** The lit part of the moon: its edge on the sunlit side, closed by the terminator, an ellipse that is the whole disc's width at a quarter. */
function moonPath(fraction: number, waxing: boolean, r: number): string {
  const rx = Math.abs(1 - 2 * fraction) * r;
  const crescent = fraction < 0.5;
  return `M0 ${-r} A${r} ${r} 0 0 ${waxing ? 1 : 0} 0 ${r} A${rx} ${r} 0 0 ${crescent === waxing ? 0 : 1} 0 ${-r}Z`;
}

/** Sunrise, sunset and golden hour at the weather location (no new request: the place is the one Weather already has) and the moon, which looks the same from anywhere. */
function Sky({ now, place }: { now: number; place: { name: string; lat: number; lon: number } | null }) {
  const moon = moonPhase(now);
  const located = place && Number.isFinite(place.lat) && Number.isFinite(place.lon) ? place : null;
  // The times are the place's own, as the Weather tool shows them: its UTC offset from the last forecast read for it. Without
  // one yet they are this PC's, which is the same unless the place is in another time zone.
  const forecast = located ? peekForecast(located.lat, located.lon) : null;
  const shift = forecast?.offset !== undefined ? forecast.offset * 1000 + new Date(now).getTimezoneOffset() * 60_000 : 0;
  const d = new Date(now + shift);
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - shift;
  const to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - shift;
  const clock = (ms: number) => formatTime(ms + shift);
  const sun = useMemo(() => (located ? sunDay(from, to, located.lat, located.lon) : null), [from, to, located?.lat, located?.lon]);
  const range = (r: [number, number] | null) => (r ? t("{from} bis {to}", { from: clock(r[0]), to: clock(r[1]) }) : "");
  const golden = sun ? [sun.goldenMorning, sun.goldenEvening].filter((r) => r !== null) : [];
  return (
    <div className="flex w-[196px] shrink-0 flex-col gap-2.5 overflow-y-auto rounded-[14px] bg-fill-1 p-3">
      {located && sun && (
        <>
          <div className="flex min-w-0 items-center gap-1 text-footnote font-semibold text-label">
            <MapPin size={11} weight="fill" className="shrink-0 text-label-3" />
            <span className="truncate">{located.name}</span>
          </div>
          {sun.polar ? (
            <p className="text-footnote text-label-2">{sun.polar === "day" ? t("Heute geht die Sonne nicht unter") : t("Heute geht die Sonne nicht auf")}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Stat label={t("Sonnenaufgang")} value={sun.sunrise === null ? "" : clock(sun.sunrise)} />
              <Stat label={t("Sonnenuntergang")} value={sun.sunset === null ? "" : clock(sun.sunset)} />
            </div>
          )}
          {golden.length > 0 && (
            <div>
              <div className="text-caption text-label-3">{t("Goldene Stunde")}</div>
              {golden.map((r, i) => (
                <div key={i} className="tabular text-footnote font-semibold text-label">
                  {range(r)}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <div className="flex items-center gap-2.5">
        <svg viewBox="-18 -18 36 36" width={36} height={36} role="img" aria-label={PHASE_NAMES[moon.phase]()} className="shrink-0" style={{ transform: located && located.lat < 0 ? "scaleX(-1)" : undefined }}>
          <circle r={16} fill="var(--color-fill-3)" />
          <path d={moonPath(moon.fraction, moon.waxing, 16)} fill="var(--color-label)" />
        </svg>
        <div className="min-w-0">
          <div className="truncate text-footnote font-semibold text-label">{PHASE_NAMES[moon.phase]()}</div>
          <div className="tabular text-caption text-label-3">{t("{n} % beleuchtet", { n: Math.round(moon.fraction * 100) })}</div>
        </div>
      </div>
      {!located && (
        <>
          <p className="text-caption text-label-3">{t("Lege deinen Ort in den Einstellungen unter Wetter fest, dann kommen Sonnenaufgang, Sonnenuntergang und die Goldene Stunde dazu.")}</p>
          <div>
            <Button onClick={() => navigate("settings", "weather")}>{t("Einstellungen")}</Button>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-caption text-label-3">{label}</div>
      <div className="tabular text-footnote font-semibold text-label">{value || "-"}</div>
    </div>
  );
}
