import { useId } from "react";
import { t } from "../../i18n";
import { formatTime } from "../../lib/format";
import { settings } from "../../settings/store";
import { startOfDay } from "../calendar/model";
import type { Place } from "../themes/daynight";
import { lookTint } from "../timer/looks";
import { roundSpans, type FocusRound } from "../timer/rounds";
import { blocks, stripWindow, sunSpans, ticks, xOf, type StripVersion } from "./day";

/*
 * The Day timeline: a strip of the day with daylight, the calendar's events, the finished focus rounds and, while it records, Screen
 * Time per hour, under a line at the time now. 16 px tall on the bar and in the closed row, 32 on the Screen Time page; every y is
 * given at 16 and scaled. Nothing animates: the line and the next hours move with the minute's re-render.
 */

type Span = [number, number];

/** The bar's and the closed row's strip: 6 px an hour over the day, 18 over the next hours. */
export const TIMELINE_W = 144;

/** What the timeline reads besides the feed: the finished rounds, the round running now and the Weather's place, at `now`. */
export interface DayOwn {
  now: number;
  rounds: FocusRound[];
  running: Span | null;
  place: Place;
}

export interface StripProps {
  width: number;
  height: number;
  from: number;
  to: number;
  /** The line at the time now, where it falls in the window; null on a day gone by. */
  now: number | null;
  rounds: Span[];
  running: Span | null;
  sun: Span[];
  events: { start: number; end: number; color: string }[];
  /** Screen Time per local hour of the day that starts at `hoursDay`, while it records. */
  hours: number[] | null;
  hoursDay: number;
  ticks: number[];
  /** The Timer's colour (looks.ts lookTint), for the rounds. */
  tint: string;
}

/** What a screen reader says: the rounds, the events, and the day's sunrise and sunset when there is a place. */
export function stripLabel(rounds: number, events: number, sun: Span | undefined): string {
  const said = [t(rounds === 1 ? "{n} Fokusrunde" : "{n} Fokusrunden", { n: rounds }), t(events === 1 ? "{n} Termin" : "{n} Termine", { n: events })];
  if (sun) said.push(`${t("Sonnenaufgang")} ${formatTime(sun[0])}`, `${t("Sonnenuntergang")} ${formatTime(sun[1])}`);
  return said.join(", ");
}

export function DayStrip(p: StripProps) {
  const clip = `day${useId().replace(/[^\w-]/g, "")}`;
  const k = p.height / 16, { width, from, to } = p;
  const box = (span: Span, min = 2) => blocks([span], from, to, width, min)[0];
  const events = p.events.flatMap((e) => {
    const b = box([e.start, e.end]);
    return b ? [{ ...b, color: e.color }] : [];
  });
  // Each hour of the day as its own span, so the day the clocks change keeps its hours where they were.
  const hours = (p.hours ?? []).flatMap((secs, h) => {
    const b = secs > 0 && box([new Date(p.hoursDay).setHours(h, 0, 0, 0), new Date(p.hoursDay).setHours(h + 1, 0, 0, 0)], 0);
    return b ? [{ ...b, secs }] : [];
  });
  const running = p.running && box(p.running);
  const now = p.now !== null && p.now >= from && p.now <= to ? Math.min(width - 1.5, Math.max(0, xOf(p.now, from, to, width) - 0.75)) : null;
  return (
    <svg
      width={width}
      height={p.height}
      viewBox={`0 0 ${width} ${p.height}`}
      className="block shrink-0"
      role="img"
      aria-label={stripLabel(p.rounds.length, events.length, p.sun[0])}
    >
      <defs>
        <clipPath id={clip}>
          <rect y={k} width={width} height={12 * k} rx={3 * k} />
        </clipPath>
      </defs>
      {/* The rail, faint, on fill-3 under Material as the first group's tracks. */}
      <rect y={k} width={width} height={12 * k} rx={3 * k} fill="currentColor" fillOpacity={0.14} className="material:fill-fill-3 material:[fill-opacity:1]" />
      <g clipPath={`url(#${clip})`}>
        {blocks(p.sun, from, to, width, 0).map((b, i) => (
          <rect key={i} x={b.x} y={k} width={b.w} height={12 * k} fill="var(--hue-amber)" fillOpacity={0.3} />
        ))}
        {p.ticks.map((tick) => (
          <rect key={tick} x={xOf(tick, from, to, width) - 0.5} y={k} width={1} height={12 * k} fill="currentColor" fillOpacity={0.18} />
        ))}
      </g>
      {/* A colour that is no colour falls back to the link's blue. */}
      <g fill="var(--color-link)">
        {events.map((b, i) => (
          <rect key={i} x={b.x} y={2.5 * k} width={b.w} height={4 * k} rx={1.5 * k} fill={b.color} />
        ))}
      </g>
      {p.rounds.map((span, i) => {
        const b = box(span);
        return b && <rect key={i} x={b.x} y={7.5 * k} width={b.w} height={4 * k} rx={1.5 * k} fill={p.tint} />;
      })}
      {running && <rect x={running.x} y={7.5 * k} width={running.w} height={4 * k} rx={1.5 * k} fill={p.tint} fillOpacity={0.5} />}
      {hours.map((b, i) => (
        <rect key={i} x={b.x} y={14.5 * k} width={b.w} height={1.5 * k} fill="currentColor" fillOpacity={0.15 + 0.85 * Math.min(1, b.secs / 3600)} />
      ))}
      {now !== null && <rect width={1.5} height={14 * k} rx={0.75} fill="currentColor" className="material:fill-primary" style={{ transform: `translateX(${now}px)` }} />}
    </svg>
  );
}

/**
 * The strip as the bar's widget and the closed row's part draw it: the local day or the next hours at `own.now`, the rounds and
 * daylight from the bar's own window, the events and Screen Time from the feed. `sun` stands in for the place's (the previews).
 */
export function TimelineFace({ v, own, events, hours, sun }: { v: StripVersion; own: DayOwn; events: StripProps["events"]; hours: number[] | null; sun?: Span[] }) {
  const tint = lookTint(settings.use().timer.color);
  const [from, to] = stripWindow(v, own.now);
  return (
    <span className="flex shrink-0 text-label">
      <DayStrip
        width={TIMELINE_W}
        height={16}
        from={from}
        to={to}
        now={own.now}
        rounds={roundSpans(own.rounds, from, to)}
        running={own.running}
        sun={sun ?? sunSpans(from, to, own.place)}
        events={events}
        hours={hours}
        hoursDay={startOfDay(own.now)}
        ticks={ticks(v, from, to)}
        tint={tint}
      />
    </span>
  );
}
