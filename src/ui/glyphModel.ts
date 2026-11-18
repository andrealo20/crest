// The rules of Crest's glyphs, pure. glyphs.tsx draws them on a 16 grid with 1 px strokes whose centres sit on half pixels, so at
// 200 % every straight edge lands on a whole pixel.

/** The network glyph: the cable, Wi-Fi off, on with no network, its signal in four steps, or no network at all. */
export type NetGlyphName = "wired" | "wifi-off" | "wifi-unlinked" | "wifi-0" | "wifi-1" | "wifi-2" | "wifi-3" | "offline";

/** The y of the fan's apex, where the arcs are centred. */
export const FAN_APEX_Y = 14;
/** The fan's three arcs, inner to outer; each top (FAN_APEX_Y - r) sits on a half pixel. */
export const FAN_RADII = [4.5, 7.5, 10.5] as const;

/** Which parts of the Wi-Fi fan are lit: the wedge and the first `arcs` arcs; the rest are dimmed. */
export function wifiLit(g: NetGlyphName): { wedge: boolean; arcs: number } {
  const n = ({ "wifi-0": 0, "wifi-1": 1, "wifi-2": 2, "wifi-3": 3 } as Partial<Record<NetGlyphName, number>>)[g];
  return n === undefined ? { wedge: false, arcs: 0 } : { wedge: true, arcs: n };
}

/** The speaker's waves: one per volume step, none when muted. */
export function speakerWaves(g: "muted" | "low" | "mid" | "high"): number {
  return { muted: 0, low: 1, mid: 2, high: 3 }[g];
}

/** The battery's fill width in px (0..9, half px steps), at least half a px while charge is left; full when the level is unknown. */
export function batteryFill(percent: number | null): number {
  if (percent === null) return 9;
  const w = Math.min(9, Math.max(0, Math.round((percent / 100) * 18) / 2));
  return percent > 0 ? Math.max(0.5, w) : w;
}
