import { useLayoutEffect, useRef } from "react";
import { animate, useReducedMotion } from "motion/react";
import { springs } from "../../design/motion";
import { mixPoints, pathOf } from "./hero";

/** A path that morphs between point lists of the same length. Its d is written from JavaScript, as WebKit does not animate a CSS transition on d. */
export function MorphPath({ points, className }: { points: number[]; className?: string }) {
  const path = useRef<SVGPathElement>(null);
  // The points on screen now, halfway through a morph too, so the next one starts from what is seen.
  const drawn = useRef<number[] | null>(null);
  const reduced = useReducedMotion() === true;

  useLayoutEffect(() => {
    const el = path.current;
    const from = drawn.current;
    if (!el) return;
    if (reduced || !from || from === points) {
      el.setAttribute("d", pathOf((drawn.current = points)));
      return;
    }
    const morph = animate(0, 1, { ...springs.morph, onUpdate: (t) => el.setAttribute("d", pathOf((drawn.current = mixPoints(from, points, t)))) });
    return () => morph.stop();
  }, [points, reduced]);

  return <path ref={path} className={className} />;
}
