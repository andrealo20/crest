import { useEffect } from "react";
import { motion, useReducedMotion, useSpring, useTransform, type MotionValue } from "motion/react";
import { springs } from "../design/motion";

/**
 * A reading that glides to each new sample, from `from` at mount (0 fills it on opening). Pass it at the scale it is shown in
 * (percent, watts, milliseconds): springs.value comes to rest within half a unit of that scale.
 */
export function useGlide(value: number, from = value): MotionValue<number> {
  const reduced = useReducedMotion() === true;
  // Born at the value under reduced motion, so the first frame does not show the start.
  const v = useSpring(reduced ? value : from, springs.value);
  useEffect(() => {
    reduced ? v.jump(value) : v.set(value);
  }, [v, value, reduced]);
  return v;
}

/** A gliding number as text, written by Motion on every frame without rendering React. */
export function Glide({ value, format, className }: { value: MotionValue<number>; format: (n: number) => string; className?: string }) {
  const text = useTransform(value, (n) => format(Math.round(n)));
  return <motion.span className={className}>{text}</motion.span>;
}
