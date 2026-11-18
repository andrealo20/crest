/** The Windows mark in one colour: four equal squares with a gap of a twelfth of the side, in the text colour. */
export function WindowsMark({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" className={className} aria-hidden fill="currentColor">
      <rect x="0" y="0" width="5.5" height="5.5" />
      <rect x="6.5" y="0" width="5.5" height="5.5" />
      <rect x="0" y="6.5" width="5.5" height="5.5" />
      <rect x="6.5" y="6.5" width="5.5" height="5.5" />
    </svg>
  );
}
