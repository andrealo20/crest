import { useEffect, useRef } from "react";
import { motion, useReducedMotion, useSpring, useTransform, type MotionValue } from "motion/react";
import { springs } from "../design/motion";

/**
 * A reading that glides to each new sample, from `from` at mount (0 fills it on opening). Pass it at the scale it is shown in
 * (percent, watts, milliseconds): springs.value comes to rest within half a unit of that scale. A reading null at mount (a ping
 * before its first answer) starts at its first value, not at 0; null later keeps the last one.
 */
export function useGlide(value: number | null, from = value ?? 0): MotionValue<number> {
  const reduced = useReducedMotion() === true;
  // Born at the value under reduced motion, so the first frame does not show the start.
  const v = useSpring(reduced ? (value ?? 0) : from, springs.value);
  const started = useRef(value !== null);
  useEffect(() => {
    if (value === null) return;
    reduced || !started.current ? v.jump(value) : v.set(value);
    started.current = true;
  }, [v, value, reduced]);
  return v;
}

/** A gliding number as text, written by Motion on every frame without rendering React. */
export function Glide({ value, format, className }: { value: MotionValue<number>; format: (n: number) => string; className?: string }) {
  const text = useTransform(value, (n) => format(Math.round(n)));
  return <motion.span className={className}>{text}</motion.span>;
}
