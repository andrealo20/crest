import { Timer } from "@phosphor-icons/react";
import { formatClock, remainingOf, timer, useSecondTick } from "../../../features/timer/store";
import { measureText } from "../measure";

const ICON = 17, GAP = 4;

/** Room for the longest the countdown can read: the full duration, every digit an 8 ("180:00" too). */
export const timerWidth = (duration: number) => ICON + GAP + measureText(formatClock(duration).replace(/\d/g, "8"));

/** A running timer: icon and countdown, orange for focus and green for a break. Finished, it belongs to the notices. */
export function TimerPart() {
  const s = timer.use();
  // Ticks when the countdown's own second changes, not the wall clock's.
  const now = useSecondTick(s.endsAt !== null, (s.endsAt ?? 0) % 1000);
  return (
    <span className="flex shrink-0 items-center" style={{ gap: GAP, color: s.mode === "focus" ? "var(--color-orange)" : "var(--color-green)" }}>
      <Timer size={ICON} weight="bold" className="shrink-0" />
      <span className="tabular whitespace-nowrap text-footnote font-medium" style={{ width: timerWidth(s.duration) - ICON - GAP }}>
        {formatClock(remainingOf(s, now))}
      </span>
    </span>
  );
}
