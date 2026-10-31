import { useMemo } from "react";
import { motion } from "motion/react";
import { marqueeCycle } from "./cycles";
import { useCycle } from "./Carousel";

/** Text wider than its room scrolls to its end and back, three laps, then rests at its start. Remount it to start over. */
export function Marquee({ text, textWidth, width, paused }: { text: string; textWidth: number; width: number; paused: boolean }) {
  const overflow = textWidth - width;
  const cycle = useMemo(() => (overflow > 0.5 ? marqueeCycle(overflow) : null), [overflow]);
  const { x } = useCycle(cycle, paused, cycle?.done);
  return (
    <div className="flex h-full items-center overflow-clip" style={{ width }}>
      <motion.span className="shrink-0 whitespace-nowrap text-footnote font-medium text-label" style={{ x }}>
        {text}
      </motion.span>
    </div>
  );
}
