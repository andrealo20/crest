import { useEffect, useState } from "react";
import { useSecondTick } from "../../../features/timer/store";
import { locale } from "../../../i18n";
import { ROW_FONT, fontEpoch, measureTabular } from "../measure";

const DATE = { weekday: "short", day: "numeric", month: "short" } as const;

/** The time as the language writes it, with its own digits and day period; with `date`, the weekday, the day and the month before it (issue #41). */
export const clockFormat = (seconds: boolean, h12: boolean, date: boolean) =>
  new Intl.DateTimeFormat(locale(), {
    ...(date ? DATE : {}),
    hour: h12 ? "numeric" : "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hourCycle: h12 ? "h12" : "h23",
  });

/** The date alone, as Crest's bar writes it under the time. */
export const dateFormat = () => new Intl.DateTimeFormat(locale(), DATE);

/** The room with the date, by language, format and font: worked out once, since it takes every weekday of every month. */
const dateRoom = new Map<string, number>();

/** The widest of `times` as `f` writes them. Digits are tabular, each as wide as an 8 (in the language's own numerals), which the canvas does not know. */
function widest(f: Intl.DateTimeFormat, times: Date[]): number {
  // The 8th of August at 08:08:08: whatever the format shows, its last digit is an 8.
  const eight = f.format(new Date(2000, 7, 8, 8, 8, 8)).match(/\p{Nd}/gu)!.at(-1)!;
  return Math.max(...times.map((d) => measureTabular(f.format(d).replace(/\p{Nd}/gu, eight))));
}

/** The widest `f` writes in a year, cached by `options` (what else changes the format) and by language and font. */
function yearRoom(f: Intl.DateTimeFormat, options: string): number {
  const key = `${locale()}|${options}|${ROW_FONT}|${fontEpoch.get()}`;
  let room = dateRoom.get(key);
  if (room === undefined) {
    // The 10th to the 16th of each month, morning and evening: every weekday with every month's name.
    room = widest(f, Array.from({ length: 12 * 7 * 2 }, (_, i) => new Date(2000, i % 12, 10 + (Math.floor(i / 12) % 7), i < 84 ? 10 : 22, 8, 8)));
    if (dateRoom.size > 8) dateRoom.clear();
    dateRoom.set(key, room);
  }
  return room;
}

/**
 * Fixed room: a two-digit hour, and the wider of the morning and the evening on a 12 h clock. With the date, a two-digit
 * day and the widest weekday and month of the year, so the row is as wide tomorrow as it is today.
 */
export function clockWidth(seconds: boolean, h12: boolean, date = false): number {
  const f = clockFormat(seconds, h12, date);
  return date ? yearRoom(f, `${seconds}|${h12}`) : widest(f, [10, 22].map((h) => new Date(2000, 0, 1, h, 8, 8)));
}

/** Fixed room for the date alone, the widest of the year as `clockWidth` takes it. */
export function dateWidth(): number {
  return yearRoom(dateFormat(), "date");
}

/** Re-renders once a minute, 50 ms after it turns. */
export function useMinuteTick(active: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    let id = 0;
    const next = () => {
      const t = Date.now();
      setNow(t);
      id = window.setTimeout(next, 60_000 - (t % 60_000) + 50);
    };
    next();
    return () => window.clearTimeout(id);
  }, [active]);
  return now;
}

/** `paused` (under a notice) stops the ticking; it catches up on the first tick after. The date turns with the minute that starts the day. */
export function Clock({ seconds, h12, date = false, paused }: { seconds: boolean; h12: boolean; date?: boolean; paused: boolean }) {
  const minute = useMinuteTick(!seconds && !paused), second = useSecondTick(seconds && !paused);
  const time = clockFormat(seconds, h12, date).format(seconds ? second : minute);
  return (
    <span className="tabular block whitespace-nowrap text-center text-footnote font-medium text-label" style={{ width: clockWidth(seconds, h12, date) }}>
      {time}
    </span>
  );
}
