// Adapted from LiquidGlassWindows (MIT, github.com/pxlkeshi/LiquidGlassWindows, Copyright (c) 2026 pxlkeshi), src/glass.rs at 4e2c03f:
// its lens, colour split, colour and rim light, with its constants in CSS px (glassPlus.ts). Licence text in licenses/LiquidGlassWindows-MIT.txt.

import { GLASS_GLSL } from "../../../notch/glass/shader.ts";
import { GLASS_PLUS } from "../glassPlus.ts";
import { MAX_RECTS } from "./glassShader.ts";

const f = (v: number) => v.toFixed(5);
const a = (GLASS_PLUS.light * Math.PI) / 180, lightX = f(Math.cos(a)), lightY = f(Math.sin(a));

/**
 * The bar's shapes as the widgets draw their glass: a radial lens along the edge, red and blue apart, almost no blur, more saturated and
 * darker, a rim light about one device px wide, and a veil that rises by itself over a light backdrop. Premultiplied, like BAR_FS.
 */
export const BAR_PLUS_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;        // the live copy, BGRA bytes uploaded as RGBA, sRGB-encoded, its mips the blur pyramid
uniform vec2 uRes;             // canvas, device px
uniform float uDpr;            // device px per CSS px
uniform vec2 uTexScale;        // uv = p * uTexScale + uTexOffset (params.ts textureMap)
uniform vec2 uTexOffset;
uniform vec4 uRects[${MAX_RECTS}];      // x, y, w, h, CSS px in the canvas (look.ts plusShapes)
uniform int uCount;
uniform float uRadius;         // the corners (look.ts barRadius), at most half the box's shorter side
uniform float uDocked;         // 1 for a docked bar: only its top edge bends
uniform vec2 uLens;            // the lens's strength (glassPlus.ts plusSliders) and the most it may shift, CSS px
uniform vec2 uLod;             // blur level at the rim and in the middle
uniform float uVeilLod;        // the coarse read's level, for the veil that rises by itself
uniform vec3 uTint;            // --glass-tint's colour, sRGB
uniform float uTarget;         // the luminance the glass shows at most over white (glassPlus.ts plusTarget)
uniform float uSpec;           // the rim light's strength
out vec4 o;

${GLASS_GLSL}

const float P_BAND = ${f(GLASS_PLUS.band)};
const float P_REACH = ${f(GLASS_PLUS.reach)};
const float P_CHROMA = ${f(GLASS_PLUS.chroma)};
const float P_DARKEN = ${f(GLASS_PLUS.darken)};
const float P_SAT = ${f(GLASS_PLUS.saturation)};
const vec2 P_LIGHT = vec2(${lightX}, ${lightY});
const float P_REFLECT = ${f(GLASS_PLUS.reflected)};
const float P_FOCUS = ${f(GLASS_PLUS.focus)};
const float P_HAIR = ${f(GLASS_PLUS.hairline)};
const float P_GLOW = ${f(GLASS_PLUS.glow)};
const float P_RIM = ${f(GLASS_PLUS.rim)};
const vec2 P_KNEE = vec2(${f(GLASS_PLUS.knee[0])}, ${f(GLASS_PLUS.knee[1])});

vec3 dec(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 enc(vec3 v) { v = clamp(v, 0.0, 1.0); return mix(v * 12.92, 1.055 * pow(v, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, v)); }
vec4 raw(vec2 q, float lod) { return textureLod(uTex, q * uTexScale + uTexOffset, lod); } // red is .b, blue .r

// The nearest shape (sdShapes' loop, keeping the closest): its centre c, half size h and corner r.
float nearest(vec2 p, out vec2 c, out vec2 h, out float r) {
  float d = 1e9;
  c = vec2(0.0); h = vec2(1.0); r = 0.0;
  for (int i = 0; i < ${MAX_RECTS}; i++) {
    if (i >= uCount) break;
    vec2 hi = 0.5 * uRects[i].zw, ci = uRects[i].xy + hi;
    float ri = min(uRadius, min(hi.x, hi.y)), di = sdRound(p, ci, hi, ri);
    if (di < d) { d = di; c = ci; h = hi; r = ri; }
  }
  return d;
}

// Outward: from the corner's centre in a corner, else the nearer side's (y on a tie).
vec2 edgeNormal(vec2 rel, vec2 h, float r) {
  vec2 s = vec2(rel.x < 0.0 ? -1.0 : 1.0, rel.y < 0.0 ? -1.0 : 1.0), q = abs(rel) - h + r;
  if (q.x > 0.0 && q.y > 0.0) return s * q / max(length(q), 1e-6);
  return q.x > q.y ? vec2(s.x, 0.0) : vec2(0.0, s.y);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 c, hs;
  float r;
  float d = nearest(p, c, hs, r);
  bool docked = uDocked > 0.5;
  if (docked) { d = c.y - hs.y - p.y; c.x = p.x; hs.x = 1e4; } // only the top edge
  float cover = clamp(0.5 - d * uDpr, 0.0, 1.0);
  if (cover <= 0.0) { o = vec4(0.0); return; }

  // The lens: in a band 0.3 of the shorter side, the backdrop pulled toward the centre along the radius, 1 - sqrt(1 - x^2).
  vec2 rel = p - c;
  float side = 2.0 * min(hs.x, hs.y), band = P_BAND * side, inward = max(-d, 0.0);
  float x = 1.0 - clamp(inward / band, 0.0, 1.0);
  vec2 dir = docked ? vec2(0.0, -1.0) : rel / max(length(rel), 1e-6);
  vec2 n = docked ? vec2(0.0, -1.0) : edgeNormal(rel, hs, r);
  vec2 reach = vec2(min(hs.x, P_REACH * hs.y), min(hs.y, P_REACH * hs.x));
  vec2 shift = -(1.0 - sqrt(max(1.0 - x * x, 0.0))) * dir * reach * uLens.x;
  // The guard: one level per halving of the backdrop squeezed across the edge into a device px, from the first device row in. Where the
  // pull runs along the edge it shears the backdrop and squeezes nothing, so the long bands' streaks stay sharp.
  float xa = 1.0 - clamp(max(inward, 0.5 / uDpr) / band, 0.0, 1.0);
  float rho = abs(1.0 - uLens.x * dot(dir * reach, n) * xa / max(sqrt(1.0 - xa * xa), 1e-3) / band);
  float sl = length(shift);
  if (sl > uLens.y) { shift *= uLens.y / sl; rho = 0.0; } // reduced motion: a few px, no fold
  float lod = max(mix(uLod.x, uLod.y, smoothstep(0.0, 1.0, 1.0 - x)), log2(max(rho, 1.0)));

  // Red and blue apart along the radius on every covered pixel; then saturation and the darkening, in linear light.
  vec2 q = clamp(p + shift, c - hs, c + hs);
  vec2 off = dir * smoothstep(0.0, 0.02, inward / side) * P_CHROMA;
  vec3 col = dec(vec3(raw(q - off, lod).b, raw(q, lod).g, raw(q + off, lod).r));
  float l = luma(col);
  col = clamp((l + (col - l) * P_SAT) * P_DARKEN, 0.0, 1.0);

  // The veil that rises by itself: over a light backdrop no lighter than Glass over white (uTarget), none over a dark one.
  vec3 tint = dec(uTint);
  float lc = luma(dec(raw(vec2(p.x, c.y), uVeilLod).bgr));
  float lg = P_DARKEN * mix(lc, 1.0, smoothstep(P_KNEE.x, P_KNEE.y, lc));
  col = mix(col, tint, clamp((lg - uTarget) / max(lg - luma(tint), 1e-4), 0.0, 1.0));
  // Past the copy's zone, while a grown shape waits for its new one, the tint alone over 4 px (as BAR_FS).
  vec2 uv = q * uTexScale + uTexOffset, m = min(uv, 1.0 - uv) / uTexScale;
  col = mix(tint, col, clamp(1.0 + min(m.x, m.y) / 4.0, 0.0, 1.0));

  // The rim light, about one device px, added toward white.
  if (x > 0.0) {
    float f = dot(n, P_LIGHT);
    float lobe = pow(max(f, 0.0), P_FOCUS) + P_REFLECT * pow(max(-f, 0.0), P_FOCUS);
    float lit = P_HAIR + (1.0 - P_HAIR) * min(lobe, 1.0);
    float t = inward * uDpr / P_RIM;
    float line = t < 8.0 ? 0.85 * exp(-t * t) + 0.15 * exp(-t) : 0.0;
    col += (1.0 - col) * min(uSpec * lit * (line + P_GLOW * lobe * x * x * x), 1.0);
  }
  o = vec4(enc(col) * cover, cover);
}`;
