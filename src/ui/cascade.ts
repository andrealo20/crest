import type { Variants } from "motion/react";
import { content, springs } from "../design/motion.ts";

/** How long after the page's first group the i-th one starts: 45 ms apart, the fifth and later together, so a long page is not slow. */
export function cascadeDelay(i: number): number {
  return Math.min(i, 4) * 0.045;
}

/**
 * A settings group's way in, played only when a parent gives the labels. `shown` is a function so it reads the presets at each
 * animation, after setMotionDesign has rewritten them in place.
 */
export const GROUP_IN = {
  hidden: { opacity: 0, transform: "translateY(14px)" },
  shown: () => {
    // A value's own delay replaces the one the parent orchestrates, so content.enter's would start every group's fade together.
    const { delay: _, ...opacity } = content.enter;
    return { opacity: 1, transform: "translateY(0px)", transition: { default: springs.morph, opacity } };
  },
} satisfies Variants;
