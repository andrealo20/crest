// The wallpaper every window follows (Rust's `wallpaper://changed`) and the steps through the chosen source.

/** The next (1) or the previous (-1) picture of the source on every screen; rejects when there is none to step to. */
export function stepWallpaper(_by: 1 | -1): Promise<void> {
  return Promise.reject(new Error("unsupported"));
}
