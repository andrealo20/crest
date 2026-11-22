// The clock's versions past the digital one, Analog and Two time zones, and the bar's Time progress, Date and World time widgets.

import { AnimatePresence, motion } from "motion/react";
import { springs } from "../../../design/motion";
import { locale } from "../../../i18n";
import { CAPTION_FONT, TITLE_FONT, measureTabular, measureText } from "../../../notch/row/measure";
import { clockFormat, useMinuteTick, widest } from "../../../notch/row/parts/Clock";
import { WeatherPart, useWeatherNow, weatherWidth } from "../../../notch/row/parts/WeatherPart";
import { CloudSun } from "../../../ui/iconset";
import { firstWeekday, startOfDay, weekOf } from "../../calendar/model";
import { cityName, formatDiff, formatClock as zoneClock, wallTime } from "../../clocks/zones";
import { clockText } from "../../timer/looks";
import { SegmentDigits, segmentsWidth } from "../../timer/Look";
import type { Forecast } from "../../weather/store";
import { variantOf, type WidgetVariants } from "../model";
import { percentOf, shareOf, type Span } from "../progress";
import { BarAnalog, BarClock, LINE, barClockWidth, zoneDiff } from "./BarClock";
import type { Body, WidgetContext } from "./Widget";

/*
 * Every face is as wide as the widest it can write in the language (a weekday, a month, a time, a zone's difference now), so the bar
 * never moves at midnight or on the first of the month. They tick with the minute, stop while the bar rests, and a preview shows its `at`.
 */

/** Intl's format for these options in the language now. */
const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale(), o);
/** A name standing alone, as the Calendar's month title: the weekdays and months many languages write in lower case. */
const cap = (s: string) => s.charAt(0).toLocaleUpperCase(locale()) + s.slice(1);
const upper = (s: string) => s.toLocaleUpperCase(locale());
const shaped = (f: Intl.DateTimeFormat, shape: (s: string) => string) => ({ format: (d: Date) => shape(f.format(d)) });

/** Sunday 2 to Saturday 8 January 2000, every weekday; the 28th of each month, every month with a two-digit day; 10:08 and 22:08. */
const WEEK = Array.from({ length: 7 }, (_, i) => new Date(2000, 0, 2 + i));
const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 28));
const HOURS = [10, 22].map((h) => new Date(2000, 0, 1, h, 8, 8));
const LONG_DATE: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", year: "numeric" };

/** The time a face shows: the minute's while the bar shows, stopped while it rests, and a preview's fixed `at`, which never ticks. */
function useNow(paused: boolean, at: number | undefined): number {
  const minute = useMinuteTick(!paused && at === undefined);
  return at ?? minute;
}

/** In a preview the sample's weather (null: none), on the bar undefined: the forecast the notch saved. */
const sampleWeather = (ctx: WidgetContext) => (ctx.sample ? ctx.feed.weather : undefined);

/** The weather now beside the time or the week, in a fixed room; a faint cloud while there is none (no place, or a forecast hours old). */
function WeatherSlot({ sample }: { sample: Forecast["current"] | null | undefined }) {
  const live = useWeatherNow(sample === undefined);
  const now = sample === undefined ? live : sample;
  return (
    <span className="flex shrink-0 items-center justify-center" style={{ width: weatherWidth() }}>
      {now ? <WeatherPart now={now} /> : <CloudSun size={15} weight="regular" className="text-label-3" />}
    </span>
  );
}

const LABEL: Record<Span, Intl.DateTimeFormatOptions> = { day: { weekday: "long" }, month: { month: "long" }, year: { year: "numeric" } };
const PROGRESS_GAP = 6;
/** The widest name of the span over the widest percent, never narrower than 72 px, so the bar stays long enough to read. */
const progressWidth = (span: Span) =>
  Math.max(72, widest(shaped(fmt(LABEL[span]), cap), span === "day" ? WEEK : MONTHS, CAPTION_FONT) + PROGRESS_GAP + measureTabular("888%", CAPTION_FONT));

/** The day, the month or the year by name and the percent gone, over a bar filled to it. It moves only with the minute: no motion. */
function BarProgress({ span, paused, at }: { span: Span; paused: boolean; at?: number }) {
  const now = useNow(paused, at), share = shareOf(now, span);
  return (
    <span className="flex flex-col gap-1 text-label" style={{ width: progressWidth(span) }}>
      <span className="flex items-baseline justify-between whitespace-nowrap text-caption leading-none font-medium">
        <span className="tabular text-label-2">{cap(fmt(LABEL[span]).format(now))}</span>
        <span className="tabular">{percentOf(share)}%</span>
      </span>
      <span className="relative block h-1 overflow-hidden rounded-full material:bg-fill-3!" style={{ background: "color-mix(in srgb, currentColor 25%, transparent)" }}>
        <span className="absolute inset-y-0 left-0 block rounded-full bg-current material:bg-primary" style={{ width: `${share * 100}%` }} />
      </span>
    </span>
  );
}

const WEEKDAY: Intl.DateTimeFormatOptions = { weekday: "long" };
const DAY_MONTH_YEAR: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };
const fullDateWidth = () => Math.max(widest(shaped(fmt(WEEKDAY), cap), WEEK), widest(fmt(DAY_MONTH_YEAR), MONTHS));

/** The weekday over the day, the month and the year, in the bar clock's two lines. */
function BarDate({ paused, at }: { paused: boolean; at?: number }) {
  const now = useNow(paused, at);
  return (
    <span className="block" style={{ width: fullDateWidth() }}>
      <span className={LINE}>{cap(fmt(WEEKDAY).format(now))}</span>
      <span className={LINE}>{fmt(DAY_MONTH_YEAR).format(now)}</span>
    </span>
  );
}

const MONTH_SHORT: Intl.DateTimeFormatOptions = { month: "short" };
/** The day as the Calendar's month writes it, in Latin figures, so the sheet and the week read as its grid does. */
const dayNumber = (ms: number) => String(new Date(ms).getDate());
const SHEET_PAD = 8;
const sheetWidth = () => Math.max(widest(shaped(fmt(MONTH_SHORT), upper), MONTHS, CAPTION_FONT), measureTabular("88", TITLE_FONT)) + SHEET_PAD;

/** A calendar sheet: the month in capitals, in the calendar's red (primary under Material), over the day. */
function BarSheet({ paused, at }: { paused: boolean; at?: number }) {
  const now = useNow(paused, at);
  return (
    <span role="img" aria-label={fmt(LONG_DATE).format(now)} className="flex h-7 flex-col items-center justify-center gap-px rounded-[6px] bg-fill-2 material:bg-fill-3" style={{ width: sheetWidth() }}>
      <span className="tabular whitespace-nowrap text-caption leading-none font-medium text-red material:text-primary">{upper(fmt(MONTH_SHORT).format(now))}</span>
      <span className="tabular text-title leading-none font-semibold text-label">{dayNumber(now)}</span>
    </span>
  );
}

const DAY_PAD = 4, WEEK_GAP = 6;
const dayWidth = () => Math.max(widest(fmt({ weekday: "narrow" }), WEEK, CAPTION_FONT), measureTabular("88", CAPTION_FONT)) + DAY_PAD;
const weekWidth = () => 7 * dayWidth() + WEEK_GAP + weatherWidth();

/** This week's seven days from the language's first weekday, today on a tile, and the weather now. Read aloud as today's date. */
function BarWeek({ paused, at, weather }: { paused: boolean; at?: number; weather: Forecast["current"] | null | undefined }) {
  const now = useNow(paused, at), today = startOfDay(now), narrow = fmt({ weekday: "narrow" }), w = dayWidth();
  return (
    <span className="flex items-center" style={{ gap: WEEK_GAP }}>
      <span className="sr-only">{fmt(LONG_DATE).format(now)}</span>
      <span aria-hidden className="flex">
        {weekOf(now, firstWeekday(locale())).map((day) => (
          <span
            key={day}
            className={`flex h-7 flex-col items-center justify-center gap-[3px] rounded-[6px] text-caption leading-none font-medium ${day === today ? "bg-fill-2 material:bg-fill-3 text-label" : "text-label-2"}`}
            style={{ width: w }}
          >
            <span>{narrow.format(day)}</span>
            <span className="tabular">{dayNumber(day)}</span>
          </span>
        ))}
      </span>
      <WeatherSlot sample={weather} />
    </span>
  );
}

const CLOCK_WEATHER_GAP = 8;
const clockWeatherWidth = (h12: boolean) => barClockWidth(false, h12, true) + CLOCK_WEATHER_GAP + weatherWidth();

/** The bar clock's time over its date, beside the weather now. */
function BarClockWeather({ h12, paused, at, weather }: { h12: boolean; paused: boolean; at?: number; weather: Forecast["current"] | null | undefined }) {
  return (
    <span className="flex items-center" style={{ gap: CLOCK_WEATHER_GAP }}>
      <BarClock seconds={false} h12={h12} date paused={paused} at={at} />
      <WeatherSlot sample={weather} />
    </span>
  );
}

/** The widest time in `font`, as clockWidth takes it for the row's. */
const timeWidth = (h12: boolean, font: string) => widest(clockFormat(false, h12, false), HOURS, font);
/** The zone's difference now, measured with a plus as zonesWidth does: Inter's minus before a figure is as wide. */
const diffWidth = (zone: string) => measureTabular(formatDiff(zoneDiff(Date.now(), zone)).replace("-", "+"), CAPTION_FONT);
const WORLD_GAP = 6, CITY_MAX = 72;
/** The time, then the city (cut at 72 px) or the difference, whichever is wider. */
const worldWidth = (h12: boolean, zone: string) =>
  timeWidth(h12, TITLE_FONT) + WORLD_GAP + Math.max(diffWidth(zone), Math.min(CITY_MAX, measureText(cityName(zone), CAPTION_FONT)));

/** Another city: its time large, beside its name over how far ahead of here it is. */
function BarWorld({ h12, zone, paused, at }: { h12: boolean; zone: string; paused: boolean; at?: number }) {
  const now = useNow(paused, at);
  return (
    <span className="flex items-center" style={{ width: worldWidth(h12, zone), gap: WORLD_GAP }}>
      <span className="tabular block shrink-0 whitespace-nowrap text-end text-title leading-none font-semibold text-label" style={{ width: timeWidth(h12, TITLE_FONT) }}>
        {zoneClock(wallTime(now, zone), locale(), h12)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-caption font-medium">
        <span className="truncate text-label-2">{cityName(zone)}</span>
        <span className="tabular whitespace-nowrap text-label-3">{formatDiff(zoneDiff(now, zone))}</span>
      </span>
    </span>
  );
}

const MAX_CITIES = 3, CITY_DIAL = 18, CITY_GAP = 4, CITIES_GAP = 10, CITIES_MAX = 56;
/** A small dial, then the city (cut at 56 px) or its time, whichever is wider. */
const cityWidth = (h12: boolean, zone: string) => CITY_DIAL + CITY_GAP + Math.max(timeWidth(h12, CAPTION_FONT), Math.min(CITIES_MAX, measureText(cityName(zone), CAPTION_FONT)));
const citiesWidth = (h12: boolean, zones: readonly string[]) => zones.reduce((sum, z, i) => sum + (i ? CITIES_GAP : 0) + cityWidth(h12, z), 0);

/** The Clocks tool's first zones, each a small dial beside its city over its time. The dials share this face's tick. */
function BarCities({ h12, zones, paused, at }: { h12: boolean; zones: readonly string[]; paused: boolean; at?: number }) {
  const now = useNow(paused, at);
  return (
    <span className="flex items-center" style={{ gap: CITIES_GAP }}>
      {zones.map((zone) => (
        <span key={zone} className="flex items-center" style={{ width: cityWidth(h12, zone), gap: CITY_GAP }}>
          <BarAnalog h12={h12} paused={paused} at={now} zone={zone} size={CITY_DIAL} />
          {/* The dial already says the city and its time. */}
          <span aria-hidden className="flex min-w-0 flex-1 flex-col text-caption font-medium">
            <span className="truncate text-label-2">{cityName(zone)}</span>
            <span className="tabular whitespace-nowrap text-label">{zoneClock(wallTime(now, zone), locale(), h12)}</span>
          </span>
        </span>
      ))}
    </span>
  );
}

/** The day period ("PM") as the language writes it, after the 12 hour clock's flip cards and segments. */
const period = (ms: number) => fmt({ hour: "numeric", hourCycle: "h12" }).formatToParts(ms).find((p) => p.type === "dayPeriod")?.value ?? "";
const PERIOD_GAP = 4;
const periodRoom = (h12: boolean) => (h12 ? PERIOD_GAP + Math.max(...HOURS.map((d) => measureText(period(d.getTime()), CAPTION_FONT))) : 0);

/** Four 12 px cards, a 6 px colon and 2 px between them. */
const CARD_W = 12, CARD_H = 22, COLON = 6, CARD_GAP = 2, FLIP = 62;
const flipWidth = (h12: boolean) => FLIP + periodRoom(h12);

/** The time on flip cards; a digit that changes turns down over the card's seam. */
function BarFlip({ h12, paused, at }: { h12: boolean; paused: boolean; at?: number }) {
  const now = useNow(paused, at), d = new Date(now), text = clockText(d.getHours(), d.getMinutes(), h12);
  return (
    <span role="img" aria-label={clockFormat(false, h12, false).format(now)} className="flex items-center" style={{ gap: PERIOD_GAP }}>
      <span className="flex items-center justify-end" style={{ width: FLIP, gap: CARD_GAP }}>
        {[...text].map((c, i, all) =>
          c === ":" ? (
            <span key="colon" className="text-center text-title leading-none font-semibold text-label-2" style={{ width: COLON }}>
              :
            </span>
          ) : (
            // Keyed from the right: at 10:00 on a 12 hour clock the new tens card comes in on the left and the others keep their place.
            <span key={all.length - i} className="relative grid place-items-center overflow-clip rounded-[5px] bg-fill-2 material:bg-fill-3" style={{ width: CARD_W, height: CARD_H, perspective: 80 }}>
              {/* Under reduced motion the bar's MotionConfig drops the turn and keeps the fade. */}
              <AnimatePresence initial={false}>
                <motion.span
                  key={c}
                  className="tabular col-start-1 row-start-1 text-title leading-none font-semibold text-label"
                  initial={{ rotateX: -90, opacity: 0 }}
                  animate={{ rotateX: 0, opacity: 1 }}
                  exit={{ rotateX: 90, opacity: 0 }}
                  transition={springs.snappy}
                >
                  {c}
                </motion.span>
              </AnimatePresence>
              <span className="absolute inset-x-0 top-1/2 h-px bg-black/45" />
            </span>
          ),
        )}
      </span>
      {h12 && <span className="whitespace-nowrap text-caption font-medium text-label-2">{period(now)}</span>}
    </span>
  );
}

/** The timer's seven segments, 18 px tall: "88:88" is 51.3 px. */
const SEGMENTS_H = 18, SEGMENTS_W = Math.ceil(segmentsWidth("88:88", SEGMENTS_H));
const segmentWidth = (h12: boolean) => SEGMENTS_W + periodRoom(h12);

/** The time in seven segments with their unlit ghosts, still: nothing blinks on the bar. */
function BarSegment({ h12, paused, at }: { h12: boolean; paused: boolean; at?: number }) {
  const now = useNow(paused, at), d = new Date(now);
  return (
    <span className="flex items-center text-label material:text-primary" style={{ gap: PERIOD_GAP }}>
      <span className="flex justify-end" style={{ width: SEGMENTS_W }}>
        <SegmentDigits text={clockText(d.getHours(), d.getMinutes(), h12)} height={SEGMENTS_H} running={false} ink="currentColor" ghost={0.12} glow={false} />
      </span>
      {h12 && <span className="whitespace-nowrap text-caption font-medium text-label-2">{period(now)}</span>}
    </span>
  );
}

/** The clock in one of its other versions; null draws the digital clock. */
export function clockPart(variant: Exclude<WidgetVariants["clock"], "digital" | "analog" | "zones">, ctx: WidgetContext): Body | null {
  const { h12, paused, at } = ctx;
  switch (variant) {
    case "flip":
      return { node: <BarFlip h12={h12} paused={paused} at={at} />, width: flipWidth(h12) };
    case "segment":
      return { node: <BarSegment h12={h12} paused={paused} at={at} />, width: segmentWidth(h12) };
    case "weather":
      return { node: <BarClockWeather h12={h12} paused={paused} at={at} weather={sampleWeather(ctx)} />, width: clockWeatherWidth(h12) };
  }
}

/** The time progress, the date or the world time; null while it has nothing to show (the world time without a zone in Clocks), and the bar draws its icon. */
export function timePart(id: "progress" | "date" | "world", ctx: WidgetContext): Body | null {
  const { h12, paused, at, zones } = ctx;
  if (id === "progress") {
    const span = variantOf(ctx.variants, "progress");
    return { node: <BarProgress span={span} paused={paused} at={at} />, width: progressWidth(span) };
  }
  if (id === "date") {
    const v = variantOf(ctx.variants, "date");
    if (v === "sheet") return { node: <BarSheet paused={paused} at={at} />, width: sheetWidth() };
    if (v === "week") return { node: <BarWeek paused={paused} at={at} weather={sampleWeather(ctx)} />, width: weekWidth() };
    return { node: <BarDate paused={paused} at={at} />, width: fullDateWidth() };
  }
  const zone = zones[0];
  if (!zone) return null;
  if (variantOf(ctx.variants, "world") === "cities") {
    const list = zones.slice(0, MAX_CITIES);
    return { node: <BarCities h12={h12} zones={list} paused={paused} at={at} />, width: citiesWidth(h12, list) };
  }
  return { node: <BarWorld h12={h12} zone={zone} paused={paused} at={at} />, width: worldWidth(h12, zone) };
}
