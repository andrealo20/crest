import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { startContours, type Rgb } from "../../src/features/settings/contours";

const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
/** The logo's purple and pink, as Material's two tints would be, for the black screens. */
export const LOGO_TINTS: [Rgb, Rgb] = [rgb("#7b61ff"), rgb("#e0559e")];
/** Black lines, which read as a deeper shade of whatever colour the section has. */
export const SHADE_TINTS: [Rgb, Rgb] = [[0, 0, 0], [0, 0, 0]];

/** At the screen's own density, up to 3, and 8 million pixels: a page is wider than the settings window, whose limits would blur the lines. */
const SHARP = { ratio: 3, pixels: 8e6 };

/** The contour field on its own canvas, from mount to unmount. */
function Field({ tints }: { tints: [Rgb, Rgb] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const field = startContours(canvas.current!, { page: "general", tints, reduced, forced: false, onFail: setFailed, cap: SHARP });
    return () => field.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={canvas} className="waves-canvas" aria-hidden="true" hidden={failed} />;
}

/**
 * The contour lines that drift behind Crest's settings window under Material (contours.ts), as a section's ground. Their canvas
 * exists only while the section is near the screen: every section has one, and a page may keep only so many WebGL contexts before
 * the browser drops the oldest. They move while the page is in view and the pointer moved in the last minute, stand still under
 * reduced motion, and without WebGL 2 the section keeps its plain colour.
 */
export function Waves({ tints = LOGO_TINTS }: { tints?: [Rgb, Rgb] }) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: "200px 0px" });
    io.observe(box.current!);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={box} className="waves" aria-hidden="true">
      {near && <Field tints={tints} />}
    </div>
  );
}
