import { useLayoutEffect, useRef } from "react";

/** Side of one pixel, in CSS px, and how long the whole reveal takes. */
const CELL = 11;
const DURATION = 2200;

/**
 * Shows its children a pixel at a time: a canvas in the ground's colour covers them and loses one square after another, in a
 * random order that leans from left to right, like the closed notch's pixel timer. With reduced motion it shows them at once.
 */
export function PixelReveal({ children, delay = 150 }: { children: React.ReactNode; delay?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  // Before the first paint, so the text never flashes in uncovered.
  useLayoutEffect(() => {
    const el = box.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return void cv.remove();

    const { width, height } = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.ceil(width * dpr);
    cv.height = Math.ceil(height * dpr);
    const ctx = cv.getContext("2d");
    if (!ctx) return void cv.remove();
    ctx.scale(dpr, dpr);
    // The colour of whatever is behind the text: the first ancestor with a background.
    let ground = "transparent";
    for (let n: HTMLElement | null = el; n && ground === "transparent"; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && bg !== "transparent" && !bg.endsWith(", 0)")) ground = bg;
    }
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, width, height);

    const cols = Math.ceil(width / CELL);
    const rows = Math.ceil(height / CELL);
    const cells: { x: number; y: number; at: number }[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ x: c * CELL, y: r * CELL, at: (c / cols) * 0.35 + Math.random() * 0.65 });
    cells.sort((a, b) => a.at - b.at);

    let done = 0;
    let raf = 0;
    const start = performance.now() + delay;
    const step = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / DURATION));
      // Ease out: many squares go at first, the last few linger.
      const target = Math.floor((1 - (1 - t) ** 2) * cells.length);
      for (; done < target; done++) ctx.clearRect(cells[done].x, cells[done].y, CELL, CELL);
      if (t < 1) raf = requestAnimationFrame(step);
      else cv.remove();
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [delay]);

  return (
    <div ref={box} className="pixel-reveal">
      {children}
      <canvas ref={canvas} aria-hidden="true" />
    </div>
  );
}
