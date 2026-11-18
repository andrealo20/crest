import { clockFormat, clockWidth, dateFormat, dateWidth, useMinuteTick } from "../../../notch/row/parts/Clock";
import { useSecondTick } from "../../timer/store";

/** Fixed room: the widest time and, with the date, the widest date of the year, so the clock never changes width. */
export function barClockWidth(seconds: boolean, h12: boolean, date: boolean): number {
  return Math.max(clockWidth(seconds, h12, false), date ? dateWidth() : 0);
}

/** Leading tighter than the footnote's own, so two lines fit in the closed row's 30 px. */
const LINE = "tabular block whitespace-nowrap text-center text-footnote leading-tight font-medium text-label";

/**
 * The bar's clock, as Windows' own: the time over the date, or the time alone without `date`. `paused` (the bar hidden) stops
 * the ticking; it catches up on the first tick after. The date turns with the minute that starts the day.
 */
export function BarClock({ seconds, h12, date, paused }: { seconds: boolean; h12: boolean; date: boolean; paused: boolean }) {
  const minute = useMinuteTick(!seconds && !paused), second = useSecondTick(seconds && !paused);
  const now = seconds ? second : minute;
  return (
    <span className="block" style={{ width: barClockWidth(seconds, h12, date) }}>
      <span className={LINE}>{clockFormat(seconds, h12, false).format(now)}</span>
      {date && <span className={LINE}>{dateFormat().format(now)}</span>}
    </span>
  );
}
