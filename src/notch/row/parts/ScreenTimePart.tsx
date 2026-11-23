// Screen Time and the Day timeline as parts of the closed row, and Screen Time's face, which the bar's widget draws in its three versions.

import type { ReactNode } from "react";
import { locale, t } from "../../../i18n";
import { settings } from "../../../settings/store";
import { Hourglass } from "../../../ui/iconset";
import { addDays, startOfDay } from "../../../features/calendar/model";
import { calendar } from "../../../features/calendar/store";
import { TIMELINE_W, TimelineFace } from "../../../features/screentime/DayStrip";
import { dayEvents } from "../../../features/screentime/day";
import {
  APPS_GAP, GLASS, GLASS_GAP, HIST_GAP, HIST_W, SLOT, SLOT_GAP, barHeight, eights, hourTotals, longDuration, screenFaceWidth, shortDuration, summary,
  type ScreenSummary, type ScreenVersion,
} from "../../../features/screentime/model";
import { screenToday } from "../../../features/screentime/store";
import { AppIcon } from "../../../features/system/AppIcon";
import { roundsOf, runningSpan } from "../../../features/timer/rounds";
import { focusLog, timer } from "../../../features/timer/store";
import { measureTabular } from "../measure";
import { useMinuteTick } from "./Clock";

type Part = { width: number; draw: () => ReactNode } | null;

/** The face's text and its room, as wide as the text with every digit an 8: it grows only from 59m to 1h 00m and from 9h to 10h. */
export const screenText = (secs: number) => {
  const text = shortDuration(secs, locale());
  return { text, room: measureTabular(eights(text)) };
};

/**
 * The hours as a histogram `width` by `height` (71 by 16 on the bar): 24 bars 2 wide at a step of 3, from the foot, an hour without
 * time a faint dash, the hour now (`hour`; -1 for none) full and the others lighter.
 */
export function HourBars({ hours, hour, width = HIST_W, height = 16, label }: { hours: number[]; hour: number; width?: number; height?: number; label?: string }) {
  const sx = width / HIST_W, sy = height / 16;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block shrink-0" {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
      {hours.map((secs, i) => {
        const h = barHeight(secs, 14 * sy), x = i * 3 * sx;
        if (!h) return <rect key={i} x={x} y={15 * sy - 1} width={2 * sx} height={1} fill="currentColor" fillOpacity={0.18} />;
        return <rect key={i} x={x} y={15 * sy - h} width={2 * sx} height={h} rx={0.5 * sx} fill="currentColor" fillOpacity={i === hour ? 1 : 0.55} className={i === hour ? "material:fill-primary" : undefined} />;
      })}
    </svg>
  );
}

/**
 * Today's Screen Time behind the hourglass, in Screen Time's purple (primary under Material); `apps` adds three fixed slots with the
 * first apps' icons, `hourly` the hours. A screen reader hears the total, and the apps with theirs.
 */
export function ScreenFace({ s, v, hour }: { s: ScreenSummary; v: ScreenVersion; hour: number }) {
  const { text, room } = screenText(s.total);
  const said = [t("Bildschirmzeit heute: {time}", { time: longDuration(s.total, t) }), ...(v === "apps" ? s.apps.map((a) => `${a.name} ${longDuration(a.secs, t)}`) : [])];
  return (
    <span className="flex shrink-0 items-center whitespace-nowrap text-label" role="img" aria-label={said.join(", ")} style={{ width: screenFaceWidth(v, room) }}>
      <Hourglass size={GLASS} weight="fill" className="shrink-0 text-(--hue-purple) material:text-primary" />
      <span className="tabular text-left text-footnote font-medium" style={{ marginInlineStart: GLASS_GAP, width: room }}>
        {text}
      </span>
      {v === "apps" && (
        <span className="flex items-center" style={{ marginInlineStart: APPS_GAP, gap: SLOT_GAP }}>
          {[0, 1, 2].map((i) => (
            // Three slots whatever the apps, so a second app turning up moves nothing.
            <span key={i} className="flex shrink-0" style={{ width: SLOT, height: SLOT }}>
              {s.apps[i] && <AppIcon path={s.apps[i].path} size={SLOT} />}
            </span>
          ))}
        </span>
      )}
      {v === "hourly" && (
        <span className="flex" style={{ marginInlineStart: HIST_GAP }}>
          <HourBars hours={s.hours} hour={hour} />
        </span>
      )}
    </span>
  );
}

/** Today's Screen Time in the row, its width and how it draws, while `on` and while it records; null otherwise. */
export function useScreenTimePart(on: boolean): Part {
  const recording = settings.use().screenTime.on;
  const today = screenToday.use();
  if (!on || !recording) return null;
  // Before the first read and on a day without any yet: 0m, since the dimmed glass would say it is off.
  const s = summary(today, 0);
  return { width: screenFaceWidth("total", screenText(s.total).room), draw: () => <ScreenFace s={s} v="total" hour={-1} /> };
}

/** The day's strip in the row, always the whole day, its width and how it draws, while `on`; null otherwise. */
export function useDayPart(on: boolean): Part {
  const now = useMinuteTick(on);
  const log = focusLog.use();
  const running = runningSpan(timer.use(), now);
  const s = settings.use();
  const { data } = calendar.use();
  const today = screenToday.use();
  if (!on) return null;
  const day = startOfDay(now);
  const own = { now, rounds: roundsOf(log), running, place: s.weather };
  const events = dayEvents(data, day, addDays(day, 1));
  const hours = s.screenTime.on && today ? hourTotals(today) : null;
  return { width: TIMELINE_W, draw: () => <TimelineFace v="fullday" own={own} events={events} hours={hours} /> };
}
