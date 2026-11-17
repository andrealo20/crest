/** Crest's mark in one colour (assets/logo/crest-mark-mono.svg): nine rounded squares forming a C, in the text colour. */
export function CrestMark({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" className={className} aria-hidden fill="currentColor">
      {CELLS.map(([x, y]) => (
        <rect key={`${x},${y}`} x={x} y={y} width="120" height="120" rx="28.8" />
      ))}
    </svg>
  );
}

const CELLS = [
  [379, 160],
  [525, 160],
  [671, 160],
  [233, 306],
  [233, 452],
  [233, 598],
  [379, 744],
  [525, 744],
  [671, 744],
] as const;
