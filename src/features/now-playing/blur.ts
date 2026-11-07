/**
 * Box blur of RGBA pixels in place, `passes` times (three passes come close to a Gaussian). Used on the tiny cover
 * behind the Music panel: blurred while tiny, it stretches into a smooth wash instead of visible squares.
 */
export function boxBlur(px: Uint8ClampedArray, w: number, h: number, r: number, passes = 3): void {
  const tmp = new Float32Array(px.length);
  const pass = (from: ArrayLike<number>, to: { [i: number]: number }, horizontal: boolean) => {
    const lines = horizontal ? h : w, len = horizontal ? w : h;
    const at = (line: number, i: number) => (horizontal ? line * w + i : i * w + line) * 4;
    for (let line = 0; line < lines; line++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        // The window starts centred on pixel 0, edges repeating the border pixel.
        for (let k = -r; k <= r; k++) sum += from[at(line, Math.min(len - 1, Math.max(0, k))) + c];
        for (let i = 0; i < len; i++) {
          to[at(line, i) + c] = sum / (2 * r + 1);
          sum += from[at(line, Math.min(len - 1, i + r + 1)) + c] - from[at(line, Math.max(0, i - r)) + c];
        }
      }
    }
  };
  for (let p = 0; p < passes; p++) {
    pass(px, tmp, true);
    pass(tmp, px, false);
  }
}
