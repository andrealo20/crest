import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { fade } from "../../design/motion";
import { locale, t } from "../../i18n";
import { formatTime } from "../../lib/format";
import { useMinuteTick } from "../../notch/row/parts/Clock";
import { HourBars } from "../../notch/row/parts/ScreenTimePart";
import { screenTime, type ScreenDay } from "../../platform/services";
import { settings } from "../../settings/store";
import { Button, Empty } from "../../ui/controls";
import { CaretLeft, CaretRight, Hourglass, Moon, Sun } from "../../ui/iconset";
import { addDays } from "../calendar/model";
import { calendar, useCalendarViewer } from "../calendar/store";
import { AppIcon } from "../system/AppIcon";
import { lookTint } from "../timer/looks";
import { roundSpans, roundsOf, runningSpan } from "../timer/rounds";
import { focusLog, timer } from "../timer/store";
import { DayStrip } from "./DayStrip";
import { dayEvents, sunSpans, ticks, xOf } from "./day";
import { appTotal, average, dateKey, dayStart, dayTotal, daysBack, hourTotals, longDuration, ranked, shortDuration } from "./model";
import { setScreenTime } from "./store";

/*
 * The Screen Time tool, in the notch and in the bar's panel alike (it reads only commands and saved stores every window reaches): the
 * chosen day's strip on top, then its time per hour and per app. Back to 29 days ago, as many as are kept.
 */

/** How far back the arrows go: today and the 29 days before, as Rust keeps them. */
const KEPT = 29;
/** The strip's width: the page's 600 less its 16 px margins. */
const WIDE = 568;
/** The apps listed before Other apps. */
const LISTED = 5;

/** The chosen day and the six before it, read as the page opens, when the day changes and each minute while it shows today. */
function useDays(key: string, live: boolean, on: boolean): ScreenDay[] | null {
  const [days, setDays] = useState<{ key: string; list: ScreenDay[] } | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () =>
      void screenTime.days(daysBack(key, 6), key).then(
        (list) => alive && setDays({ key, list }),
        () => alive && setDays({ key, list: [] }),
      );
    read();
    const id = live ? window.setInterval(read, 60_000) : undefined;
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [key, live, on]);
  return days?.key === key ? days.list : null;
}

const arrow = "pressable flex size-7 items-center justify-center rounded-full text-label-2 hover:bg-fill-1 disabled:opacity-30";

export function ScreenTimeView() {
  useCalendarViewer();
  const s = settings.use();
  const now = useMinuteTick(true);
  const [back, setBack] = useState(0);
  const key = daysBack(dateKey(now), back), live = back === 0;
  const days = useDays(key, live, s.screenTime.on);
  const title =
    back === 0 ? t("Heute") : back === 1 ? t("Gestern") : new Intl.DateTimeFormat(locale(), { weekday: "long", day: "numeric", month: "long" }).format(dayStart(key));
  return (
    <div className="flex h-full flex-col px-4 pt-1 pb-3">
      <div className="flex h-7 shrink-0 items-center justify-between">
        <span className="text-body font-semibold text-label">{title}</span>
        <span className="flex gap-1">
          <button className={arrow} aria-label={t("Vorheriger Tag")} disabled={back >= KEPT} onClick={() => setBack((b) => Math.min(KEPT, b + 1))}>
            <CaretLeft size={14} weight="bold" className="rtl:-scale-x-100" />
          </button>
          <button className={arrow} aria-label={t("Nächster Tag")} disabled={back <= 0} onClick={() => setBack((b) => Math.max(0, b - 1))}>
            <CaretRight size={14} weight="bold" className="rtl:-scale-x-100" />
          </button>
        </span>
      </div>
      {/* Another day fades over the last, by opacity only; nothing grows. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={key} className="flex min-h-0 flex-1 flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: fade }} exit={{ opacity: 0, transition: fade }}>
          <Day dayKey={key} now={live ? now : null} recording={s.screenTime.on} day={days?.find((d) => d.date === key) ?? null} />
          <Screen on={s.screenTime.on} days={days} dayKey={key} hour={live ? new Date(now).getHours() : -1} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** The day's strip, with sunrise and sunset over it when there is a place, the hours under it, and the rounds and events counted. */
function Day({ dayKey, now, recording, day }: { dayKey: string; now: number | null; recording: boolean; day: ScreenDay | null }) {
  const s = settings.use();
  const { data } = calendar.use();
  const log = focusLog.use();
  const running = runningSpan(timer.use(), now ?? 0);
  const from = dayStart(dayKey), to = addDays(from, 1);
  const rounds = roundSpans(roundsOf(log), from, to), events = dayEvents(data, from, to), sun = sunSpans(from, to, s.weather);
  const h12 = s.units.clock === "12";
  const at = (ms: number) => ({ left: xOf(ms, from, to, WIDE) });
  const hourText = (h: number) => (h12 ? new Intl.DateTimeFormat(locale(), { hour: "numeric", hour12: true }).format(new Date(from).setHours(h, 0, 0, 0)) : String(h));
  return (
    // Left to right in every language, as the bar's strip.
    <div dir="ltr" className="mt-2 shrink-0" style={{ width: WIDE }}>
      <div className="relative h-4 text-caption text-label-3">
        {sun[0] && (
          <>
            <span className="absolute flex -translate-x-1/2 items-center gap-1 whitespace-nowrap" style={at(sun[0][0])}>
              <Sun size={10} weight="fill" className="text-(--hue-amber)" />
              {formatTime(sun[0][0])}
            </span>
            <span className="absolute flex -translate-x-1/2 items-center gap-1 whitespace-nowrap" style={at(sun[0][1])}>
              <Moon size={10} weight="fill" />
              {formatTime(sun[0][1])}
            </span>
          </>
        )}
      </div>
      <div className="text-label">
        <DayStrip
          width={WIDE}
          height={32}
          from={from}
          to={to}
          now={now}
          rounds={rounds}
          running={now === null ? null : running}
          sun={sun}
          events={events}
          hours={recording && day ? hourTotals(day) : null}
          hoursDay={from}
          ticks={ticks("fullday", from, to)}
          tint={lookTint(s.timer.color)}
        />
      </div>
      <div aria-hidden className="relative h-4 text-caption text-label-3">
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h} className={`absolute whitespace-nowrap ${h === 0 ? "" : h === 24 ? "-translate-x-full" : "-translate-x-1/2"}`} style={at(h === 24 ? to : new Date(from).setHours(h, 0, 0, 0))}>
            {hourText(h)}
          </span>
        ))}
      </div>
      <span className="text-caption text-label-2">
        {t(rounds.length === 1 ? "{n} Fokusrunde" : "{n} Fokusrunden", { n: rounds.length })} · {t(events.length === 1 ? "{n} Termin" : "{n} Termine", { n: events.length })}
      </span>
    </div>
  );
}

/** The day's Screen Time: the total, the hours and the week's average beside the first apps; how to turn it on while it is off. */
function Screen({ on, days, dayKey, hour }: { on: boolean; days: ScreenDay[] | null; dayKey: string; hour: number }) {
  if (!on) {
    return (
      <Empty
        icon={Hourglass}
        title={t("Bildschirmzeit ist aus")}
        text={t("Schalte sie ein, um zu sehen, welche Apps du wie lange benutzt. Die Daten bleiben auf diesem Gerät.")}
        // The consent: nothing else turns the recording on.
        action={<Button primary onClick={() => setScreenTime(true)}>{t("Einschalten")}</Button>}
      />
    );
  }
  if (!days) return null;
  const day = days.find((d) => d.date === dayKey) ?? null, total = dayTotal(day);
  if (!total) return <Empty icon={Hourglass} title={t("Keine Bildschirmzeit an diesem Tag")} />;
  const apps = ranked(day), first = apps.length ? appTotal(apps[0][1]) : 0;
  const listed = apps.slice(0, LISTED).map(([key, a]) => ({ key, name: a.name, path: a.path, secs: appTotal(a) }));
  const rest = total - listed.reduce((sum, a) => sum + a.secs, 0);
  const row = (key: string, icon: ReactNode, name: string, secs: number) => (
    <li key={key} className="flex h-[30px] items-center gap-2.5">
      {icon}
      <span dir="auto" className="min-w-0 flex-1 truncate text-footnote text-label">
        {name}
      </span>
      <span className="h-1 w-20 shrink-0 overflow-hidden rounded-full bg-fill-2 material:bg-fill-3">
        <span className="block h-full rounded-full bg-(--hue-purple) material:bg-primary" style={{ width: `${Math.min(100, (secs / Math.max(1, first)) * 100)}%` }} />
      </span>
      <span className="tabular w-16 shrink-0 text-end text-footnote text-label-2">{shortDuration(secs, locale())}</span>
    </li>
  );
  return (
    <div className="mt-3 flex min-h-0 flex-1 gap-6">
      <div className="flex w-[200px] shrink-0 flex-col">
        <span className="text-title font-semibold text-label">{longDuration(total, t)}</span>
        <span className="text-caption text-label-3">{t("Bildschirmzeit")}</span>
        <span className="mt-2 text-label">
          <HourBars hours={hourTotals(day)} hour={hour} width={200} height={56} label={t("Bildschirmzeit nach Stunden")} />
        </span>
        <span className="mt-1 text-caption text-label-3">{t("Schnitt der letzten 7 Tage: {time}", { time: longDuration(average(days), t) })}</span>
      </div>
      <ul className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {listed.map((a) => row(a.key, <AppIcon path={a.path} size={18} />, a.name, a.secs))}
        {rest > 0 && row("", <span className="size-[18px] shrink-0" />, t("Andere Apps"), rest)}
      </ul>
    </div>
  );
}
