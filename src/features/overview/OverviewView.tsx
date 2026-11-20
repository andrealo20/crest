import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CaretDown, Coffee, Eye, EyeSlash, Moon, MusicNoteSimple, SkipForward, Timer } from "@phosphor-icons/react";
import { DiscordLogo } from "../../ui/brands";
import { isMac } from "../../platform/native";
import { content, springs } from "../../design/motion";
import { HeaderActions, HeaderButton } from "../../notch/header";
import { navigate } from "../../notch/nav";
import { MAX_SIZE, requestSize } from "../../notch/size";
import { findTab } from "../../notch/tabs";
import { togglePresentation, usePresenting } from "../privacy/store";
import { media, useNowPlaying } from "../../platform/media";
import { systemControls, type FocusState } from "../../platform/services";
import { MIXER_MAX_ROWS, MIXER_ROW } from "../now-playing/Mixer";
import { discordToolOn, useDiscordCall } from "../discord/store";
import { Equalizer } from "../now-playing/Equalizer";
import { ARTWORK_LAYOUT_ID, PlayPauseIcon } from "../now-playing/NowPlayingView";
import { formatClock, timer, useRemaining } from "../timer/store";
import { Look, clockFace } from "../timer/Look";
import { lookTint } from "../timer/looks";
import { describe, useForecast } from "../weather/store";
import { isStale } from "../weather/stale";
import { useHue } from "../themes/hues";
import { WeatherIcon } from "../weather/WeatherView";
import { settings } from "../../settings/store";
import { formatAgo, formatTemp, formatTimeParts } from "../../lib/format";
import { locale, t } from "../../i18n";
import { QuoteLine } from "../quotes/QuoteLine";
import { SearchLine } from "./SearchLine";
import { Select } from "../../ui/controls";
import { AWAKE_MINUTES, awakeLeft, awakeOn, formatLeft } from "./awake";
import { CONTROLS_ROW, QuickControls, useQuick } from "./QuickControls";
import { BRIGHTNESS_ROW, BrightnessTile, OutputList, VolumeTile, useBrightness, useOutputs } from "./QuickTiles";
import { awake, startAwake, stopAwake } from "./store";

/*
 *   14:32                                    ☀ 18°
 *   Sunday, 5 October                Vienna · Clear
 *   ┌──────────────────────────────────────────────┐
 *   │ ▣ Song · Artist                      ||  >|  │   ← what's playing (click opens the tool; music has play/pause and next)
 *   └──────────────────────────────────────────────┘
 *   [☾ Focus  ]  [☕ Keep awake ⌄]  [🔊 ━━━━━━━  42 %]
 *
 * Like Control Center: an overview plus the two toggles you need all the time.
 */
export function OverviewView() {
  const presenting = usePresenting();
  const { quotes, search } = settings.use().productivity;

  const { outputs, listOpen, device, toggle, pick } = useOutputs();
  const { bright, setBright, busy, hold } = useBrightness();

  // The open list grows the notch by its rows, like the player menu in Now Playing; the brightness row by its height and gap.
  const [quick, reloadQuick] = useQuick();
  // The list gets the rows left under the window's maximum (it scrolls past them).
  const others = (bright !== null ? BRIGHTNESS_ROW : 0) + (quick ? CONTROLS_ROW : 0);
  const rows = listOpen ? Math.max(1, Math.min(MIXER_MAX_ROWS, outputs.length, Math.floor((MAX_SIZE.h - findTab("overview")!.size.h - others - 14) / MIXER_ROW))) : 0;
  const extra = (rows ? rows * MIXER_ROW + 14 : 0) + others;
  useEffect(() => {
    if (!extra) return requestSize("overview", null);
    const base = findTab("overview")!.size;
    requestSize("overview", { w: base.w, h: base.h + extra });
  }, [extra, quotes, search]);
  useEffect(() => () => requestSize("overview", null), []);

  return (
    <div className="flex h-full flex-col gap-2.5 px-4 pt-1 pb-3">
      <HeaderActions>
        <HeaderButton label={presenting ? t("Präsentationsmodus beenden") : t("Präsentationsmodus")} active={presenting} onClick={togglePresentation}>
          {presenting ? <EyeSlash size={14} weight="fill" /> : <Eye size={14} weight="bold" />}
        </HeaderButton>
      </HeaderActions>
      <Header />
      <Activity />
      {/* Focus, keep awake and volume have no backend on a Mac yet. */}
      {!isMac && (
        <div className="flex gap-2">
          <FocusTile />
          <AwakeTile />
          <VolumeTile device={device} open={listOpen} onDevices={toggle} />
        </div>
      )}
      {listOpen && <OutputList outputs={outputs} rows={rows} onPick={pick} />}
      {bright !== null && <BrightnessTile level={bright} busy={busy} hold={hold} onLevel={setBright} />}
      {quick && <QuickControls state={quick} reload={reloadQuick} />}
      {quotes && <QuoteLine />}
      {search !== "off" && <SearchLine engine={search} />}
    </div>
  );
}

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Header() {
  const now = useNow();
  const forecast = useForecast();
  const place = settings.use().weather;
  const weather = forecast && forecast !== "error" ? describe(forecast.current.code, forecast.current.day) : null;
  // A forecast saved hours ago says how old it is, as in the weather tool.
  const old = forecast && forecast !== "error" && forecast.savedAt && isStale(forecast.savedAt, Date.now()) ? formatAgo(Date.now() - forecast.savedAt) : null;
  const { clockLook, clockColor } = settings.use().timer;
  const { time, period } = formatTimeParts(now);
  const date = new Intl.DateTimeFormat(locale(), { weekday: "long", day: "numeric", month: "long" }).format(now);

  return (
    <div className="flex items-end justify-between gap-4">
      <div className={clockLook === "standard" ? undefined : "flex min-w-0 flex-1 flex-col"}>
        {clockLook === "standard" ? (
          <div className="tabular text-[34px] leading-none font-semibold tracking-[-0.03em] text-label" style={{ color: lookTint(clockColor) }}>
            {time}
            {period && <span className="ms-1 text-title font-semibold tracking-normal text-label-3">{period}</span>}
          </div>
        ) : (
          <div className="flex max-w-[340px]">
            <Look look={clockLook} {...clockFace(now)} running mode="focus" tint={lookTint(clockColor)} h={38} />
          </div>
        )}
        <div className="mt-1 text-footnote text-label-3">{date}</div>
      </div>
      <button onClick={() => navigate("weather")} className="pressable flex flex-col items-end text-end" title={t("Wetter öffnen")}>
        <AnimatePresence mode="popLayout" initial={false}>
          {weather && forecast && forecast !== "error" ? (
            <motion.div
              key="w"
              className="flex items-center gap-1.5"
              initial={{ opacity: 0, filter: "blur(4px)" }}
              animate={{ opacity: 1, filter: "blur(0px)", transition: content.enter }}
            >
              <WeatherIcon icon={weather.icon} hue={weather.hue} size={22} className="text-label" />
              <span className="tabular text-[22px] leading-none font-semibold tracking-[-0.02em] text-label">{formatTemp(forecast.current.temp)}</span>
            </motion.div>
          ) : (
            <motion.div key="s" className="h-[22px] w-16 rounded-[6px] bg-fill-1" exit={{ opacity: 0, transition: content.exit }} />
          )}
        </AnimatePresence>
        <div className="mt-1 max-w-[220px] truncate text-footnote text-label-3">
          {place ? `${place.name}${weather ? ` · ${old ?? weather.text}` : ""}` : t("Ort wird erkannt …")}
        </div>
      </button>
    </div>
  );
}

const ROW_CONTROL = "pressable pressable-fill flex size-8 items-center justify-center rounded-full text-label";

/** What's running, in the same priority as the closed notch: timer, call, music. */
function Activity() {
  const np = useNowPlaying();
  // The bar's Discord widget can hold a call with the tool off; then the row keeps the music, as opening the notch does (live.tsx).
  const discordOn = discordToolOn(settings.use());
  const call = useDiscordCall();
  const tm = timer.use();
  const remaining = useRemaining();
  const timerLive = tm.endsAt !== null || tm.finished;

  let item: { key: string; tab: string; icon: ReactNode; title: string; detail: string; trailing?: ReactNode; controls?: ReactNode } | null = null;
  if (timerLive) {
    item = {
      key: "timer",
      tab: "timer",
      icon: <Timer size={18} weight="bold" className={tm.mode === "focus" ? "text-orange" : "text-green"} />,
      title: tm.finished ? t(tm.mode === "focus" ? "Fokus abgelaufen" : "Pause abgelaufen") : t(tm.mode === "focus" ? "Fokus" : "Pause"),
      detail: tm.finished ? t("Zum Schließen öffnen") : t("noch {time}", { time: formatClock(remaining) }),
    };
  } else if (call && discordOn) {
    item = {
      key: "discord",
      tab: "discord",
      icon: <DiscordLogo size={18} weight="fill" className="text-label" />,
      title: call.channelName,
      detail: [call.guildName, t(call.members.length === 1 ? "{n} Person" : "{n} Personen", { n: call.members.length })].filter(Boolean).join(" · "),
      trailing: <Equalizer playing={call.members.some((m) => m.speaking)} tint="bg-green" levels={false} />,
    };
  } else if (np) {
    item = {
      key: "media",
      tab: "media",
      icon: np.artwork ? (
        // Same layoutId as the cover in Now Playing, so a click flies it there.
        <motion.img layoutId={ARTWORK_LAYOUT_ID} transition={springs.morph} src={np.artwork} alt="" draggable={false} className="size-7 rounded-[6px] object-cover" />
      ) : (
        <MusicNoteSimple size={18} weight="fill" className="text-label-2" />
      ),
      title: np.title,
      detail: np.artist,
      // Play/pause and next on the row itself, like the music in Control Center (issue #35); the icon says whether it plays.
      controls: (
        <>
          <button aria-label={np.isPlaying ? t("Pause") : t("Abspielen")} title={np.isPlaying ? t("Pause") : t("Abspielen")} onClick={media.toggle} className={ROW_CONTROL}>
            <PlayPauseIcon playing={np.isPlaying} size={16} />
          </button>
          <button aria-label={t("Nächster Titel")} title={t("Nächster Titel")} onClick={media.next} className={ROW_CONTROL}>
            <SkipForward size={16} weight="fill" />
          </button>
        </>
      ),
    };
  }

  return (
    <div className="relative h-11 overflow-hidden rounded-[12px] bg-fill-1">
      <AnimatePresence mode="popLayout" initial={false}>
        {item ? (
          <motion.div
            key={item.key}
            className="absolute inset-0"
            initial={{ opacity: 0, filter: "blur(4px)" }}
            animate={{ opacity: 1, filter: "blur(0px)", transition: content.enter }}
            exit={{ opacity: 0, filter: "blur(4px)", transition: content.exit }}
          >
            <button
              onClick={() => navigate(item.tab)}
              className={`pressable pressable-wide pressable-fill absolute inset-0 flex items-center gap-2.5 ps-2.5 text-start ${item.controls ? "pe-20" : "pe-2.5"}`}
            >
              <span className="flex size-7 shrink-0 items-center justify-center">{item.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-footnote font-medium text-label">{item.title}</span>
                <span className="block truncate text-caption text-label-3">{item.detail}</span>
              </span>
              {item.trailing && <span className="shrink-0 pe-1">{item.trailing}</span>}
            </button>
            {/* Over the row's end, not inside it (no button in a button), so the row keeps its whole fill. The end follows the
                language; the inner box keeps play before next in any language, like the transport in Now Playing. */}
            {item.controls && (
              <div className="absolute inset-y-0 end-1.5 flex items-center">
                <div dir="ltr" className="flex items-center gap-0.5">
                  {item.controls}
                </div>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="idle"
            className="absolute inset-0 flex items-center justify-center text-footnote text-label-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: content.enter }}
            exit={{ opacity: 0, transition: content.exit }}
          >
            {t("Gerade läuft nichts")}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Windows focus on/off. Light = on (like Control Center). */
function FocusTile() {
  const [focus, setFocus] = useState<FocusState | null>(null);
  useEffect(() => {
    const load = () => void systemControls.focus().then(setFocus).catch(() => setFocus(null));
    load();
    // Also toggled elsewhere (taskbar, Clock app) → follow it.
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, []);
  const active = !!focus?.active;
  const hue = useHue("indigo");
  const label = focus?.kind === "dnd" ? t("Nicht stören") : t("Fokus");

  return (
    <button
      aria-pressed={active}
      disabled={!focus}
      onClick={() => {
        setFocus((f) => f && { ...f, active: !active });
        void systemControls.setFocus(!active).then(setFocus).catch(() => systemControls.focus().then(setFocus));
      }}
      className={`pressable flex h-10 min-w-[150px] shrink-0 items-center gap-2.5 rounded-[12px] px-2.5 transition-colors duration-200 disabled:opacity-40 ${
        active ? "bg-primary text-on-primary" : "bg-fill-1 text-label"
      }`}
    >
      <motion.span
        className={`flex size-6 items-center justify-center rounded-full ${active ? "bg-black/10" : "bg-fill-2"}`}
        animate={{ rotate: active ? 0 : -30 }}
        transition={springs.snappy}
      >
        <Moon size={14} weight="fill" style={!active && hue ? { color: hue } : undefined} />
      </motion.span>
      <span className="min-w-0 text-start">
        <span className="block truncate text-footnote font-semibold">{label}</span>
        <span className={`block text-caption ${active ? "text-black/55" : "text-label-3"}`}>{active ? t("An") : t("Aus")}</span>
      </span>
    </button>
  );
}

/** Keeps the PC and the display awake. A tap is until turned off; the caret picks a duration, shown as the time left. */
function AwakeTile() {
  const a = awake.use();
  const now = useNow().getTime();
  const active = awakeOn(a, now);
  const hue = useHue("amber");
  const left = awakeLeft(a, now);
  const mode = !active ? "off" : a?.minutes == null ? "on" : String(a.minutes);
  const options = [
    ...AWAKE_MINUTES.map((m) => ({ value: String(m), label: m < 60 ? t("{n} Min.", { n: m }) : t("{n} Std.", { n: m / 60 }) })),
    { value: "on", label: t("Bis zum Ausschalten") },
    { value: "off", label: t("Aus") },
  ];

  return (
    <div className={`flex h-10 min-w-[150px] shrink-0 items-center rounded-[12px] transition-colors duration-200 ${active ? "bg-primary text-on-primary" : "bg-fill-1 text-label"}`}>
      <button aria-pressed={active} onClick={() => (active ? stopAwake() : startAwake(null))} className="pressable flex h-full min-w-0 flex-1 items-center gap-2.5 ps-2.5">
        <motion.span
          className={`flex size-6 shrink-0 items-center justify-center rounded-full ${active ? "bg-black/10" : "bg-fill-2"}`}
          animate={{ rotate: active ? 0 : -30 }}
          transition={springs.snappy}
        >
          <Coffee size={14} weight="fill" style={!active && hue ? { color: hue } : undefined} />
        </motion.span>
        <span className="min-w-0 text-start">
          <span className="block truncate text-footnote font-semibold">{t("Wach halten")}</span>
          <span className={`tabular block truncate text-caption ${active ? "text-black/55" : "text-label-3"}`}>
            {!active ? t("Aus") : left === null ? t("An") : t("noch {time}", { time: formatLeft(left) })}
          </span>
        </span>
      </button>
      <Select
        width="shrink-0 pe-1"
        value={mode}
        options={options}
        onChange={(v) => (v === "off" ? stopAwake() : startAwake(v === "on" ? null : Number(v)))}
        trigger={{
          label: t("Dauer wählen"),
          menuWidth: 150,
          className: `pressable flex size-6 items-center justify-center rounded-full ${active ? "text-black/55 hover:text-black" : "text-label-3 hover:text-label"}`,
          content: <CaretDown size={11} weight="bold" />,
        }}
      />
    </div>
  );
}
