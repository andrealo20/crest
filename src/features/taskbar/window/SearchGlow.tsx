import { motion } from "motion/react";
import { content } from "../../../design/motion";
import { GLOW_COLOURS, edgeMask } from "./glow";
import "./glow.css";

const MASK = edgeMask();

/**
 * The search panel's glow along its edge, as Google's assistant draws one round a phone's screen: its colours turning slowly under a
 * mask that keeps them to a soft band at the edge (glow.ts), muted as there. BarPanel puts it in the shape under the search, so the shape's
 * rounding cuts it as it grows and the text stays clear; it fades with the search.
 */
export function SearchGlow() {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-clip [container-type:size]"
      style={{ maskImage: MASK }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 0.75, transition: content.enter }}
      exit={{ opacity: 0, transition: content.exit }}
    >
      {/* As wide as the panel's diagonal, so the turning square covers it at every angle. */}
      <div
        className="search-glow-turn absolute top-1/2 left-1/2 aspect-square -translate-x-1/2 -translate-y-1/2"
        style={{ width: "hypot(100cqw, 100cqh)", background: GLOW_COLOURS }}
      />
    </motion.div>
  );
}
