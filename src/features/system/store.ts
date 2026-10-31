import { useEffect } from "react";
import { createStore } from "../../lib/store";
import { rowVisible } from "../../notch/row/visibility";
import { fetchSystem, type SystemStats } from "../../platform/services";
import { settings } from "../../settings/store";
import { fullscreen, gamingLive } from "./gaming";

/** 60 values = one minute of history at one value per second. */
export const HISTORY = 60;

export type SystemKey = "cpu" | "mem" | "gpu" | "ping";

export interface SystemState {
  stats: SystemStats | null;
  history: Record<SystemKey, number[]>;
  /** Counts polls (restarts the history's glide animation). */
  tick: number;
}

/**
 * Runs in the background from app start (not only while the tool is open), so the
 * history is a minute long when opened and gaming mode shares the same values.
 * Only pauses when neither the Hardware tool, gaming mode nor readings in the closed row are on.
 *
 * Three rhythms, slow ones filled in linearly so the history keeps one value per second:
 * - shown (Hardware tool open): everything once a second;
 * - GPU reading in the closed row (or gaming there): CPU, RAM and GPU every 2 s, without waking the ping;
 * - background: CPU and RAM every 3 s; GPU and ping stay gaps (their counters are the expensive part).
 */
export const system = createStore<SystemState>({ stats: null, history: { cpu: [], mem: [], gpu: [], ping: [] }, tick: 0 });

const SHOWN_MS = 1000;
const GPU_MS = 2000;
const BACKGROUND_MS = 3000;

let timer: ReturnType<typeof setInterval> | null = null;
let timerMs = 0;
/** Mounted views that show the values (see `useSystemShown`). */
const shown = createStore(0);

/** When the last answer came (performance.now()), so the history gains one value per second that really passed. */
let lastAnswer: number | null = null;

function poll(ms: number) {
  const full = ms === SHOWN_MS, gpu = ms === GPU_MS;
  void fetchSystem(full, gpu).then((next) => {
    // Seconds since the last answer, at most one poll's worth: a rhythm switch right after an answer adds nothing, a long pause no more than one poll.
    const at = performance.now(), steps = lastAnswer === null ? 1 : Math.min(ms / SHOWN_MS, Math.round((at - lastAnswer) / SHOWN_MS));
    lastAnswer = at;
    system.set(({ stats, history: h, tick }) => {
      const mem = (next.memUsed / next.memTotal) * 100;
      // Linear from the previous value, so a slow poll still adds one value per second.
      const fill = (prev: number[], v: number) => {
        const from = prev.at(-1);
        if (steps === 1 || from === undefined || Number.isNaN(from)) return Array<number>(steps).fill(v);
        return Array.from({ length: steps }, (_, i) => from + ((v - from) * (i + 1)) / steps);
      };
      const push = (prev: number[], values: number[]) => [...prev, ...values].slice(-HISTORY);
      const gaps = Array<number>(steps).fill(Number.NaN);
      return {
        // Slower rhythms: keep the last numbers they skip for the first frame when opened.
        stats: full || !stats ? next : gpu ? { ...next, ping: stats.ping } : { ...next, gpu: stats.gpu, gpuMemUsed: stats.gpuMemUsed, ping: stats.ping },
        tick: steps > 0 ? tick + 1 : tick,
        history: {
          cpu: push(h.cpu, fill(h.cpu, next.cpu)),
          mem: push(h.mem, fill(h.mem, mem)),
          gpu: push(h.gpu, full || gpu ? fill(h.gpu, next.gpu ?? Number.NaN) : gaps),
          ping: push(h.ping, full ? Array<number>(steps).fill(next.ping ?? Number.NaN) : gaps),
        },
      };
    });
  });
}

function wanted(): boolean {
  const s = settings.get();
  return s.tools.some((x) => x.id === "system" && x.enabled) || s.gaming.mode !== "off" || (s.closed.parts.readings && rowVisible.get());
}

function rhythm(): number {
  if (shown.get() > 0) return SHOWN_MS;
  const s = settings.get();
  // Gaming puts the GPU in the row even with the readings part off.
  const gpu = rowVisible.get() && ((s.closed.parts.readings && s.closed.readings.gpu) || gamingLive(s.gaming.mode, fullscreen.get()));
  return gpu ? GPU_MS : BACKGROUND_MS;
}

function apply() {
  if (!wanted()) {
    if (timer) clearInterval(timer);
    timer = null;
    return;
  }
  const ms = rhythm();
  if (timer && timerMs === ms) return;
  if (timer) clearInterval(timer);
  // Switching rhythm: fresh values right away, not after the next tick.
  poll(ms);
  timer = setInterval(() => poll(ms), ms);
  timerMs = ms;
}

export function startSystemPolling() {
  apply();
  settings.subscribe(apply);
  shown.subscribe(apply);
  rowVisible.subscribe(apply);
  fullscreen.subscribe(apply);
}

/** For views that show the values: full polling once a second while mounted. */
export function useSystemShown() {
  useEffect(() => {
    shown.set((n) => n + 1);
    return () => shown.set((n) => n - 1);
  }, []);
}
