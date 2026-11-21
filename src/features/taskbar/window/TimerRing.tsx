import { settings } from "../../../settings/store";
import { modeTint } from "../../timer/looks";
import { formatClock, remainingOf, timer, useSecondTick, type TimerMode } from "../../timer/store";

/** The ring's size on the bar. */
export const RING_FACE = 16;

/**
 * The timer's ring version on Crest's bar: the share of the duration still left, emptying counter-clockwise from the top, in the
 * timer's colour; the countdown is what a screen reader says. Its own drawing, not Rings.tsx's `Ring`, the AI usage ring (design 6D).
 * With `sample` it draws that state and never reads or ticks the real timer.
 */
export function TimerRing({ paused, sample }: { paused: boolean; sample?: { remaining: number; duration: number; mode: TimerMode } }) {
  const s = timer.use();
  const color = settings.use().timer.color;
  const st = sample ?? s;
  // As TimerPart: ticks when the countdown's own second changes; not at all under a notice or for a sample.
  const now = useSecondTick(!sample && s.endsAt !== null && !paused, (s.endsAt ?? 0) % 1000);
  const left = sample ? sample.remaining : remainingOf(s, now);
  const share = st.duration > 0 ? Math.min(100, Math.max(0, (left / st.duration) * 100)) : 0;
  return (
    <svg width={RING_FACE} height={RING_FACE} viewBox="0 0 12 12" className="shrink-0 text-label" role="img" aria-label={formatClock(left)}>
      <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth="2" />
      {share > 0 && (
        <circle
          cx="6" cy="6" r="5" fill="none" stroke={modeTint(st.mode, color)} strokeWidth="2" strokeLinecap={share >= 99.9 ? "butt" : "round"}
          pathLength={100} strokeDasharray={share >= 99.9 ? "100 0" : `${share} 100`}
          // Rotated to start at the top, then mirrored: counter-clockwise.
          transform="matrix(-1 0 0 1 12 0) rotate(-90 6 6)"
        />
      )}
    </svg>
  );
}
