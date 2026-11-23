import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";
import { audioLevelsAvailable, subscribeLevels, subscribeSpectrum } from "../../platform/audio";
import { FRAME_MS, due, moved, rests } from "./pacing";
import { wavePath } from "./shapes";

/*
 * Four bars in the accent color, bass on the left, treble on the right. The Music tool can
 * also show 12 thinner bars (Spectrum) or a line through those 12 bands (Wave).
 *
 * One animation loop for every state, so nothing ever switches hard:
 * - Playing + real levels (WASAPI loopback, ~30 values/s): bars follow the sound.
 * - Silence on track change or seek: gentle "breathing" instead of dropping to zero.
 * - In the browser or without levels: the same soft motion, synthetic.
 * - Paused: bars glide to a calm, even height.
 * - Reduced motion: no capture and no loop, the bars just stand at a middle height while playing.
 * Values go straight to `transform` (no React render per frame) and are smoothed per
 * frame over time: fast attack, slower release, like an analog meter. The four bars draw
 * about 30 frames a second, Spectrum and Wave about 60 (pacing.ts); a move too small to
 * see is not written, and the loop sleeps while nothing moves.
 */
const MIN = 0.2;
const IDLE = 0.24;
/** Reduced motion: the bars' height while playing. */
const STILL = 0.6;
/** Smoothing time constants (s). */
const ATTACK = 0.045;
const RELEASE = 0.14;
const SETTLE = 0.18;
/** GSMTC briefly reports "paused" on seek/track change; ignore it for this long. */
const PAUSE_DEBOUNCE_MS = 320;
/** Keep the capture open briefly after pausing so resuming reacts instantly. */
export const RELEASE_CAPTURE_MS = 2000;
/** Levels older than this count as gone (audio.rs sends an unchanged one every 300 ms). */
const STALE_MS = 400;

/** Soft fake motion per bar (layered sine waves at different speeds). */
function synthetic(i: number, t: number): number {
  const a = Math.sin(t * (5.1 + i * 1.3) + i * 1.7);
  const b = Math.sin(t * (2.3 + i * 0.7) + i * 0.9);
  return 0.5 + 0.32 * a + 0.18 * b;
}

export type EqualizerLook = "bars" | "spectrum" | "wave";
const SPECTRUM_BANDS = 12;
const WAVE_WIDTH = 28;
const WAVE_STROKE = 1.75;

/**
 * `tint` = Tailwind background class for the bars (Discord: green instead of accent).
 * `look` is read once: give the element a `key` that changes with it.
 * `levels` false: no capture of the player's audio, only the synthetic motion (Discord's speaking indicator).
 */
export function Equalizer({ playing, height = 12, tint = "bg-accent", look = "bars", levels: follow = true }: { playing: boolean; height?: number; tint?: string; look?: EqualizerLook; levels?: boolean }) {
  const count = look === "bars" ? 4 : SPECTRUM_BANDS;
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const wave = useRef<SVGPathElement>(null);
  const playingRef = useRef(playing);
  const levels = useRef<{ values: readonly number[]; at: number } | null>(null);
  const wake = useRef<() => void>(() => {});
  const still = !!useReducedMotion();

  // Apply pause with a slight delay (flicker on seek), start immediately.
  useEffect(() => {
    if (playing) {
      playingRef.current = true;
      wake.current();
      return;
    }
    const id = window.setTimeout(() => {
      playingRef.current = false;
      wake.current();
    }, PAUSE_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [playing]);

  // Subscribe to real levels; unsubscribe with a delay after pausing.
  const off = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!audioLevelsAvailable || !follow) return;
    if (playing && !still) {
      const store = (values: readonly number[]) => {
        levels.current = { values, at: performance.now() };
        // Asleep on steady levels, the loop waits for the next ones.
        wake.current();
      };
      off.current ??= look === "bars" ? subscribeLevels(store) : subscribeSpectrum(store);
      return;
    }
    const id = window.setTimeout(() => {
      off.current?.();
      off.current = null;
    }, RELEASE_CAPTURE_MS);
    return () => window.clearTimeout(id);
  }, [playing, look, follow, still]);
  useEffect(
    () => () => {
      off.current?.();
      off.current = null;
    },
    [],
  );

  // Animation loop: draws while something moves, sleeps once every bar stands where it is heading and nothing moves it on its own
  // (paused and settled, reduced motion, steady real levels). New levels and a change of `playing` wake it.
  useEffect(() => {
    const value = Array<number>(count).fill(IDLE);
    const target = value.slice();
    // What each bar shows; -1 before the first frame, which writes every bar.
    const drawn = Array<number>(count).fill(-1);
    const every = FRAME_MS[look];
    let frame = 0;
    let stale = 0;
    let last = performance.now();
    let quiet = 0;

    const tick = (now: number) => {
      // Whole frames only (pacing.ts): the vsyncs in between pass without work.
      if (!due(now, last, every)) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const heard = levels.current;
      const live = heard && now - heard.at < STALE_MS ? heard.values : null;
      const sounding = !!live && Math.max(...live) > 0.06;
      // Silence while playing (track change, seek) → breathe gently after 150 ms.
      quiet = sounding ? 0 : quiet + dt;
      const breathe = Math.min(1, Math.max(0, (quiet - 0.15) / 0.35));
      const moving = playingRef.current && !still;

      let changed = false;
      for (let i = 0; i < count; i++) {
        let tau: number;
        if (!moving) {
          target[i] = playingRef.current ? STILL : IDLE;
          tau = SETTLE;
        } else {
          const real = live ? MIN + (1 - MIN) * live[i] : 0;
          const soft = MIN + (live ? 0.3 : 0.75) * synthetic(i, t);
          target[i] = live ? real * (1 - breathe) + soft * breathe : soft;
          tau = target[i] > value[i] ? ATTACK : RELEASE;
        }
        value[i] += (target[i] - value[i]) * (1 - Math.exp(-dt / tau));
        if (!moved(value[i], drawn[i])) continue;
        drawn[i] = value[i];
        changed = true;
        const bar = bars.current[i];
        if (bar) bar.style.transform = `scaleY(${value[i].toFixed(3)})`;
      }
      if (changed) wave.current?.setAttribute("d", wavePath(value, WAVE_WIDTH, height, WAVE_STROKE / 2 + 0.25));

      if (!rests(value, target, moving, sounding)) {
        frame = requestAnimationFrame(tick);
        return;
      }
      frame = 0;
      // Asleep on steady levels: should no more come, wake when they count as gone, to breathe.
      if (moving && heard) stale = window.setTimeout(wakeUp, heard.at + STALE_MS - now);
    };

    const wakeUp = () => {
      if (frame) return;
      window.clearTimeout(stale);
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    wake.current = wakeUp;
    wakeUp();
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(stale);
      wake.current = () => {};
    };
  }, [count, height, still, look]);

  if (look === "wave")
    return (
      <svg width={WAVE_WIDTH} height={height} className="overflow-visible" aria-hidden>
        <path
          ref={wave}
          d={wavePath(Array<number>(count).fill(IDLE), WAVE_WIDTH, height, WAVE_STROKE / 2 + 0.25)}
          fill="none"
          // The tint's colour token directly: Tailwind would not see a stroke class built from it at runtime.
          stroke={`var(--color-${tint.replace(/^bg-/, "")})`}
          strokeWidth={WAVE_STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transition: "stroke 400ms ease" }}
        />
      </svg>
    );
  // Spectrum: thinner bars, scaled from the middle like the four, so it reads as one family.
  return (
    <div className={`flex items-center ${look === "bars" ? "gap-[2px]" : "gap-[1px]"}`} style={{ height }} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            bars.current[i] = el;
          }}
          className={`h-full rounded-full ${look === "bars" ? "w-[2.5px]" : "w-[1.5px]"} ${tint}`}
          style={{ transform: `scaleY(${IDLE})`, transition: "background-color 400ms ease" }}
        />
      ))}
    </div>
  );
}
