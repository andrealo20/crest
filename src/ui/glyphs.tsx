// Crest's own glyphs, shared by the bar's Stato, the quick panel and Overview. Solid shapes on a 16 grid, every straight edge on a
// whole unit so it stays sharp at 100 % and 200 %; the shapes and their rules live in glyphModel.ts.

import { useId, type ReactNode } from "react";
import { viewMetrics } from "../notch/viewZoom";
import {
  BATTERY_BODY,
  BATTERY_BOLT,
  BATTERY_CAP,
  BATTERY_DASH,
  BATTERY_W,
  BODY_BOLT,
  DIM,
  FAN_ARCS,
  FAN_WEDGE,
  GLOBE,
  LEAF,
  MERIDIAN,
  MONITOR,
  MUTE,
  NUMBER_SIZE,
  PLANE,
  RUNE,
  SLASH,
  SPEAKER,
  VEIN,
  WAVES,
  batteryDigits,
  batteryScale,
  batteryTint,
  batteryWideFill,
  batteryWidth,
  speakerWaves,
  strip,
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

/**
 * The battery, wider than the other glyphs, its charge written in it: the body lit as far as the level and dimmed beyond (red when
 * it warns, else green in Energy saver), the cap lit only at 100, a bolt in the cap's place while charging. Drawn for the screen's
 * device pixels, so a scale change redraws it through viewMetrics.
 */
export function BatteryGlyph({ percent, charging, warning, saver = false, size }: { percent: number | null; charging: boolean; warning: boolean; saver?: boolean; size: number }) {
  const { dpr } = viewMetrics.use();
  const id = useId();
  const [x0, y0, x1, y1] = BATTERY_BODY;
  const { number, cut, baseline } = batteryScale(size * dpr);
  const w = batteryWideFill(percent, size * dpr);
  const tint = batteryTint(warning, saver);
  const fill = tint ? `var(--color-${tint})` : undefined;
  const part = (a: number, b: number, dimmed: boolean) => <path d={strip(x0, y0, x1, y1, a, b)} fill={fill} opacity={dimmed ? DIM : undefined} />;
  const inBody = charging && !number;
  let body: ReactNode;
  if (w === null) {
    // Unknown: the dimmed body and, in the number's place, the dash in a cut like the digits'; not with the bolt in the body.
    body = part(x0, x1, true);
    if (!inBody)
      body = (
        <>
          <Knock cuts={[[BATTERY_DASH, 2 * cut, true]]} width={BATTERY_W}>
            {body}
          </Knock>
          <path d={BATTERY_DASH} />
        </>
      );
  } else {
    body = (
      <>
        {w > 0 && part(x0, x0 + w, false)}
        {w < 20 && part(x0 + w, x1, true)}
      </>
    );
    if (number && percent !== null) {
      // A digit cut out of the body, or written in the ink in a cut all round: the level's edge stays exact.
      const digits = batteryDigits(percent, w, tint !== null);
      const text = (i: number, attrs: { fill?: string; stroke?: string; strokeWidth?: number; strokeLinejoin?: "round" }) => (
        <text
          key={i}
          x={digits[i].x}
          y={baseline}
          fontSize={NUMBER_SIZE}
          textAnchor="middle"
          fontFamily="'Inter Variable', sans-serif"
          fontWeight={700}
          style={{ fontVariantNumeric: "tabular-nums" }}
          {...attrs}
        >
          {digits[i].d}
        </text>
      );
      const mask = svgId("k", id);
      body = (
        <>
          <mask id={mask}>
            <rect width={BATTERY_W} height="16" fill="#fff" />
            {digits.map((g, i) => text(i, g.inked ? { fill: "#000", stroke: "#000", strokeWidth: 2 * cut, strokeLinejoin: "round" } : { fill: "#000" }))}
          </mask>
          <g mask={`url(#${mask})`}>{body}</g>
          {digits.map((g, i) => g.inked && text(i, {}))}
        </>
      );
    }
  }
  if (inBody) {
    // The bolt cut out of the body and lit again right of the level's edge, so nothing is drawn twice.
    const edge = x0 + (w ?? 0);
    const clip = svgId("c", id);
    body = (
      <>
        <Knock cuts={[[BODY_BOLT, 0, true]]} width={BATTERY_W}>
          {body}
        </Knock>
        {edge < x1 && (
          <>
            <clipPath id={clip}>
              <rect x={edge} width={BATTERY_W} height="16" />
            </clipPath>
            <path d={BODY_BOLT} clipPath={`url(#${clip})`} />
          </>
        )}
      </>
    );
  }
  return (
    <svg width={batteryWidth(size)} height={size} viewBox={`0 0 ${BATTERY_W} 16`} preserveAspectRatio="xMinYMid meet" fill="currentColor" aria-hidden>
      {body}
      {charging && !inBody ? <path d={BATTERY_BOLT} /> : <path d={BATTERY_CAP} opacity={w === 20 ? undefined : DIM} />}
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
