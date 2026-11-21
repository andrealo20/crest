/** The path of a ring's arc in a size x size box: a full turn from the top, or a sweep open at the bottom. */
export function arcPath(size: number, stroke: number, sweep: number): string {
  const c = size / 2;
  const r = (size - stroke) / 2;
  const at = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return `${+(c + r * Math.cos(a)).toFixed(2)},${+(c + r * Math.sin(a)).toFixed(2)}`;
  };
  // A single arc cannot end where it starts, so a full turn is two halves.
  if (sweep >= 360) return `M${at(-90)}A${r},${r} 0 1 1 ${at(90)}A${r},${r} 0 1 1 ${at(-90)}`;
  const start = 90 + (360 - sweep) / 2;
  return `M${at(start)}A${r},${r} 0 ${sweep > 180 ? 1 : 0} 1 ${at(start + sweep)}`;
}
