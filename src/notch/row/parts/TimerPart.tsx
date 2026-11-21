import { Timer } from "../../../ui/iconset";
import { formatClock, remainingOf, timer, useSecondTick, type TimerMode } from "../../../features/timer/store";
import { measureTabular } from "../measure";
import { modeTint } from "../../../features/timer/looks";
import { settings } from "../../../settings/store";

const ICON = 17, GAP = 4;

/** Room for the longest the countdown can read: the full duration, every digit an 8 ("180:00" too). */
export const timerWidth = (duration: number) => ICON + GAP + measureTabular(formatClock(duration).replace(/\d/g, "8"));

/** A running timer: icon and countdown, in the focus colour (Settings, Timer) or green for a break. Finished, it belongs to the notices. With `sample` it draws that state and never reads or ticks the real timer. */
export function TimerPart({ paused, sample }: { paused: boolean; sample?: { remaining: number; duration: number; mode: TimerMode } }) {
  const s = timer.use();
  const st = sample ?? s;
  const color = settings.use().timer.color;
  // Ticks when the countdown's own second changes, not the wall clock's; not at all under a notice.
  const now = useSecondTick(!sample && s.endsAt !== null && !paused, (s.endsAt ?? 0) % 1000);
  return (
    <span className="flex shrink-0 items-center" style={{ gap: GAP, color: modeTint(st.mode, color) }}>
      <Timer size={ICON} weight="bold" className="shrink-0" />
      <span className="tabular whitespace-nowrap text-footnote font-medium" style={{ width: timerWidth(st.duration) - ICON - GAP }}>
        {formatClock(sample ? sample.remaining : remainingOf(s, now))}
      </span>
    </span>
  );
}
