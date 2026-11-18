// Crest's own glyphs, shared by the bar's Stato, the quick panel and Overview. Drawn on a 16 grid with 1 px strokes whose centres
// sit on half pixels, so at 200 % every straight edge lands on a whole pixel; the rules live in glyphModel.ts.

import { useId, type CSSProperties, type ReactNode } from "react";
import { FAN_APEX_Y, FAN_RADII, batteryFill, speakerWaves, wifiLit, type NetGlyphName } from "./glyphModel";

const s = Math.SQRT1_2;
const f = (n: number) => +n.toFixed(3);
const DIM = 0.3;

/** An arc of radius r round (cx, cy), from its upper left to its upper right, at 45 degrees either side of the top. */
const arc = (cx: number, cy: number, r: number) => `M${f(cx - r * s)} ${f(cy - r * s)}A${r} ${r} 0 0 1 ${f(cx + r * s)} ${f(cy - r * s)}`;

function Svg({ size, className, style, children }: { size: number; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      style={style}
    >
      {children}
    </svg>
  );
}

/** The network: the Wi-Fi fan lit by its signal (dimmed while unlinked, slashed while off), the cable's screen, or the crossed globe. */
export function NetGlyph({ glyph, size, className }: { glyph: NetGlyphName; size: number; className?: string }) {
  if (glyph === "wired")
    return (
      <Svg size={size} className={className}>
        <rect x="2.5" y="2.5" width="10" height="8" rx="1" />
        <path d="M7.5 10.5V13.5M5.5 13.5H9.5" />
      </Svg>
    );
  if (glyph === "offline")
    return (
      <Svg size={size} className={className}>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M2.5 7.5H13.5" />
        <ellipse cx="8" cy="8" rx="2.5" ry="5.5" />
        <path d="M2.5 13.5L13.5 2.5" />
      </Svg>
    );
  const lit = wifiLit(glyph);
  const w = 2.5 * s;
  return (
    <Svg size={size} className={className}>
      <path
        d={`M8 ${FAN_APEX_Y}L${f(8 - w)} ${f(FAN_APEX_Y - w)}A2.5 2.5 0 0 1 ${f(8 + w)} ${f(FAN_APEX_Y - w)}Z`}
        fill="currentColor"
        stroke="none"
        opacity={lit.wedge ? undefined : DIM}
      />
      {FAN_RADII.map((r, i) => (
        <path key={r} d={arc(8, FAN_APEX_Y, r)} opacity={i < lit.arcs ? undefined : DIM} />
      ))}
      {glyph === "wifi-off" && <path d="M3.5 2.5L13.5 12.5" />}
    </Svg>
  );
}

/** The speaker with a wave per volume step, or crossed when muted. */
export function SpeakerGlyph({ glyph, size }: { glyph: "muted" | "low" | "mid" | "high"; size: number }) {
  const waves = speakerWaves(glyph);
  return (
    <Svg size={size}>
      <path d="M2.5 6.5H4.5L7.5 3.5V12.5L4.5 9.5H2.5Z" />
      {[3, 5, 7].slice(0, waves).map((r) => (
        <path key={r} d={`M${f(7.5 + r * s)} ${f(8 - r * s)}A${r} ${r} 0 0 1 ${f(7.5 + r * s)} ${f(8 + r * s)}`} />
      ))}
      {glyph === "muted" && <path d="M10.5 6L14.5 10M14.5 6L10.5 10" />}
    </Svg>
  );
}

const BOLT = "M8.5 2.5L5 8.5H8L7 13.5L11 7H8Z";

/** The battery filled as far as its level (red when it warns), with a bolt cut into it while charging. */
export function BatteryGlyph({ percent, charging, warning, size }: { percent: number | null; charging: boolean; warning: boolean; size: number }) {
  // useId's characters are not all valid in url(#...).
  const mask = `bolt${useId().replace(/[^\w-]/g, "")}`;
  return (
    <Svg size={size}>
      {charging && (
        <mask id={mask}>
          <rect width="16" height="16" fill="white" stroke="none" />
          <path d={BOLT} fill="black" stroke="black" strokeWidth={2} />
        </mask>
      )}
      <g mask={charging ? `url(#${mask})` : undefined}>
        <rect x="1.5" y="4.5" width="12" height="6" rx="1.5" />
        <rect x="14" y="6" width="1" height="3" fill="currentColor" stroke="none" />
        <rect x="3" y="6" width={batteryFill(percent)} height="3" rx="0.5" stroke="none" fill={warning ? "var(--color-red)" : "currentColor"} />
      </g>
      {charging && <path d={BOLT} fill="currentColor" stroke="none" />}
    </Svg>
  );
}

/** The Bluetooth rune, its spine on x 7.5. */
export function BluetoothGlyph({ size, className }: { size: number; className?: string }) {
  return (
    <Svg size={size} className={className}>
      <path d="M4.5 5.5L10.5 10.5L7.5 13.5V2.5L10.5 5.5L4.5 10.5" />
    </Svg>
  );
}
