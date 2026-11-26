// Crest's own glyphs, shared by the bar's Stato, the quick panel and Overview. Solid shapes on a 16 grid, every straight edge on a
// whole unit so it stays sharp at 100 % and 200 %; the shapes and their rules live in glyphModel.ts.

import { useId, type ReactNode } from "react";
import { viewMetrics } from "../notch/viewZoom";
import {
  BATTERY_BOLT,
  BATTERY_FILL,
  BATTERY_W,
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
  VEIN,
  WAVE_W,
  WAVES,
  batteryFill,
  batteryShape,
  batteryWidth,
  speakerBody,
  speakerWaves,
  strip,
  wifiLit,
  type BatteryTint,
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

/** A linear part: a stroke 2 wide with round ends, or `width` (the speaker's thin waves). */
function Line({ d, opacity, width = 2 }: { d: string; opacity?: number; width?: number }) {
  return <path d={d} fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" opacity={opacity} />;
}

/** `children` with each cut [path, width, filled] taken out, so what is drawn over a cut stands apart from it by a gap. */
function Knock({ cuts, width = 16, children }: { cuts: [string, number, boolean][]; width?: number; children: ReactNode }) {
  const id = svgId("k", useId());
  return (
    <>
      <mask id={id}>
        <rect width={width} height="16" fill="#fff" />
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

/** The speaker as on a Mac, with a wave per volume step, or muted a slash through it, cut out of the body with a gap. Its box is
 *  drawn for the screen's device pixels (speakerBody), so a scale change redraws it through viewMetrics. */
export function SpeakerGlyph({ glyph, size }: { glyph: "muted" | "low" | "mid" | "high"; size: number }) {
  const { dpr } = viewMetrics.use();
  const body = <path d={speakerBody(size * dpr)} />;
  return (
    <Svg size={size}>
      {glyph === "muted" ? (
        <>
          <Knock cuts={[[MUTE, WAVE_W + 1.5, false]]}>{body}</Knock>
          <Line d={MUTE} width={WAVE_W} />
        </>
      ) : (
        body
      )}
      {WAVES.slice(0, speakerWaves(glyph)).map((d) => (
        <Line key={d} d={d} width={WAVE_W} />
      ))}
    </Svg>
  );
}

/**
 * The battery as on an iPhone, wider than the other glyphs: the outline, the charge a fill inside it with a gap all round, the cap
 * on the right, and while charging a bolt across the body cut out of both with a gap. `tint` colours all of it (batteryTint), else
 * it takes the text's colour. The level's edge lies on a device pixel, so a scale change redraws it through viewMetrics.
 */
export function BatteryGlyph({ percent, charging, tint, size }: { percent: number | null; charging: boolean; tint: BatteryTint; size: number }) {
  const { dpr } = viewMetrics.use();
  const [x0, y0, x1, y1] = BATTERY_FILL;
  const w = batteryFill(percent, size * dpr);
  const { shell, cap, cut } = batteryShape(size * dpr);
  const shape = (
    <>
      <path d={shell} fillRule="evenodd" />
      <path d={cap} />
      {!!w && <path d={strip(x0, y0, x1, y1, x0, x0 + w)} />}
    </>
  );
  return (
    <svg width={batteryWidth(size)} height={size} viewBox={`0 0 ${BATTERY_W} 16`} preserveAspectRatio="xMinYMid meet" fill={tint ? `var(--color-${tint})` : "currentColor"} aria-hidden>
      {charging ? (
        <>
          <Knock cuts={[[BATTERY_BOLT, cut, true]]} width={BATTERY_W}>
            {shape}
          </Knock>
          <path d={BATTERY_BOLT} />
        </>
      ) : (
        shape
      )}
    </svg>
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
