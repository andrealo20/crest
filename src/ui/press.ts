import type { TargetAndTransition } from "motion/react";
import type { Design } from "../design/design.ts";
import { springs } from "../design/motion.ts";

/** Material's press on a filled or tonal button: a spring to 97 % and back, none under reduced motion or in Crest (.pressable scales there). */
export function filledPress(design: Design, reduced: boolean): { whileTap?: TargetAndTransition } {
  return design === "material" && !reduced ? { whileTap: { transform: "scale(0.97)", transition: springs.pop } } : {};
}
