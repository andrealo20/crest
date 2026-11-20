/** Where the user left the timer window: its physical top-left, and the page's pixel ratio there (monitor scale times Windows'
 * Text size), from which Rust works out the size the window had (timer_window.rs). */
export type Spot = { x: number; y: number; dpr?: number };

/** The spot saved under POS_KEY, or null when there is none or it is broken; a ratio that is not one is left out. */
export function readSpot(raw: string | null): Spot | null {
  try {
    const p = JSON.parse(raw ?? "null") as { x?: unknown; y?: unknown; dpr?: unknown } | null;
    if (!p || typeof p !== "object" || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    const spot: Spot = { x: p.x as number, y: p.y as number };
    if (typeof p.dpr === "number" && Number.isFinite(p.dpr) && p.dpr > 0) spot.dpr = p.dpr;
    return spot;
  } catch {
    return null;
  }
}

/**
 * Which moves of the timer window to save. Crest moves the window itself when Windows' Text size changes (timer_window.rs) and
 * announces the spot first: that move is not saved, so the saved spot stays the one the user chose and a reopen does not drift.
 */
export function savedMoves() {
  let announced: string | null = null;
  return {
    /** Crest is about to move the window here. */
    placed(x: number, y: number) {
      announced = `${x},${y}`;
    },
    /** Whether a move to (x, y) is the user's, to be saved. */
    save(x: number, y: number): boolean {
      const own = announced === `${x},${y}`;
      announced = null;
      return !own;
    },
  };
}
