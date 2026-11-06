import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CircleNotch, Drop, MagnifyingGlass, MapPin, NavigationArrow, SunHorizon, Umbrella, Wind, type Icon } from "@phosphor-icons/react";
import { useHue, type Hue } from "../themes/hues";
import { content, fade, spin } from "../../design/motion";
import { settings } from "../../settings/store";
import { Skeleton } from "../../ui/controls";
import { formatAgo, formatTemp, formatTime, formatWind } from "../../lib/format";
import { locale, t } from "../../i18n";
import { choosePlace, describe, detectPlace, loadForecast, searchPlaces, type Forecast, type Place } from "./store";

/*
 * Weather via Open-Meteo (data and location detection: ./store.ts).
 *
 *   ┌ Vienna ──────┐  Now 16:00 17:00 …   (the next hours)
 *   │ ☀ 22°        │  Today ☀ 12° ━━━━━━  22°
 *   │ Cloudy       │  Thu   🌧  9° ━━━━    17°  3 mm
 *   │ wind · hum … │  …                          (the week)
 *   └──────────────┘
 */
const weekday = () => new Intl.DateTimeFormat(locale(), { weekday: "short" });

export function WeatherView() {
  const place = settings.use().weather;
  const [data, setData] = useState<Forecast | null>(null);
  const [error, setError] = useState(false);
  const [searching, setSearching] = useState(false);
  const [detectFailed, setDetectFailed] = useState(false);

  // First start without a location: detect via IP; if that fails, show the search.
  useEffect(() => {
    if (!place) void detectPlace().then((ok) => setDetectFailed(!ok));
  }, [place]);

  useEffect(() => {
    if (!place) return;
    let alive = true;
    setError(false);
    loadForecast(place.lat, place.lon)
      .then((d) => alive && setData(d))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [place]);

  return (
    <div className="relative flex h-full flex-col px-4 pt-1 pb-3">
      <AnimatePresence mode="popLayout" initial={false}>
        {searching || (!place && detectFailed) ? (
          <motion.div key="search" className="h-full" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: content.enter }} exit={{ opacity: 0, transition: content.exit }}>
            <PlaceSearch onDone={() => setSearching(false)} canCancel={!!place} />
          </motion.div>
        ) : error ? (
          <motion.div key="error" className="flex h-full items-center justify-center text-body text-label-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={fade}>
            {t("Wetter gerade nicht erreichbar")}
          </motion.div>
        ) : !data || !place ? (
          <motion.div key="loading" className="flex flex-col gap-3" exit={{ opacity: 0, transition: content.exit }}>
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-20 w-full" />
          </motion.div>
        ) : (
          <motion.div key="data" className="flex h-full gap-2" initial={{ opacity: 0, filter: "blur(4px)" }} animate={{ opacity: 1, filter: "blur(0px)", transition: content.enter }}>
            <Now data={data} name={place.name} auto={!!place.auto} onChangePlace={() => setSearching(true)} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Hours data={data} />
              <Week data={data} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A weather glyph, in its own colour while coloured icons are on (sun amber, rain blue …), else in `className`'s. */
export function WeatherIcon({ icon: I, hue, size, className }: { icon: Icon; hue: Hue; size: number; className: string }) {
  const color = useHue(hue);
  return <I size={size} weight="fill" className={color ? undefined : className} style={color ? { color } : undefined} />;
}

/** Behind the current weather, a sky like it: clear by day, cloud, rain, snow, a storm, or night. */
function sky(code: number, day: boolean): string {
  if (!day) return "linear-gradient(160deg, #1d2450 0%, #2c3a6e 100%)";
  if (code === 0 || code <= 2) return "linear-gradient(160deg, #2f6fb5 0%, #5b9bd8 100%)";
  if (code === 3 || code <= 48) return "linear-gradient(160deg, #4a5869 0%, #6f7f92 100%)";
  if (code <= 67 || (code >= 80 && code <= 82)) return "linear-gradient(160deg, #2d4561 0%, #4a6a8c 100%)";
  if (code <= 77 || code === 85 || code === 86) return "linear-gradient(160deg, #5f7a99 0%, #93abc4 100%)";
  return "linear-gradient(160deg, #362c5c 0%, #5a4688 100%)";
}

/** The weather now over its sky: place, icon and temperature, what it is like, then wind, humidity, rain today and the sun. */
function Now({ data, name, auto, onChangePlace }: { data: Forecast; name: string; auto: boolean; onChangePlace: () => void }) {
  const { icon: I, text } = describe(data.current.code, data.current.day);
  const today = data.daily[0];
  const c = data.current;
  return (
    <div className="flex w-[212px] shrink-0 flex-col rounded-[16px] p-3 text-white" style={{ background: sky(c.code, c.day) }}>
      <button onClick={onChangePlace} className="flex min-w-0 items-center gap-1 self-start text-footnote font-semibold hover:opacity-80" title={t("Ort ändern")}>
        {auto ? <NavigationArrow size={11} weight="fill" /> : <MapPin size={11} weight="fill" />}
        <span className="truncate">{name}</span>
      </button>
      <div className="mt-1 flex items-center gap-2">
        <I size={40} weight="fill" />
        <span className="tabular text-[38px] leading-none font-semibold tracking-[-0.03em]">{formatTemp(c.temp)}</span>
      </div>
      <div className="mt-1 truncate text-footnote font-semibold">{text}</div>
      {/* The saved forecast, when Open-Meteo didn't answer: says how old it is. */}
      <div className="truncate text-caption text-white/75">
        {data.savedAt ? formatAgo(Date.now() - data.savedAt) : t("gefühlt {n}", { n: formatTemp(c.feels) })}
        {today && ` · ${formatTemp(today.min)}…${formatTemp(today.max)}`}
      </div>
      <div className="mt-auto flex gap-1.5">
        <Chip title={t("Wind")}>
          <Wind size={12} weight="bold" />
          {formatWind(c.wind)}
          {/* Where the wind blows to: the arrow points away from where it comes from. */}
          {c.windDir !== undefined && <NavigationArrow size={10} weight="fill" style={{ transform: `rotate(${c.windDir + 180 - 45}deg)` }} />}
        </Chip>
        {c.humidity !== undefined && (
          <Chip title={t("Luftfeuchtigkeit")}>
            <Drop size={12} weight="fill" />
            {Math.round(c.humidity)} %
          </Chip>
        )}
        {today?.mm !== undefined && (
          <Chip title={t("Niederschlag")}>
            <Umbrella size={12} weight="fill" />
            {mm(today.mm)}
          </Chip>
        )}
      </div>
      {today?.sunrise && today.sunset && (
        <div className="mt-1.5 flex gap-3 text-caption text-white/80">
          <span className="flex items-center gap-1" title={t("Sonnenaufgang")}>
            <SunHorizon size={12} weight="fill" /> {formatTime(new Date(today.sunrise))}
          </span>
          <span className="flex items-center gap-1" title={t("Sonnenuntergang")}>
            <SunHorizon size={12} weight="regular" /> {formatTime(new Date(today.sunset))}
          </span>
        </div>
      )}
    </div>
  );
}

function Chip({ title, children }: { title: string; children: ReactNode }) {
  return (
    <span className="tabular flex min-w-0 items-center gap-1 rounded-[8px] bg-white/15 px-1.5 py-1 text-caption font-semibold whitespace-nowrap" title={title}>
      {children}
    </span>
  );
}

const mm = (v: number) => `${(v >= 10 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString(locale())} mm`;

/** The next eight hours, from now: time, icon and temperature. Older saved hours are left out. */
function Hours({ data }: { data: Forecast }) {
  const from = Date.now() - 60 * 60_000;
  const hours = (data.hourly ?? []).filter((h) => new Date(h.time).getTime() > from).slice(0, 8);
  if (hours.length === 0) return null;
  return (
    <div className="grid shrink-0 rounded-[14px] bg-fill-1 px-1 py-1.5" style={{ gridTemplateColumns: `repeat(${hours.length}, minmax(0, 1fr))` }}>
      {hours.map((h, i) => {
        const { icon: I, text, hue } = describe(h.code, h.day);
        return (
          <div key={h.time} className="flex flex-col items-center gap-1" title={h.rain > 0 ? `${text} · ${h.rain} %` : text}>
            <span className="text-caption text-label-3">{i === 0 ? t("Jetzt") : formatTime(new Date(h.time)).replace(/:00(?=\D|$)/, "")}</span>
            <WeatherIcon icon={I} hue={hue} size={18} className="text-label-2" />
            <span className="tabular text-caption font-semibold text-label">{formatTemp(h.temp)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** A temperature as a colour: blue in the cold, teal, yellow, orange in the heat. */
function heat(celsius: number): string {
  const hue = Math.max(15, Math.min(215, 215 - (celsius + 5) * 5.5));
  return `hsl(${hue} 85% 62%)`;
}

/** The week: day, icon, low, a bar from the low to the high on the week's own scale, high, and the rain. */
function Week({ data }: { data: Forecast }) {
  const lo = Math.min(...data.daily.map((d) => d.min)), hi = Math.max(...data.daily.map((d) => d.max));
  const span = Math.max(1, hi - lo);
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-between rounded-[14px] bg-fill-1 px-3 py-1.5">
      {data.daily.map((d, i) => {
        const { icon: I, text, hue } = describe(d.code);
        const left = ((d.min - lo) / span) * 100, width = Math.max(4, ((d.max - d.min) / span) * 100);
        return (
          <div key={d.date} className="flex h-5 items-center gap-2" title={text}>
            <span className={`w-11 shrink-0 truncate text-caption ${i === 0 ? "font-semibold text-label" : "text-label-2"}`}>
              {i === 0 ? t("Heute") : weekday().format(new Date(`${d.date}T12:00:00`)).replace(".", "")}
            </span>
            <WeatherIcon icon={I} hue={hue} size={14} className="shrink-0 text-label-2" />
            <span className="tabular w-8 shrink-0 text-end text-caption text-label-3">{formatTemp(d.min)}</span>
            {/* Filled from the left in every language, like the other bars. */}
            <span dir="ltr" className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-fill-2">
              <span className="absolute inset-y-0 rounded-full" style={{ left: `${left}%`, width: `${width}%`, background: `linear-gradient(90deg, ${heat(d.min)}, ${heat(d.max)})` }} />
            </span>
            <span className="tabular w-8 shrink-0 text-caption font-semibold text-label">{formatTemp(d.max)}</span>
            <span className="tabular w-12 shrink-0 text-end text-caption text-link">{d.mm ? mm(d.mm) : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Location search; also used in the settings (`compact`). Arrow = back to automatic via IP. */
export function PlaceSearch({ onDone, canCancel, compact = false }: { onDone: () => void; canCancel: boolean; compact?: boolean }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [locating, setLocating] = useState(false);

  // Debounce the search so not every keystroke sends a request.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const id = setTimeout(() => {
      searchPlaces(q)
        .then(setResults)
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(id);
  }, [query]);

  return (
    <div className={`flex flex-col gap-2 ${compact ? "" : "h-full"}`}>
      <div className={`flex h-9 items-center gap-2 rounded-[12px] px-3 ${compact ? "bg-fill-2" : "bg-fill-1"}`}>
        <MagnifyingGlass size={14} weight="bold" className="text-label-3" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Ort suchen, z. B. Berlin")}
          className="min-w-0 flex-1 bg-transparent text-body text-label outline-none placeholder:text-label-4"
        />
        <button
          title={t("Automatisch per IP")}
          aria-label={t("Automatisch per IP")}
          onClick={() => {
            setLocating(true);
            void detectPlace(true).then((ok) => {
              setLocating(false);
              if (ok) onDone();
            });
          }}
          className="pressable flex size-6 items-center justify-center text-label-3 hover:text-label"
        >
          {locating ? (
            <motion.span className="flex" animate={{ rotate: 360 }} transition={spin}>
              <CircleNotch size={13} weight="bold" />
            </motion.span>
          ) : (
            <NavigationArrow size={13} weight="fill" />
          )}
        </button>
        {canCancel && (
          <button onClick={onDone} className="text-caption text-label-3 hover:text-label-2">
            {t("Abbrechen")}
          </button>
        )}
      </div>
      <div className="flex flex-col">
        {results.map((p) => (
          <button
            key={`${p.lat},${p.lon}`}
            onClick={() => {
              choosePlace(p);
              onDone();
            }}
            className="flex h-8 items-center gap-2 rounded-[8px] px-3 text-start hover:bg-fill-1"
          >
            <MapPin size={12} weight="fill" className="text-label-3" />
            <span className="text-footnote text-label">{p.name}</span>
            <span className="truncate text-caption text-label-3">{p.detail}</span>
          </button>
        ))}
        {!compact && query.trim().length < 2 && <span className="px-3 pt-2 text-caption text-label-3">{t("Für welchen Ort soll das Wetter angezeigt werden?")}</span>}
      </div>
    </div>
  );
}
