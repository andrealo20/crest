// Crest's own glyphs, shared by the bar's Stato, the quick panel and Overview. Solid shapes on a 16 grid, every straight edge on a
// whole unit so it stays sharp at 100 % and 200 %; the shapes and their rules live in glyphModel.ts.

import { useId, type ReactNode } from "react";
import {
  DIM,
  FAN_ARCS,
  FAN_WEDGE,
  GLOBE,
  LEAF,
  MERIDIAN,
  MONITOR,
  MUTE,
  PLANE,
  RUNE,
  SLASH,
  SPEAKER,
  VEIN,
  WAVES,
  batteryFill,
  speakerWaves,
  wifiLit,
  type NetGlyphName,
} from "./glyphModel";

/** A per instance id `url(#...)` can take: useId's characters are not all valid there. */
const svgId = (prefix: string, id: string) => `${prefix}${id.replace(/[^\w-]/g, "")}`;

function Svg({ size, className, children }: { size: number; className?: string; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      {children}
    </svg>
  );
}

/** A linear part: a stroke 2 wide with round ends. */
function Line({ d, opacity }: { d: string; opacity?: number }) {
  return <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={opacity} />;
}

/** `children` with each cut [path, width, filled] taken out, so what is drawn over a cut stands apart from it by a gap. */
function Knock({ cuts, children }: { cuts: [string, number, boolean][]; children: ReactNode }) {
  const id = svgId("k", useId());
  return (
    <>
      <mask id={id}>
        <rect width="16" height="16" fill="#fff" />
        {cuts.map(([d, w, filled]) => (
          <path key={d} d={d} fill={filled ? "#000" : "none"} stroke="#000" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </mask>
      <g mask={`url(#${id})`}>{children}</g>
    </>
  );
}

/** The network: the Wi-Fi fan lit by its signal (dimmed while unlinked, slashed while off), the screen on its stand, or the slashed globe. */
export function NetGlyph({ glyph, size, className }: { glyph: NetGlyphName; size: number; className?: string }) {
  if (glyph === "wired")
    return (
      <Svg size={size} className={className}>
        <path d={MONITOR} fillRule="evenodd" />
      </Svg>
    );
  if (glyph === "offline")
    return (
      <Svg size={size} className={className}>
        <Knock cuts={[[MERIDIAN, 1, false], [SLASH, 4, false]]}>
          <path d={GLOBE} opacity={DIM} />
        </Knock>
        <Line d={SLASH} />
      </Svg>
    );
  const lit = wifiLit(glyph);
  const fan = (
    <>
      <path d={FAN_WEDGE} opacity={lit.wedge ? undefined : DIM} />
      {FAN_ARCS.map((d, i) => (
        <Line key={d} d={d} opacity={i < lit.arcs ? undefined : DIM} />
      ))}
    </>
  );
  return (
    <Svg size={size} className={className}>
      {glyph === "wifi-off" ? (
        <>
          <Knock cuts={[[SLASH, 4, false]]}>{fan}</Knock>
          <Line d={SLASH} />
        </>
      ) : (
        fan
      )}
    </Svg>
  );
}

/** The speaker with a wave per volume step, or a cross where the waves were when muted. */
export function SpeakerGlyph({ glyph, size }: { glyph: "muted" | "low" | "mid" | "high"; size: number }) {
  return (
    <Svg size={size}>
      <path d={SPEAKER} />
      {WAVES.slice(0, speakerWaves(glyph)).map((d) => (
        <Line key={d} d={d} />
      ))}
      {glyph === "muted" && <Line d={MUTE} />}
    </Svg>
  );
}

const BOLT = "M8.5 2.5L5 8.5H8L7 13.5L11 7H8Z";

/** The battery filled as far as its level (red when it warns), with a bolt cut into it while charging. */
export function BatteryGlyph({ percent, charging, warning, size }: { percent: number | null; charging: boolean; warning: boolean; size: number }) {
  const mask = svgId("bolt", useId());
  return (
    <Svg size={size}>
      <g fill="none" stroke="currentColor" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round">
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
      </g>
    </Svg>
  );
}

/** The Bluetooth rune, its spine on x 7. */
export function BluetoothGlyph({ size, className }: { size: number; className?: string }) {
  return (
    <Svg size={size} className={className}>
      <Line d={RUNE} />
    </Svg>
  );
}

/** Airplane mode: the plane from above, nose up. */
export function AirplaneGlyph({ size }: { size: number }) {
  return (
    <Svg size={size}>
      <path d={PLANE} />
    </Svg>
  );
}

/** Energy saver: the leaf with its vein cut through. */
export function SaverGlyph({ size }: { size: number }) {
  return (
    <Svg size={size}>
      <Knock cuts={[[VEIN, 1, false]]}>
        <path d={LEAF} />
      </Knock>
    </Svg>
  );
}
