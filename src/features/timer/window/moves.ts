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
