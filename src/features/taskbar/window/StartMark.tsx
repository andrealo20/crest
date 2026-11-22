import { RocketLaunch, Sparkle, Star } from "../../../ui/iconset";
import { CrestMark } from "../../../ui/CrestMark";
import { WindowsMark } from "../../../ui/WindowsMark";
import type { StartIcon } from "../model";

const GLYPH = { rocket: RocketLaunch, sparkle: Sparkle, star: Star } as const;

/** The Start button's icon, in the text colour and in the box of `size` the Windows mark fills, so the bar does not move when it changes. */
export function StartMark({ icon, size, className }: { icon: StartIcon; size: number; className?: string }) {
  if (icon === "windows") return <WindowsMark size={size} className={className} />;
  // The C's own bounds (cells 233..791 x 160..864), so it fills the box as the Windows mark does.
  if (icon === "crest") return <CrestMark size={size} className={className} viewBox="160 160 704 704" />;
  if (icon === "dots")
    return (
      <svg width={size} height={size} viewBox="0 0 12 12" className={className} aria-hidden fill="currentColor">
        {[1.5, 6, 10.5].flatMap((y) => [1.5, 6, 10.5].map((x) => <circle key={`${x},${y}`} cx={x} cy={y} r="1.5" />))}
      </svg>
    );
  const G = GLYPH[icon];
  return <G size={size} weight="fill" className={className} aria-hidden />;
}
