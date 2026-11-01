import { motion } from "motion/react";
import { SEGMENTS, litCells, lookText, pixelMatrix, progressOf, terminalBar, zenParts, type TimerLook } from "./looks";
import type { TimerMode } from "./store";
import { t } from "../../i18n";
import "./looks.css";

/*
 * The big countdown in the chosen look. Fills the width it gets; `h` is the height in px
 * (44 in the notch, 52 in the detached window, 24 in the settings preview), every size
 * derives from it. Animations only while `running`; looks.css stops them for reduced motion.
 */
export interface LookProps {
  look: TimerLook;
  remaining: number;
  duration: number;
  running: boolean;
  mode: TimerMode;
  tint: string;
  h: number;
}

export function Look(props: LookProps) {
  switch (props.look) {
    case "pixel":
      return <Pixel {...props} />;
    case "dots":
      return <Dots {...props} />;
    case "retro":
      return <Retro {...props} />;
    case "terminal":
      return <Terminal {...props} />;
    case "zen":
      return <Zen {...props} />;
    case "hud":
      return <Hud {...props} />;
    default:
      return <Clean {...props} />;
  }
}

const modeName = (mode: TimerMode) => t(mode === "focus" ? "Fokus" : "Pause");
const percent = (p: LookProps) => Math.round(progressOf(p.remaining, p.duration) * 100);

function Clean(p: LookProps) {
  return (
    <div className="flex min-w-0 flex-1 items-center" style={{ gap: p.h * 0.36 }}>
      <span className="tabular shrink-0 leading-none font-semibold tracking-[-0.03em]" style={{ color: p.tint, fontSize: p.h * 0.91 }}>
        {lookText("clean", p.remaining)}
      </span>
      <div className="relative flex-1 overflow-hidden rounded-full bg-fill-2" style={{ height: Math.max(3, p.h * 0.11) }}>
        <motion.div
          className="absolute inset-0 origin-left rounded-full rtl:origin-right"
          style={{ backgroundColor: p.tint }}
          initial={false}
          animate={{ transform: `scaleX(${progressOf(p.remaining, p.duration)})` }}
          transition={{ duration: 0.25, ease: "linear" }}
        />
      </div>
    </div>
  );
}

/** Pixel dusk: 3x5 pixel digits coloured like a sunset sky, and a row of blocks that go dark as time passes. */
function Pixel(p: LookProps) {
  const matrix = pixelMatrix(lookText("pixel", p.remaining));
  const cell = (p.h * 0.84) / 5;
  const cols = matrix[0].length;
  const blocks = 12;
  const lit = litCells(p.remaining, p.duration, blocks);
  return (
    <div className="flex min-w-0 flex-1 items-end" style={{ gap: p.h * 0.3 }}>
      <svg width={cols * cell} height={5 * cell} className="shrink-0" aria-label={lookText("clean", p.remaining)} role="img">
        {matrix.flatMap((row, y) =>
          row.map((on, x) => (
            <rect
              key={`${x}-${y}`}
              x={x * cell}
              y={y * cell}
              width={cell * 0.84}
              height={cell * 0.84}
              rx={cell * 0.14}
              fill={on ? `var(--dusk-${y})` : "var(--look-off)"}
            />
          )),
        )}
      </svg>
      <div className="flex min-w-0 flex-1 items-end justify-between" style={{ height: cell * 0.84 }}>
        {Array.from({ length: blocks }, (_, i) => (
          <span
            key={i}
            className={`look-fade shrink ${p.running && i === lit - 1 ? "look-blink" : ""}`}
            style={{
              width: cell * 0.84,
              height: cell * 0.84,
              borderRadius: cell * 0.14,
              background: i < lit ? `var(--dusk-${Math.min(4, Math.floor((i / blocks) * 5))})` : "var(--look-off)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** Dots: one dot per slice of the time; they go out one by one, the next one to go breathes. */
function Dots(p: LookProps) {
  const cols = 20;
  const rows = 3;
  const lit = litCells(p.remaining, p.duration, cols * rows);
  const dot = p.h * 0.17;
  return (
    <div className="flex min-w-0 flex-1 items-center" style={{ gap: p.h * 0.3 }}>
      <span className="tabular shrink-0 leading-none font-semibold tracking-[-0.02em]" style={{ color: p.tint, fontSize: p.h * 0.55 }}>
        {lookText("dots", p.remaining)}
      </span>
      <svg className="min-w-0 flex-1" height={rows * dot * 1.6} viewBox={`0 0 ${cols * 16} ${rows * 16}`} preserveAspectRatio="xMaxYMid meet">
        {Array.from({ length: cols * rows }, (_, i) => (
          <circle
            key={i}
            cx={(i % cols) * 16 + 8}
            cy={Math.floor(i / cols) * 16 + 8}
            r={5}
            className={`look-fade ${p.running && i === lit - 1 ? "look-breathe" : ""}`}
            fill={i < lit ? p.tint : "var(--color-fill-2)"}
          />
        ))}
      </svg>
    </div>
  );
}

/** Seven segment rectangles in a 10 x 18 box. */
const SEGMENT_RECTS: Record<string, [number, number, number, number]> = {
  a: [1.6, 0, 6.8, 2],
  b: [8, 1.4, 2, 6.9],
  c: [8, 9.7, 2, 6.9],
  d: [1.6, 16, 6.8, 2],
  e: [0, 9.7, 2, 6.9],
  f: [0, 1.4, 2, 6.9],
  g: [1.6, 8, 6.8, 2],
};

/** Retro clock: glowing seven segment digits over their unlit ghosts, a blinking colon, mode and percent like an LCD. */
function Retro(p: LookProps) {
  const text = lookText("retro", p.remaining);
  let x = 0;
  const parts = [...text].map((c) => {
    const at = x;
    x += c === ":" ? 6 : 13;
    return { c, at };
  });
  const width = x - 3;
  const height = p.h * 0.86;
  return (
    <div className="flex min-w-0 flex-1 items-center" style={{ gap: p.h * 0.3, color: p.tint }}>
      <svg width={((width + 2) / 20) * height} height={height} viewBox={`-1 -1 ${width + 2} 20`} className="shrink-0" role="img" aria-label={text}>
        <g transform="skewX(-6) translate(1.5 0)">
          {parts.map(({ c, at }, i) =>
            c === ":" ? (
              <g key={i} className={p.running ? "look-blink" : undefined} fill="currentColor">
                <circle cx={at + 1.5} cy={5.5} r={1.3} />
                <circle cx={at + 1.5} cy={12.5} r={1.3} />
              </g>
            ) : (
              <g key={i} transform={`translate(${at} 0)`}>
                {Object.entries(SEGMENT_RECTS).map(([seg, [sx, sy, sw, sh]]) => {
                  const on = SEGMENTS[c]?.includes(seg);
                  return (
                    <rect
                      key={seg}
                      x={sx}
                      y={sy}
                      width={sw}
                      height={sh}
                      rx={1}
                      fill="currentColor"
                      opacity={on ? 1 : 0.08}
                      className={on ? "look-glow" : undefined}
                    />
                  );
                })}
              </g>
            ),
          )}
        </g>
      </svg>
      <div className="look-mono flex min-w-0 flex-col leading-tight font-semibold tracking-[0.12em] uppercase" style={{ fontSize: Math.max(8, p.h * 0.21) }}>
        <span className="truncate">{modeName(p.mode)}</span>
        <span className="tabular opacity-50">{percent(p)}%</span>
      </div>
    </div>
  );
}

/** Focus terminal: a prompt with the time and a blinking block cursor, an ASCII progress bar below. */
function Terminal(p: LookProps) {
  return (
    <div className="look-mono flex min-w-0 flex-1 flex-col justify-center overflow-hidden whitespace-nowrap" style={{ color: p.tint, gap: p.h * 0.1 }}>
      <div className="leading-none font-semibold" style={{ fontSize: p.h * 0.52 }}>
        <span className="text-label-3">$ </span>
        {lookText("terminal", p.remaining)}
        <span
          className={`ml-[0.12em] inline-block align-[-0.08em] ${p.running ? "look-blink" : ""}`}
          style={{ width: "0.55em", height: "0.9em", backgroundColor: "currentColor" }}
        />
      </div>
      <div className="leading-none text-label-2" style={{ fontSize: Math.max(8, p.h * 0.24) }}>
        {modeName(p.mode).toLowerCase()} {terminalBar(p.remaining, p.duration, Math.round(p.h * 0.4))} {percent(p)}%
      </div>
    </div>
  );
}

/** Zen: thin minutes only, a breathing ring, and a single dot drifting along a hairline. */
function Zen(p: LookProps) {
  const z = zenParts(p.remaining);
  const r = 15;
  const circ = 2 * Math.PI * r;
  const left = 1 - progressOf(p.remaining, p.duration);
  return (
    <div className="flex min-w-0 flex-1 items-center" style={{ gap: p.h * 0.36 }}>
      <svg width={p.h * 0.86} height={p.h * 0.86} viewBox="0 0 36 36" className="shrink-0 -rotate-90">
        <circle cx={18} cy={18} r={r} fill="none" stroke="var(--color-fill-2)" strokeWidth={1.5} />
        <circle
          cx={18}
          cy={18}
          r={r}
          fill="none"
          stroke={p.tint}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - left)}
          className="look-fade"
          style={{ transitionProperty: "stroke-dashoffset" }}
        />
        <circle cx={18} cy={18} r={4} fill={p.tint} opacity={0.8} className={p.running ? "look-breathe" : undefined} />
      </svg>
      <span className="flex shrink-0 items-baseline" style={{ gap: p.h * 0.1 }}>
        <span className="tabular leading-none tracking-[-0.03em] text-label" style={{ fontSize: p.h * 0.91, fontWeight: 200 }}>
          {z.value}
        </span>
        <span className="text-label-3" style={{ fontSize: Math.max(9, p.h * 0.28) }}>
          {z.unit}
        </span>
      </span>
      <div className="relative h-px min-w-0 flex-1 bg-fill-2">
        {/* The track-wide layer moves (a transform, % of its own width = the track), the dot sits at its left edge. */}
        <span className="look-fade absolute inset-0" style={{ transform: `translateX(${(1 - left) * 100}%)`, transitionProperty: "transform" }}>
          <span className="absolute top-1/2 left-0 rounded-full" style={{ width: 5, height: 5, marginLeft: -2.5, marginTop: -2.5, backgroundColor: p.tint }} />
        </span>
      </div>
    </div>
  );
}

/** Cyber HUD: a segmented ring, the time in tenths inside corner brackets with a scan line, mode and percent. */
function Hud(p: LookProps) {
  const segments = 24;
  const lit = litCells(p.remaining, p.duration, segments);
  const corner = Math.max(4, p.h * 0.16);
  const brackets = [
    "top-0 left-0 border-t border-l",
    "top-0 right-0 border-t border-r",
    "bottom-0 left-0 border-b border-l",
    "bottom-0 right-0 border-b border-r",
  ];
  return (
    <div className="look-mono flex min-w-0 flex-1 items-center" style={{ gap: p.h * 0.28, color: p.tint }}>
      <svg width={p.h * 0.86} height={p.h * 0.86} viewBox="-20 -20 40 40" className="shrink-0">
        {Array.from({ length: segments }, (_, i) => (
          <rect
            key={i}
            x={-1.3}
            y={-18.5}
            width={2.6}
            height={6}
            rx={0.6}
            transform={`rotate(${(i * 360) / segments})`}
            fill={i < lit ? "currentColor" : "var(--color-fill-2)"}
            className={`look-fade ${i < lit ? "look-glow" : ""}`}
          />
        ))}
        <circle r={7} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={0.8} strokeDasharray="2 2" />
      </svg>
      <div className="relative shrink-0 overflow-hidden" style={{ padding: `${p.h * 0.08}px ${p.h * 0.16}px` }}>
        {brackets.map((b) => (
          <span key={b} className={`absolute ${b}`} style={{ width: corner, height: corner, borderColor: "currentColor" }} />
        ))}
        {p.running && <span className="look-scan" />}
        <div className="look-glow leading-none font-semibold whitespace-nowrap" style={{ fontSize: p.h * 0.5 }}>
          <span className="opacity-60" style={{ fontSize: "0.45em" }}>
            T-
          </span>
          {lookText("hud", p.remaining)}
        </div>
      </div>
      <div className="flex min-w-0 flex-col leading-tight tracking-[0.14em] uppercase" style={{ fontSize: Math.max(8, p.h * 0.2) }}>
        <span className="truncate">{modeName(p.mode)}</span>
        <span className="tabular opacity-50">{String(percent(p)).padStart(3, "0")}%</span>
      </div>
    </div>
  );
}
