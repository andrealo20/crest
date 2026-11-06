/*
 * Sun and moon from the standard low-precision formulas, offline and with no dependency:
 * the sun's declination and the equation of time as in NOAA's solar calculator (after
 * Meeus, Astronomical Algorithms, ch. 25), the moon's phase from Meeus ch. 48. Times come
 * out within a minute or two for the sun and about 1 % of illumination for the moon, which
 * is plenty for a glance at a notch. Pure: every function takes the instant it is asked about.
 */

const RAD = Math.PI / 180;
const DAY = 86_400_000;
const MIN = 60_000;
const sin = (deg: number) => Math.sin(deg * RAD);
const cos = (deg: number) => Math.cos(deg * RAD);
const norm = (deg: number) => ((deg % 360) + 360) % 360;

/** Julian centuries since J2000.0 for a Unix time in ms. */
const centuries = (ms: number) => (ms / DAY + 2440587.5 - 2451545) / 36525;

/** The sun's declination in degrees and the equation of time in minutes. */
export function sunPosition(ms: number): { declination: number; eqTime: number } {
  const T = centuries(ms);
  const L0 = norm(280.46646 + T * (36000.76983 + T * 0.0003032));
  const M = norm(357.52911 + T * (35999.05029 - T * 0.0001537));
  const e = 0.016708634 - T * (0.000042037 + T * 0.0000001267);
  const C = sin(M) * (1.914602 - T * (0.004817 + T * 0.000014)) + sin(2 * M) * (0.019993 - T * 0.000101) + sin(3 * M) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * sin(omega);
  const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * cos(omega);
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTime = (4 * (y * sin(2 * L0) - 2 * e * sin(M) + 4 * e * y * sin(M) * cos(2 * L0) - 0.5 * y * y * sin(4 * L0) - 1.25 * e * e * sin(2 * M))) / RAD;
  return { declination: Math.asin(sin(eps) * sin(lambda)) / RAD, eqTime };
}

/**
 * When the sun's centre crosses `elevation` degrees on the solar day that starts at the UTC
 * midnight `mid`: going up (`side` -1) or down (+1). "above" / "below" when it never does that
 * day because it stays higher / lower (midnight sun, polar night).
 */
function crossing(mid: number, lat: number, lon: number, elevation: number, side: -1 | 1): number | "above" | "below" {
  let t = mid + (720 - 4 * lon) * MIN; // Solar noon to begin with, then refined with the sun's place at the crossing itself.
  for (let i = 0; i < 3; i++) {
    const { declination, eqTime } = sunPosition(t);
    const c = (sin(elevation) - sin(lat) * sin(declination)) / (cos(lat) * cos(declination));
    if (c <= -1) return "above";
    if (c >= 1) return "below";
    t = mid + (720 - 4 * lon - eqTime + side * 4 * (Math.acos(c) / RAD)) * MIN;
  }
  return t;
}

export interface SunDay {
  sunrise: number | null;
  sunset: number | null;
  /** Golden hour as [start, end]: the sun between 4 degrees below and 6 degrees above the horizon. Null where the sun never gets that far. */
  goldenMorning: [number, number] | null;
  goldenEvening: [number, number] | null;
  /** The sun stays up ("day": no sunset) or down ("night": no sunrise) the whole day. */
  polar: "day" | "night" | null;
}

/**
 * The sun for the local day from `from` to `to` (ms, the caller's own midnights, so a 23 or 25 hour
 * day is fine) at a place; latitude north and longitude east are positive. The solar day whose noon
 * lies nearest the middle of that span is the one reported.
 */
export function sunDay(from: number, to: number, lat: number, lon: number): SunDay {
  lat = Math.max(-89.9, Math.min(89.9, lat)); // At the pole itself the hour angle is undefined.
  const middle = (from + to) / 2;
  const base = Math.floor(middle / DAY) * DAY;
  const noon = (d: number) => d + (720 - 4 * lon) * MIN;
  const mid = [base - DAY, base, base + DAY].reduce((a, b) => (Math.abs(noon(b) - middle) < Math.abs(noon(a) - middle) ? b : a));
  const at = (elevation: number, side: -1 | 1) => crossing(mid, lat, lon, elevation, side);
  const num = (v: number | "above" | "below"): number | null => (typeof v === "number" ? v : null);

  const rise = at(-0.833, -1);
  const set = at(-0.833, 1);
  const pair = (a: number | "above" | "below", b: number | "above" | "below"): [number, number] | null => (typeof a === "number" && typeof b === "number" ? [a, b] : null);
  return {
    sunrise: num(rise),
    sunset: num(set),
    goldenMorning: pair(at(-4, -1), at(6, -1)),
    goldenEvening: pair(at(6, 1), at(-4, 1)),
    polar: rise === "above" ? "day" : rise === "below" ? "night" : null,
  };
}

export type MoonPhaseName = "new" | "waxing-crescent" | "first-quarter" | "waxing-gibbous" | "full" | "waning-gibbous" | "last-quarter" | "waning-crescent";

export interface Moon {
  /** The lit share of the disc, 0 to 1. */
  fraction: number;
  /** Moon and sun angle apart as seen from Earth: 0 new, 90 first quarter, 180 full, 270 last quarter. */
  angle: number;
  waxing: boolean;
  phase: MoonPhaseName;
}

export function moonPhase(ms: number): Moon {
  const T = centuries(ms);
  const D = norm(297.8501921 + T * (445267.1114034 + T * (-0.0018819 + T * (1 / 545868 - T / 113065000))));
  const M = norm(357.5291092 + T * (35999.0502909 + T * (-0.0001536 + T / 24490000)));
  const Mp = norm(134.9633964 + T * (477198.8675055 + T * (0.0087414 + T * (1 / 69699 - T / 14712000))));
  // The phase angle i (180 at new moon, 0 at full): the mean elongation with the largest corrections for the moon's uneven orbit.
  const i = 180 - D - 6.289 * sin(Mp) + 2.1 * sin(M) - 1.274 * sin(2 * D - Mp) - 0.658 * sin(2 * D) - 0.214 * sin(2 * Mp) - 0.11 * sin(D);
  const angle = norm(180 - i);
  // The principal phases get about a day each, the rest of the cycle is split between crescent and gibbous.
  const phase: MoonPhaseName =
    angle < 10 || angle >= 350 ? "new"
    : angle < 80 ? "waxing-crescent"
    : angle < 100 ? "first-quarter"
    : angle < 170 ? "waxing-gibbous"
    : angle < 190 ? "full"
    : angle < 260 ? "waning-gibbous"
    : angle < 280 ? "last-quarter"
    : "waning-crescent";
  return { fraction: (1 + cos(i)) / 2, angle, waxing: angle < 180, phase };
}
