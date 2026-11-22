import { locale, t } from "../../../i18n";
import { formatTemp, formatWind } from "../../../lib/format";
import { CAPTION_FONT, measureTabular, measureText } from "../../../notch/row/measure";
import { clockFormat, clockWidth, useMinuteTick } from "../../../notch/row/parts/Clock";
import { WeatherPart } from "../../../notch/row/parts/WeatherPart";
import { Umbrella } from "../../../ui/iconset";
import { WIDEST } from "../../system/format";
import { useHue } from "../../themes/hues";
import { sunNow } from "../../weather/hours";
import { describe, type Forecast } from "../../weather/store";
import type { BarFeed } from "../barStores";
import type { Body, WidgetContext } from "./Widget";

/*
 * The weather's versions on Crest's bar beside today's temperature (WeatherPart): the icon alone, the icon with the temperature over
 * the conditions, the next three hours, Details (today's low to high, the wind and the chance of rain), Next days (now and the next
 * three days by name) and Sunrise and sunset (the sun on its arc over the horizon). Each draws in the closed row's 30 px cell at a
 * fixed width for its input; none animates, and only the sun's moves, with the minute.
 */

export const WEATHER_ICON = 15;
const GAP = 6, HOUR_ICON = 12;
/** The widest temperature, every digit an 8, as the page draws .tabular figures (in Material its own tnum widths). */
const widestTemp = (font?: string) => measureTabular(WIDEST.temp.replace(/[0-9]/g, "8"), font);

/** The condition's icon alone, in its colour while coloured icons are on. */
export function WeatherIcon({ now }: { now: Forecast["current"] }) {
  const { icon: I, text, hue } = describe(now.code, now.day);
  const color = useHue(hue);
  return (
    <span className="flex text-label" title={text}>
      <I size={WEATHER_ICON} weight="fill" className="shrink-0" style={color ? { color } : undefined} />
    </span>
  );
}

export const conditionWidth = (now: Forecast["current"]) => WEATHER_ICON + GAP + Math.max(widestTemp(), measureText(describe(now.code, now.day).text, CAPTION_FONT));

/** The icon, then the temperature over the conditions' words. */
export function WeatherCondition({ now }: { now: Forecast["current"] }) {
  const { icon: I, text, hue } = describe(now.code, now.day);
  const color = useHue(hue);
  return (
    <span className="flex items-center whitespace-nowrap text-label" style={{ gap: GAP, width: conditionWidth(now) }}>
      <I size={WEATHER_ICON} weight="fill" className="shrink-0" style={color ? { color } : undefined} />
      <span className="flex min-w-0 flex-col leading-[13px]">
        <span className="tabular text-footnote font-medium">{formatTemp(now.temp)}</span>
        <span className="text-caption font-medium text-label-2">{text}</span>
      </span>
    </span>
  );
}

const hourColumn = () => Math.max(HOUR_ICON, widestTemp(CAPTION_FONT));
export const hoursWidth = () => 3 * hourColumn() + 2 * GAP;

/** One hour: its icon over its temperature, in the hour's own colour while coloured icons are on. */
function Hour({ hour }: { hour: BarFeed["weatherHours"][number] }) {
  const { icon: I, text, hue } = describe(hour.code, hour.day);
  const color = useHue(hue);
  return (
    <span className="flex flex-col items-center gap-px" style={{ width: hourColumn() }} title={text}>
      {/* The place's clock time, for a screen reader: the face has no room to show it. */}
      <span className="sr-only">{hour.time.slice(11, 16)}</span>
      <I size={HOUR_ICON} weight="fill" className="shrink-0" style={color ? { color } : undefined} />
      <span className="tabular text-caption font-medium leading-none">{formatTemp(hour.temp)}</span>
    </span>
  );
}

/** The next three hours side by side. */
export function WeatherHours({ hours }: { hours: BarFeed["weatherHours"] }) {
  return (
    <span className="flex items-center whitespace-nowrap text-label" style={{ gap: GAP, width: hoursWidth() }}>
      {hours.slice(0, 3).map((h) => <Hour key={h.time} hour={h} />)}
    </span>
  );
}

type Day = Forecast["daily"][number];
const eights = (s: string) => s.replace(/[0-9]/g, "8");

/** Room for the temperature beside today's widest range, or for the widest wind beside the umbrella and 100 %, whichever is wider. */
export const detailsWidth = () =>
  WEATHER_ICON + GAP + Math.max(
    widestTemp() + GAP + measureTabular(`${eights(WIDEST.temp)}…${eights(WIDEST.temp)}`, CAPTION_FONT),
    measureTabular(eights(formatWind(888)), CAPTION_FONT) + GAP + 10 + 2 + measureTabular(WIDEST.percent, CAPTION_FONT),
  );

/** The icon, then the temperature beside today's low to high, over the wind and the chance of rain. */
export function WeatherDetails({ now, today }: { now: Forecast["current"]; today: Day }) {
  const { icon: I, text, hue } = describe(now.code, now.day);
  const color = useHue(hue);
  return (
    <span className="flex items-center whitespace-nowrap text-label" style={{ gap: GAP, width: detailsWidth() }} title={text}>
      <I size={WEATHER_ICON} weight="fill" className="shrink-0" style={color ? { color } : undefined} />
      <span className="flex min-w-0 flex-col leading-[13px]">
        <span className="flex items-baseline" style={{ gap: GAP }}>
          <span className="tabular text-footnote font-medium">{formatTemp(now.temp)}</span>
          {/* Low to high reads left to right in every language, as a range on a scale. */}
          <span dir="ltr" className="tabular text-caption font-medium text-label-2">{`${formatTemp(today.min)}…${formatTemp(today.max)}`}</span>
        </span>
        <span className="flex items-center text-caption font-medium text-label-2">
          {/* The spaces keep the words apart when a screen reader joins the spans. */}
          <span className="sr-only">{` ${t("Wind")} `}</span>
          <span className="tabular">{formatWind(now.wind)}</span>
          <Umbrella size={10} weight="fill" className="ms-1.5 me-0.5 shrink-0" />
          <span className="sr-only">{` ${t("Regen")} `}</span>
          <span className="tabular">{Math.round(today.rain)}%</span>
        </span>
      </span>
    </span>
  );
}

const weekday = () => new Intl.DateTimeFormat(locale(), { weekday: "short" });
/** An icon beside the widest temperature. */
const iconLine = () => HOUR_ICON + 2 + widestTemp(CAPTION_FONT);
/** A day's column: its icon line, or the language's widest short weekday (2000-01-02 was a Sunday), so the face keeps its width whichever days it shows. */
const dayColumn = () => {
  const f = weekday();
  return Math.max(iconLine(), ...Array.from({ length: 7 }, (_, i) => measureText(f.format(new Date(2000, 0, 2 + i, 12)), CAPTION_FONT)));
};
export const daysWidth = () => iconLine() + 3 * dayColumn() + 4 * GAP + 1;

/** Now or a day: its icon beside its temperature, in its own colour while coloured icons are on; a day's name shown above, now's for a screen reader only. */
function DayColumn({ code, day, temp, label, named, width }: { code: number; day: boolean; temp: number; label: string; named: boolean; width: number }) {
  const { icon: I, text, hue } = describe(code, day);
  const color = useHue(hue);
  return (
    <span className="flex flex-col items-center gap-px" style={{ width }} title={text}>
      <span className={named ? "text-caption font-medium leading-none text-label-2" : "sr-only"}>{label}</span>
      <span className="flex items-center gap-0.5">
        <I size={HOUR_ICON} weight="fill" className="shrink-0" style={color ? { color } : undefined} />
        <span className="tabular text-caption font-medium leading-none">{formatTemp(temp)}</span>
      </span>
    </span>
  );
}

/** Now, set apart by a line, then the next three days by name, each with its high. */
export function WeatherDays({ now, days }: { now: Forecast["current"]; days: Day[] }) {
  const f = weekday(), column = dayColumn();
  return (
    // At the bottom: now's icon line stands on the days' icon lines, under no name.
    <span className="flex items-end whitespace-nowrap text-label" style={{ gap: GAP, width: daysWidth() }}>
      <DayColumn code={now.code} day={now.day} temp={now.temp} label={t("Jetzt")} named={false} width={iconLine()} />
      <span aria-hidden className="h-4 w-px shrink-0 self-center bg-current opacity-25" />
      {/* Noon, so a change of summer time on that day never moves it to the day before. */}
      {days.map((d) => <DayColumn key={d.date} code={d.code} day temp={d.max} label={f.format(new Date(`${d.date}T12:00:00`))} named width={column} />)}
    </span>
  );
}

const SUN = 28;
/** Half a circle from sunrise on the left to sunset on the right, standing on the horizon at y 13.5. */
const ARC = "M3 13.5 A11 11 0 0 1 25 13.5";
const LINE = "tabular block whitespace-nowrap text-footnote leading-tight font-medium";
export const sunWidth = (h12: boolean) => SUN + GAP + clockWidth(false, h12, false);

/**
 * The sun on its arc between sunrise and sunset, the part of the arc it has crossed drawn behind it, beside the sunrise over the
 * sunset, the next of the two brighter; at night the arc alone. The times are the place's own clock, as the Weather tool shows them. Ticks with the minute;
 * `at` shows that time and never ticks.
 */
export function WeatherSun({ days, now, h12, paused, at }: { days: NonNullable<BarFeed["weatherDays"]>; now: Forecast["current"]; h12: boolean; paused: boolean; at?: number }) {
  const minute = useMinuteTick(!paused && at === undefined);
  const color = useHue("amber");
  const sun = sunNow(days.daily, days.offset, at ?? minute);
  // The sun gone (polar night) or up all day (midnight sun) since the widget last drew: the temperature until it draws again.
  if (!sun) return <WeatherPart now={now} />;
  const { share } = sun, up = share !== null, a = Math.PI * (1 - (share ?? 0)), f = clockFormat(false, h12, false);
  return (
    <span className="flex items-center whitespace-nowrap text-label" style={{ gap: GAP, width: sunWidth(h12) }}>
      <svg width={SUN} height="16" viewBox="0 0 28 16" aria-hidden className="shrink-0">
        {/* One path for the horizon and the arc, so where they meet the track is no darker. */}
        <path d={`M0.5 13.5 H27.5 ${ARC}`} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth="1.5" strokeLinecap="round" className="material:stroke-fill-3 material:[stroke-opacity:1]" />
        {up && (
          <>
            <path d={ARC} fill="none" stroke={color ?? "var(--color-label)"} strokeWidth="1.5" strokeLinecap="round" pathLength={100} strokeDasharray={`${share * 100} 100`} className={color ? undefined : "material:stroke-primary"} />
            <circle r="2.5" cx={Math.round((14 + 11 * Math.cos(a)) * 10) / 10} cy={Math.round((13.5 - 11 * Math.sin(a)) * 10) / 10} fill={color ?? "var(--color-label)"} className={color ? undefined : "material:fill-primary"} />
          </>
        )}
      </svg>
      <span style={{ width: clockWidth(false, h12, false) }}>
        <span className={`${LINE} ${up ? "text-label-3" : "text-label"}`}>
          <span className="sr-only">{`${t("Sonnenaufgang")} `}</span>
          {f.format(new Date(sun.rise))}
        </span>
        <span className={`${LINE} ${up ? "text-label" : "text-label-3"}`}>
          <span className="sr-only">{` ${t("Sonnenuntergang")} `}</span>
          {f.format(new Date(sun.set))}
        </span>
      </span>
    </span>
  );
}

/** The weather as Details, Next days or Sunrise and sunset; null draws the temperature. */
export function weatherPart(variant: "details" | "forecast" | "sun", ctx: WidgetContext): Body | null {
  const d = ctx.feed.weatherDays, now = ctx.feed.weather;
  if (!d || !now) return null;
  if (variant === "details") return d.daily.length ? { node: <WeatherDetails now={now} today={d.daily[0]} />, width: detailsWidth() } : null;
  if (variant === "forecast") return d.daily.length >= 4 ? { node: <WeatherDays now={now} days={d.daily.slice(1, 4)} />, width: daysWidth() } : null;
  return sunNow(d.daily, d.offset, ctx.at ?? Date.now()) ? { node: <WeatherSun days={d} now={now} h12={ctx.h12} paused={ctx.paused} at={ctx.at} />, width: sunWidth(ctx.h12) } : null;
}
