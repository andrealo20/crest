import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Drop, MapPin, NavigationArrow, SunHorizon, Thermometer, Wind, type Icon } from "../../ui/iconset";
import { card, content } from "../../design/motion";
import { formatAgo, formatTemp, formatTime, formatWind } from "../../lib/format";
import { t } from "../../i18n";
import type { Settings } from "../../settings/store";
import { describe, type Forecast } from "./store";
import { hourStart } from "./hours";
import { windArrow } from "./wind";
import { keepFit, weatherFit } from "./fit";
import { LRM, WeatherIcon, mm, weekday } from "./WeatherView";

// The place as the settings keep it, with the automatic flag that the search results do not carry.
type Place = NonNullable<Settings["weather"]>;

/*
 * The weather under Material, laid out like the weather page of Stellaria's dashboard:
 *
 *   ( ☀ 22°  Cloudy         )  Vienna        ☀ 07:12 ☀ 16:40
 *   (        12°…22°        )  [Humidity] [Feels like] [Wind]
 *   ( Now 16 17 18 19 20 21 22 …                             )   the next hours
 *   [Today] [Thu] [Fri] [Sat] [Sun] [Mon] [Tue]                  seven day tiles
 */
export function MaterialWeather({ data, place, onChangePlace }: { data: Forecast; place: Place; onChangePlace: () => void }) {
  const body = useRef<HTMLDivElement>(null);
  // The Standard size, for the first render only: the layout effect measures before anything is painted.
  const [fit, setFit] = useState(() => weatherFit(608, 232));
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const measure = (w: number, h: number) => setFit((prev) => keepFit(prev, weatherFit(w, h)));
    const rect = el.getBoundingClientRect();
    measure(rect.width, rect.height);
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect.width, entry.contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const from = Date.now() - 60 * 60_000;
  const hours = (data.hourly ?? []).filter((h) => hourStart(h.time, data.offset) > from).slice(0, 12);
  const strip = fit.hours > 0 && hours.length > 0;

  return (
    <div ref={body} className={`grid h-full gap-2 ${strip ? "grid-rows-[minmax(84px,1fr)_auto_minmax(56px,auto)]" : "grid-rows-[minmax(84px,1fr)_minmax(56px,auto)]"}`}>
      <div className="grid min-h-0 grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-2">
        <NowCard data={data} big={fit.big} />
        <SideBlock data={data} place={place} details={fit.details} onChangePlace={onChangePlace} />
      </div>
      {strip && <HourStrip hours={hours} count={fit.hours === 12 ? 12 : 8} />}
      <DayTiles data={data} big={fit.big} />
    </div>
  );
}

/** The weather now, in a pill: icon, temperature, what it is like, and below how old a saved forecast is and today's low and high. */
function NowCard({ data, big }: { data: Forecast; big: boolean }) {
  const c = data.current;
  const today = data.daily[0];
  const { icon, text, hue } = describe(c.code, c.day);
  return (
    <motion.div
      // A pill up to 96 px tall; taller, near the largest size, a card with the same corners instead of a stadium.
      className="flex min-h-0 min-w-0 items-center gap-3 rounded-[48px] bg-fill-1 ps-4 pe-6"
      initial={{ opacity: 0, transform: "scale(0.96)" }}
      animate={{ opacity: 1, transform: "scale(1)" }}
      transition={card}
    >
      <WeatherIcon icon={icon} hue={hue} size={big ? 88 : 64} weight="regular" className="shrink-0 text-primary" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={`${big ? "text-[64px]" : "text-[48px]"} leading-none font-medium tabular text-primary`}>{formatTemp(c.temp)}</span>
        <span className="truncate text-body text-label-2">{text}</span>
        <span className="truncate text-caption text-label-2">
          {/* The saved forecast, when Open-Meteo didn't answer: says how old it is. */}
          {data.savedAt && `${formatAgo(Date.now() - data.savedAt)} · `}
          {/* A left-to-right mark before a number keeps it from turning around after Arabic text ("°9"). */}
          {today && `${LRM}${formatTemp(today.min)}…${formatTemp(today.max)}`}
        </span>
      </div>
    </motion.div>
  );
}

/** The place and the sun on one line, and under them humidity, feels like and wind; below 500 px wide only place and sun. */
function SideBlock({ data, place, details, onChangePlace }: { data: Forecast; place: Place; details: boolean; onChangePlace: () => void }) {
  const c = data.current;
  const today = data.daily[0];
  const button = (
    <button onClick={onChangePlace} className="pressable flex min-w-0 items-center gap-1 text-footnote font-semibold text-label" title={place.detail ? `${place.detail} · ${t("Ort ändern")}` : t("Ort ändern")}>
      {place.auto ? <NavigationArrow size={12} weight="fill" className="shrink-0" /> : <MapPin size={12} weight="fill" className="shrink-0" />}
      <span className="truncate">{place.name}</span>
    </button>
  );
  // Polar night and midnight sun: Open-Meteo gives the same instant for both.
  const sun = today?.sunrise && today.sunset && today.sunrise !== today.sunset && (
    <div className="flex shrink-0 items-center gap-2 text-caption text-label-2">
      <span className="flex items-center gap-1" title={t("Sonnenaufgang")}>
        <SunHorizon size={14} weight="fill" className="text-primary" /> {formatTime(new Date(today.sunrise))}
      </span>
      <span className="flex items-center gap-1" title={t("Sonnenuntergang")}>
        <SunHorizon size={14} weight="regular" className="text-primary" /> {formatTime(new Date(today.sunset))}
      </span>
    </div>
  );
  if (!details)
    return (
      <div className="flex min-h-0 min-w-0 flex-col justify-center gap-2">
        {button}
        {sun}
      </div>
    );
  // At Compatto a tile is 58 px inside and "18 km/h" at 15 px is 63: the unit goes beside the number at the caption's size.
  const [speed, unit] = formatWind(c.wind).split(" ");
  const tiles: { icon: Icon; label: string; value: string; unit?: string; beside?: ReactNode }[] = [
    ...(c.humidity !== undefined ? [{ icon: Drop, label: t("Luftfeuchtigkeit"), value: `${Math.round(c.humidity)} %` }] : []),
    { icon: Thermometer, label: t("Gefühlt"), value: `${LRM}${formatTemp(c.feels)}` },
    {
      icon: Wind,
      label: t("Wind"),
      value: speed,
      unit,
      // Where the wind blows to: the arrow points away from where it comes from. Beside the icon, so a narrow tile never cuts it off.
      beside: c.windDir !== undefined && <NavigationArrow size={10} weight="fill" className="text-primary" style={{ transform: `rotate(${windArrow(c.windDir, "material")}deg)` }} />,
    },
  ];
  return (
    <div className="flex min-h-0 min-w-0 flex-col justify-center gap-2">
      <div className="flex h-5 shrink-0 items-center justify-between gap-2">
        {button}
        {sun}
      </div>
      <div className="grid min-h-0 grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-1.5">
        {tiles.map(({ icon: I, label, value, unit, beside }, i) => (
          <motion.div
            key={label}
            className="flex min-w-0 flex-col justify-center rounded-[16px] bg-fill-1 p-2"
            initial={{ opacity: 0, transform: "translateY(6px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            transition={{ ...content.enter, delay: 0.03 * i }}
          >
            <span className="flex items-center gap-1">
              <I size={16} weight="regular" className="text-primary" />
              {beside}
            </span>
            {/* One line: a wrapped value would push the tile over the hours below. */}
            <span className="truncate text-[15px] leading-5 font-semibold tabular text-label">
              {value}
              {unit && <span className="ms-0.5 text-caption font-medium text-label-2">{unit}</span>}
            </span>
            <span className="truncate text-caption text-label-2">{label}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/** Twelve hours from now; at 8 the last four are hidden, so a resize shows them without a new list. */
function HourStrip({ hours, count }: { hours: NonNullable<Forecast["hourly"]>; count: 8 | 12 }) {
  return (
    <div className="grid h-[52px] rounded-[26px] bg-fill-1 px-2 py-1" style={{ gridTemplateColumns: `repeat(${Math.min(hours.length, count)}, minmax(0, 1fr))` }}>
      {hours.map((h, i) => {
        const { icon, text, hue } = describe(h.code, h.day);
        return (
          <div key={h.time} data-more={i >= 8 || undefined} className={`flex min-w-0 flex-col items-center ${i >= 8 && count === 8 ? "hidden" : ""}`} title={h.rain > 0 ? `${text} · ${h.rain} %` : text}>
            <span className={`truncate text-caption ${i === 0 ? "font-semibold text-label" : "text-label-2"}`}>{i === 0 ? t("Jetzt") : formatTime(new Date(h.time)).replace(/:00(?=\D|$)/, "")}</span>
            <WeatherIcon icon={icon} hue={hue} size={16} weight="regular" className="text-label-2" />
            <span className="tabular text-caption font-semibold text-label">{formatTemp(h.temp)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Seven tiles: the day, its icon with the rain beside it from 0.05 mm, and the low and high. */
function DayTiles({ data, big }: { data: Forecast; big: boolean }) {
  return (
    <div className="grid min-h-0 grid-cols-7 gap-1.5">
      {data.daily.slice(0, 7).map((d, i) => {
        const { icon, text, hue } = describe(d.code);
        return (
          <motion.div
            key={d.date}
            className="flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-[16px] bg-fill-1 px-2 py-1.5"
            title={text}
            initial={{ opacity: 0, transform: "translateY(6px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            transition={{ ...content.enter, delay: 0.03 * i }}
          >
            <span className="max-w-full truncate text-caption font-semibold text-primary">{i === 0 ? t("Heute") : weekday().format(new Date(`${d.date}T12:00:00`)).replace(".", "")}</span>
            <span className="flex items-center gap-0.5">
              <WeatherIcon icon={icon} hue={hue} size={big ? 28 : 20} weight="regular" className="shrink-0 text-label-2" />
              {d.mm !== undefined && d.mm >= 0.05 && <span dir="ltr" className="tabular text-[10px] whitespace-nowrap text-primary">{mm(d.mm)}</span>}
            </span>
            <span dir="ltr" className="text-caption font-medium text-label">{formatTemp(d.min)} / {formatTemp(d.max)}</span>
          </motion.div>
        );
      })}
    </div>
  );
}
