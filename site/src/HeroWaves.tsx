import { useLayoutEffect, useRef, useState } from "react";
import { startContours, type Rgb } from "../../src/features/settings/contours";

const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
/** The logo's purple and pink, as Material's two tints would be. */
const TINTS: [Rgb, Rgb] = [rgb("#7b61ff"), rgb("#e0559e")];

/**
 * The first screen's ground: the contour lines that drift behind Crest's settings window under Material (contours.ts), on black.
 * They move while the page is in view and the pointer moved in the last minute, and stand still under reduced motion; without
 * WebGL 2 the screen stays plain black.
 */
export function HeroWaves() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const field = startContours(canvas.current!, { page: "general", tints: TINTS, reduced, forced: false, onFail: setFailed });
    return () => field.stop();
  }, []);
  return <canvas ref={canvas} className="hero-waves" aria-hidden="true" hidden={failed} />;
}
