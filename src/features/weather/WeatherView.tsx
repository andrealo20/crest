import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CircleNotch, Drop, MagnifyingGlass, MapPin, NavigationArrow, SunHorizon, Umbrella, Wind, type Icon } from "@phosphor-icons/react";
import { useHue, type Hue } from "../themes/hues";
import { content, fade, spin } from "../../design/motion";
import { settings } from "../../settings/store";
import { Skeleton } from "../../ui/controls";
import { formatAgo, formatTemp, formatTime, formatWind } from "../../lib/format";
import { locale, t } from "../../i18n";
import { choosePlace, describe, detectPlace, searchPlaces, useForecast, type Forecast, type Place } from "./store";
import { hourStart } from "./hours";

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
const LRM = String.fromCharCode(0x200e);

export function WeatherView() {
  const place = settings.use().weather;
  const data = useForecast();
  const [searching, setSearching] = useState(false);
  const [detectFailed, setDetectFailed] = useState(false);

  // First start without a location: detect via IP; if that fails, show the search.
  useEffect(() => {
    if (!place) void detectPlace().then((ok) => setDetectFailed(!ok));
  }, [place]);

  return (
    <div className="relative flex h-full flex-col px-4 pt-1 pb-3">
      <AnimatePresence mode="popLayout" initial={false}>
        {searching || (!place && detectFailed) ? (
          <motion.div key="search" className="h-full" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: content.enter }} exit={{ opacity: 0, transition: content.exit }}>
            <PlaceSearch onDone={() => setSearching(false)} canCancel={!!place} />
          </motion.div>
        ) : data === "error" ? (
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
            <Now data={data} name={place.name} detail={place.detail} auto={!!place.auto} onChangePlace={() => setSearching(true)} />
            {/* A size container: Hours (66 px) steps aside below 226 px, what it and the seven days (152 px) need. */}
            <div className="flex min-w-0 flex-1 flex-col gap-2 [container-type:size]">
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

/** Behind the current weather, a sky like it: clear by day, cloud, rain, snow, a storm, or night. Dark enough for the white text on it (4.5:1). */
function sky(code: number, day: boolean): string {
  if (!day) return "linear-gradient(160deg, #1d2450 0%, #2c3a6e 100%)";
  if (code === 0 || code <= 2) return "linear-gradient(160deg, #1c5593 0%, #2a63a0 100%)";
  if (code === 3 || code <= 48) return "linear-gradient(160deg, #3f4f61 0%, #4d5d6f 100%)";
  if (code <= 67 || (code >= 80 && code <= 82)) return "linear-gradient(160deg, #2d4561 0%, #44607e 100%)";
  if (code <= 77 || code === 85 || code === 86) return "linear-gradient(160deg, #3f5877 0%, #4e6a88 100%)";
  return "linear-gradient(160deg, #362c5c 0%, #5a4688 100%)";
}

/** The weather now over its sky: place, icon and temperature, what it is like, then wind, humidity, rain today and the sun. */
function Now({ data, name, detail, auto, onChangePlace }: { data: Forecast; name: string; detail?: string; auto: boolean; onChangePlace: () => void }) {
  const { icon: I, text } = describe(data.current.code, data.current.day);
  const today = data.daily[0];
  const c = data.current;
  return (
    <div className="flex w-[212px] shrink-0 flex-col rounded-[16px] p-3 text-white" style={{ background: sky(c.code, c.day) }}>
      <button onClick={onChangePlace} className="flex min-w-0 items-center gap-1 self-start text-footnote font-semibold hover:opacity-80" title={detail ? `${detail} · ${t("Ort ändern")}` : t("Ort ändern")}>
        {auto ? <NavigationArrow size={11} weight="fill" /> : <MapPin size={11} weight="fill" />}
        <span className="truncate">{name}</span>
      </button>
      <div className="mt-1 flex items-center gap-2">
        <I size={40} weight="fill" />
        <span className="tabular text-[38px] leading-none font-semibold tracking-[-0.03em]">{formatTemp(c.temp)}</span>
      </div>
      <div className="mt-1 truncate text-footnote font-semibold">{text}</div>
      {/* The saved forecast, when Open-Meteo didn't answer: says how old it is. */}
      <div className="truncate text-caption text-white/85">
        {/* A left-to-right mark before a number keeps it from turning around after Arabic text ("°9"). */}
        {data.savedAt ? formatAgo(Date.now() - data.savedAt) : t("gefühlt {n}", { n: `${LRM}${formatTemp(c.feels)}` })}
        {today && ` · ${LRM}${formatTemp(today.min)}…${formatTemp(today.max)}`}
      </div>
      <div className="mt-auto flex gap-1.5">
        <Chip title={t("Wind")}>
          <Wind size={12} weight="bold" />
          {formatWind(c.wind)}
          {/* Where the wind blows to: the arrow points away from where it comes from; the icon itself points north-west. */}
          {c.windDir !== undefined && <NavigationArrow size={10} weight="fill" style={{ transform: `rotate(${c.windDir - 135}deg)` }} />}
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
      {/* Polar night and midnight sun: Open-Meteo gives the same instant for both. */}
      {today?.sunrise && today.sunset && today.sunrise !== today.sunset && (
        <div className="mt-1.5 flex gap-3 text-caption text-white/85">
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
    <span dir="ltr" className="tabular flex min-w-0 items-center gap-1 rounded-[8px] bg-white/15 px-1.5 py-1 text-caption font-semibold whitespace-nowrap" title={title}>
      {children}
    </span>
  );
}

const mm = (v: number) => `${new Intl.NumberFormat(locale(), { maximumFractionDigits: v >= 10 ? 0 : 1 }).format(v)} mm`;

/** The next eight hours, from now: time, icon and temperature. Older saved hours are left out. */
function Hours({ data }: { data: Forecast }) {
  const from = Date.now() - 60 * 60_000;
  const hours = (data.hourly ?? []).filter((h) => hourStart(h.time, data.offset) > from).slice(0, 8);
  if (hours.length === 0) return null;
  return (
    <div className="grid shrink-0 rounded-[14px] bg-fill-1 px-1 py-1.5 [@container(max-height:225px)]:hidden" style={{ gridTemplateColumns: `repeat(${hours.length}, minmax(0, 1fr))` }}>
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

/** The week: day, icon, low, a bar from the low to the high on the week's own scale, high, and the rain. The rows share their columns, so a long "Today" widens the label column for all. */
function Week({ data }: { data: Forecast }) {
  const lo = Math.min(...data.daily.map((d) => d.min)), hi = Math.max(...data.daily.map((d) => d.max));
  const span = Math.max(1, hi - lo);
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[auto_auto_minmax(0,1fr)_auto] content-between gap-x-2 rounded-[14px] bg-fill-1 px-3 py-1.5">
      {data.daily.map((d, i) => {
        const { icon: I, text, hue } = describe(d.code);
        const left = ((d.min - lo) / span) * 100, width = Math.max(4, ((d.max - d.min) / span) * 100);
        return (
          <div key={d.date} className="col-span-4 grid h-5 grid-cols-subgrid items-center" title={text}>
            <span className={`text-caption whitespace-nowrap ${i === 0 ? "font-semibold text-label" : "text-label-2"}`}>
              {i === 0 ? t("Heute") : weekday().format(new Date(`${d.date}T12:00:00`)).replace(".", "")}
            </span>
            <WeatherIcon icon={I} hue={hue} size={14} className="shrink-0 text-label-2" />
            {/* Low, bar and high read from the left in every language, like the other bars. */}
            <span dir="ltr" className="flex min-w-0 items-center gap-2">
              <span className="tabular w-8 shrink-0 text-end text-caption text-label-3">{formatTemp(d.min)}</span>
              <span className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-fill-2">
                <span className="absolute inset-y-0 rounded-full" style={{ left: `${left}%`, width: `${width}%`, background: `linear-gradient(90deg, ${heat(d.min)}, ${heat(d.max)})` }} />
              </span>
              <span className="tabular w-8 shrink-0 text-caption font-semibold text-label">{formatTemp(d.max)}</span>
            </span>
            <span dir="ltr" className="tabular min-w-10 text-end text-caption text-link">{d.mm ? mm(d.mm) : ""}</span>
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
  // What to say when the list is empty: the search found nothing, or could not ask.
  const [note, setNote] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // Debounce the search so not every keystroke sends a request.
  useEffect(() => {
    const q = query.trim();
    setNote(null);
    if (q.length < 2) {
      setResults([]);
      return;
    }
    // A slow answer to an earlier query must not replace the current one.
    let alive = true;
    const id = setTimeout(() => {
      searchPlaces(q)
        .then((r) => alive && (setResults(r), setNote(r.length ? null : t("Nichts gefunden"))))
        .catch(() => alive && (setResults([]), setNote(t("Keine Verbindung"))));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [query]);

  const pick = (p: Place) => {
    choosePlace(p);
    onDone();
  };

  return (
    <div className={`flex flex-col gap-2 ${compact ? "" : "h-full"}`}>
      <div className={`flex h-9 items-center gap-2 rounded-[12px] px-3 ${compact ? "bg-fill-2" : "bg-fill-1"}`}>
        <MagnifyingGlass size={14} weight="bold" className="text-label-3" />
        <input
          ref={field}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Enter that ends an IME composition (Japanese, Chinese) is not a pick.
            if (e.key === "Enter" && results[0] && !e.nativeEvent.isComposing) pick(results[0]);
            else if (e.key === "ArrowDown") list.current?.querySelector("button")?.focus();
            else return;
            e.preventDefault();
          }}
          placeholder={t("Ort suchen, z. B. Berlin")}
          className="min-w-0 flex-1 bg-transparent text-body text-label outline-none placeholder:text-label-4"
        />
        <button
          title={t("Automatisch per IP")}
          aria-label={t("Automatisch per IP")}
          onClick={() => {
            setLocating(true);
            setNote(null);
            void detectPlace(true).then((ok) => {
              setLocating(false);
              if (ok) onDone();
              else setNote(t("Keine Verbindung"));
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
      <div ref={list} className="flex flex-col">
        {results.map((p) => (
          <button
            key={`${p.lat},${p.lon}`}
            onClick={() => pick(p)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
              e.preventDefault();
              // Up from the first result goes back to the field.
              const next = e.key === "ArrowDown" ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling ?? field.current;
              (next as HTMLElement | null)?.focus();
            }}
            className="flex h-8 items-center gap-2 rounded-[8px] px-3 text-start hover:bg-fill-1"
          >
            <MapPin size={12} weight="fill" className="text-label-3" />
            <span className="truncate text-footnote text-label">{p.name}</span>
            <span className="truncate text-caption text-label-3">{p.detail}</span>
          </button>
        ))}
        {note && <span className="px-3 pt-2 text-caption text-label-3">{note}</span>}
        {!compact && query.trim().length < 2 && <span className="px-3 pt-2 text-caption text-label-3">{t("Für welchen Ort soll das Wetter angezeigt werden?")}</span>}
      </div>
    </div>
  );
}
