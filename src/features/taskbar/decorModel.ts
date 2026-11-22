// The badges and progress apps report to the taskbar (taskband.rs), as a button shows them. Pure, so the rules are tested alone.

import type { Indicator, Win } from "./model.ts";

export type Progress = { state: "normal" | "paused" | "error" | "indeterminate"; value: number };
/** One window's decorations as Rust sends them: `overlay` keys a picture (`taskbar.decorImages`), `tip` is the overlay's text. */
export type Decor = { id: number; progress: Progress | null; overlay: string | null; tip: string };

/**
 * What a button shows of its windows' decorations: the overlay of the window in front if it has one, else of the first window that
 * has one; the progress of the first window that has one. A pinned app with no window has neither.
 */
export function buttonDecor(windows: Pick<Win, "id">[], decor: Record<number, Decor>, active: number | null): { overlay: { img: string; tip: string } | null; progress: Progress | null } {
  const of = windows.flatMap((w) => decor[w.id] ?? []);
  const shows = of.find((d) => d.id === active && d.overlay) ?? of.find((d) => d.overlay);
  return { overlay: shows?.overlay ? { img: shows.overlay, tip: shows.tip } : null, progress: of.find((d) => d.progress)?.progress ?? null };
}

/** The progress line takes the mark's place, but a window asking for attention keeps its pulsing mark. */
export const lineUnder = (mark: Indicator | undefined, progress: Progress | null): "mark" | "progress" => (progress && mark !== "attention" ? "progress" : "mark");
