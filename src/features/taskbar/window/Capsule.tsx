import { useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { springs } from "../../../design/motion";

/** The capsule: as wide as its buttons, springing to a new width when one comes or goes (at once with reduced motion). */
export function Capsule({ ref, style, children }: { ref: RefObject<HTMLDivElement | null>; style: CSSProperties; children: ReactNode }) {
  const content = useRef<HTMLDivElement>(null);
  // A motion value set from the observer: Motion's first change after mount would not spring through `animate`.
  const width = useMotionValue(0);
  const reduced = useReducedMotion() === true;
  useLayoutEffect(() => {
    const el = content.current!;
    // The first width before the first paint, at once.
    width.jump(el.offsetWidth);
    const observer = new ResizeObserver(() => {
      if (reduced) width.jump(el.offsetWidth);
      else animate(width, el.offsetWidth, springs.glide);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      width.stop();
    };
  }, [width, reduced]);
  return (
    // Not clipped, so the names show above it: while it springs wider, a new button stands past its edge for a moment.
    <motion.div ref={ref} className="relative flex justify-center self-center text-label" style={{ ...style, width }}>
      <div ref={content} className="flex shrink-0 gap-0.5 px-1">
        {children}
      </div>
    </motion.div>
  );
}
