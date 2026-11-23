// The faces of the bar's Screen Time and Day timeline widgets, and what the timeline reads in the bar's own window.

import { useSyncExternalStore } from "react";
import { locale, t } from "../../../i18n";
import type { PartId } from "../../../notch/row/parts";
import { ScreenFace, screenText } from "../../../notch/row/parts/ScreenTimePart";
import { useMinuteTick } from "../../../notch/row/parts/Clock";
import { settings } from "../../../settings/store";
import { TIMELINE_W, TimelineFace, type DayOwn } from "../../screentime/DayStrip";
import { stripWindow } from "../../screentime/day";
import { screenFaceWidth, shortDuration } from "../../screentime/model";
import { roundSpans, roundsOf, runningSpan, type FocusRound } from "../../timer/rounds";
import { focusLog, timer } from "../../timer/store";
import { variantOf } from "../model";
import type { Body, WidgetContext } from "./Widget";

export type { DayOwn };

/** For a widget other than the timeline: nothing to hear, and values that never change. */
const none = () => () => {};
const NO_ROUNDS: FocusRound[] = [];
const noRounds = () => NO_ROUNDS;
/** A timer that runs no round. */
const STOPPED: { mode: string; endsAt: number | null; duration: number } = { mode: "focus", endsAt: null, duration: 0 };
const stopped = () => STOPPED;

/**
 * The Day timeline's own reads, ticking each minute while the bar shows; undefined for every other widget. The rounds and the timer
 * are saved stores every window reads, and the place is the Weather's, so none of it crosses the feed.
 */
export function useDay(id: PartId, paused: boolean): DayOwn | undefined {
  const on = id === "timeline";
  const now = useMinuteTick(on && !paused);
  const log = useSyncExternalStore(on ? focusLog.subscribe : none, on ? focusLog.get : noRounds);
  const running = runningSpan(useSyncExternalStore<typeof STOPPED>(on ? timer.subscribe : none, on ? timer.get : stopped), now);
  const place = settings.use().weather;
  return on ? { now, rounds: roundsOf(log), running, place } : undefined;
}

/** The previews' day at `at` (14:30): rounds at 9:00 and 10:30, daylight from 07:12 to 16:40, as the sample weather's. */
const sampleDay = (at: number): DayOwn => {
  const time = (h: number, m: number) => new Date(at).setHours(h, m, 0, 0);
  return { now: at, rounds: [{ end: time(9, 25), secs: 1500 }, { end: time(10, 55), secs: 1500 }], running: null, place: null };
};
const sampleSun = (at: number): [number, number][] => [[new Date(at).setHours(7, 12, 0, 0), new Date(at).setHours(16, 40, 0, 0)]];

/** Screen Time or the Day timeline as the bar draws it; null while Screen Time does not record, and the bar draws its dimmed glass. */
export function dayPart(id: "screentime" | "timeline", ctx: WidgetContext): Body | null {
  const { feed, variants, sample, at } = ctx;
  if (id === "screentime") {
    const s = feed.screenTime;
    if (!s) return null;
    const v = variantOf(variants, "screentime");
    // The apps' names and times beside the widget's name above it; the face shows only their icons.
    const tip = v === "apps" && s.apps.length ? s.apps.map((a) => `${a.name} ${shortDuration(a.secs, locale())}`).join(", ") : undefined;
    return { node: <ScreenFace s={s} v={v} hour={new Date(at ?? Date.now()).getHours()} />, width: screenFaceWidth(v, screenText(s.total).room), tip };
  }
  // Never empty: the line at the time now is always there, so the dimmed icon never shows.
  const own = sample && at !== undefined ? sampleDay(at) : ctx.day;
  if (!own) return null;
  const v = variantOf(variants, "timeline");
  const [from, to] = stripWindow(v, own.now);
  const n = roundSpans(own.rounds, from, to).length;
  return {
    node: <TimelineFace v={v} own={own} events={feed.timeline.events} hours={feed.timeline.hours} sun={sample && at !== undefined ? sampleSun(at) : undefined} />,
    width: TIMELINE_W,
    tip: n ? t(n === 1 ? "{n} Fokusrunde" : "{n} Fokusrunden", { n }) : undefined,
  };
}
