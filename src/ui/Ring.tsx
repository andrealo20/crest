import type { ReactNode } from "react";
import { motion, useMotionValue, useTransform, type MotionValue } from "motion/react";
// With its suffix: on a case-insensitive disk "./ring" is this file's own name too.
import { arcPath } from "./ring.ts";

/** One arc of a ring, in percent of the ring's sweep; offset starts it where another one ends (the cache after the use). */
export interface Arc {
  value: MotionValue<number>;
  offset?: MotionValue<number>;
  color: string;
  opacity?: number;
}

/** A ring on a track whose arcs follow their gliding percentages, so an arc stops when the number under it stops. */
export function Ring({ size, stroke, sweep, arcs, children }: { size: number; stroke: number; sweep: 270 | 360; arcs: Arc[]; children?: ReactNode }) {
  const d = arcPath(size, stroke, sweep);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <path d={d} stroke="var(--color-fill-2)" strokeWidth={stroke} fill="none" strokeLinecap="round" className="forced-colors:stroke-[GrayText]" />
        {arcs.map((arc, i) => (
          <RingArc key={i} d={d} stroke={stroke} arc={arc} />
        ))}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

// A component of its own so each arc calls its hooks once.
function RingArc({ d, stroke, arc }: { d: string; stroke: number; arc: Arc }) {
  const zero = useMotionValue(0);
  // arcPath draws only the sweep, so the fraction is of the open part.
  const pathLength = useTransform(arc.value, (p) => p / 100);
  const pathOffset = useTransform(arc.offset ?? zero, (p) => p / 100);
  // The round cap would leave a dot at zero.
  const visible = useTransform(arc.value, (p) => (p < 0.5 ? 0 : 1));
  return (
    <motion.path
      d={d}
      stroke={arc.color}
      strokeOpacity={arc.opacity}
      strokeWidth={stroke}
      fill="none"
      strokeLinecap="round"
      className="forced-colors:stroke-[Highlight]"
      style={{ pathLength, pathOffset, opacity: visible }}
    />
  );
}
