import { locale } from "../../../i18n";
import { measureText } from "../../../notch/row/measure";
import { clockFormat, clockWidth, dateFormat, dateWidth, useMinuteTick } from "../../../notch/row/parts/Clock";
import { formatDiff, formatClock as zoneClock, localZone, wallTime, zoneOffset } from "../../clocks/zones";
import { handAngles } from "../../timer/looks";
import { useSecondTick } from "../../timer/store";

/** Fixed room: the widest time and, with the date, the widest date of the year, so the clock never changes width. */
export function barClockWidth(seconds: boolean, h12: boolean, date: boolean): number {
  return Math.max(clockWidth(seconds, h12, false), date ? dateWidth() : 0);
}

/** Leading tighter than the footnote's own, so two lines fit in the closed row's 30 px. */
const LINE = "tabular block whitespace-nowrap text-center text-footnote leading-tight font-medium text-label";

/**
 * The bar's clock, as Windows' own: the time over the date, or the time alone without `date`. `paused` (the bar hidden) stops
 * the ticking; it catches up on the first tick after. The date turns with the minute that starts the day. `at` shows that time and never ticks.
 */
export function BarClock({ seconds, h12, date, paused, at }: { seconds: boolean; h12: boolean; date: boolean; paused: boolean; at?: number }) {
  const minute = useMinuteTick(!seconds && !paused && at === undefined), second = useSecondTick(seconds && !paused && at === undefined);
  const now = at ?? (seconds ? second : minute);
  return (
    <span className="block" style={{ width: barClockWidth(seconds, h12, date) }}>
      <span className={LINE}>{clockFormat(seconds, h12, false).format(now)}</span>
      {date && <span className={LINE}>{dateFormat().format(now)}</span>}
    </span>
  );
}

export const ANALOG = 22;

/** An analog dial: four ticks, the hour and minute hands. Ticks with the minute; `at` shows that time and never ticks. */
export function BarAnalog({ paused, at }: { paused: boolean; at?: number }) {
  const minute = useMinuteTick(!paused && at === undefined);
  const d = new Date(at ?? minute);
  const hands = handAngles(`${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`)!;
  return (
    <svg width={ANALOG} height={ANALOG} viewBox="-20 -20 40 40" className="shrink-0" role="img" aria-label={clockFormat(false, false, false).format(d)}>
      <circle r="19" fill="var(--color-fill-2)" />
      {[0, 90, 180, 270].map((a) => <line key={a} y1="-14.5" y2="-17" stroke="var(--color-label-3)" strokeWidth="2" strokeLinecap="round" transform={`rotate(${a})`} />)}
      <line y2="-9.5" stroke="var(--color-label)" strokeWidth="3.4" strokeLinecap="round" transform={`rotate(${hands.hour})`} />
      <line y2="-14" stroke="var(--color-label)" strokeWidth="2.2" strokeLinecap="round" transform={`rotate(${hands.minute})`} />
      <circle r="2.4" fill="var(--color-label)" />
    </svg>
  );
}

/** How far ahead of here `zone` is now, in minutes. */
const zoneDiff = (now: number, zone: string) => zoneOffset(now, zone) - zoneOffset(now, localZone());
const DIFF_GAP = 4;

/** Room for the time over the zone's difference and time, with the zone's offset now. The difference measured with a plus: Inter draws a hyphen before a figure as a minus, as wide as the plus. */
export const zonesWidth = (h12: boolean, zone: string) =>
  Math.max(clockWidth(false, h12, false), measureText(formatDiff(zoneDiff(Date.now(), zone)).replace("-", "+")) + DIFF_GAP + clockWidth(false, h12, false));

/** Two time zones: the time here over the difference ("-6 h") and the time in `zone`, the Clocks tool's first. `at` shows that time and never ticks. */
export function BarZones({ h12, zone, paused, at }: { h12: boolean; zone: string; paused: boolean; at?: number }) {
  const minute = useMinuteTick(!paused && at === undefined);
  const now = at ?? minute;
  return (
    <span className="block" style={{ width: zonesWidth(h12, zone) }}>
      <span className={LINE}>{clockFormat(false, h12, false).format(now)}</span>
      <span className={LINE}>
        <span className="text-label-3" style={{ marginInlineEnd: DIFF_GAP }}>{formatDiff(zoneDiff(now, zone))}</span>
        {zoneClock(wallTime(now, zone), locale(), h12)}
      </span>
    </span>
  );
}
