import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { motion } from "motion/react";
import { crossfade } from "../../design/motion";
import { activeTheme, forcedColors } from "../themes/store";
import { startContours, tintsOf, type ContourHandle, type Rgb } from "./contours";

const GREY: [Rgb, Rgb] = [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5]];

// Motion's reduced motion hook reads the query once at mount; this one follows a change while the window is open (design 1.4).
const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
const onReduced = (cb: () => void) => {
  reducedQuery.addEventListener("change", cb);
  return () => reducedQuery.removeEventListener("change", cb);
};
const isReduced = () => reducedQuery.matches;

/** Stellaria's contour lines behind the settings window under Material, drifting to each page's view (contours.ts). */
export function Contours({ page, onFail }: { page: string; onFail: (failed: boolean) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const handle = useRef<ContourHandle | null>(null);
  const reduced = useSyncExternalStore(onReduced, isReduced);

  // The page of this render starts the field there; later pages drift through page() on the same context.
  useLayoutEffect(() => {
    const h = startContours(canvas.current!, { page, tints: tintsOf(activeTheme.get()) ?? GREY, reduced, forced: forcedColors.get(), onFail });
    handle.current = h;
    const offTheme = activeTheme.subscribe(() => {
      const next = tintsOf(activeTheme.get());
      if (next) h.tints(next);
    });
    const offForced = forcedColors.subscribe(() => h.forced(forcedColors.get()));
    return () => {
      offTheme();
      offForced();
      handle.current = null;
      h.stop();
    };
  }, [reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => handle.current?.page(page), [page]);

  return (
    <motion.canvas
      ref={canvas}
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 size-full forced-colors:hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={crossfade}
    />
  );
}
