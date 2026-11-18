// The bar's glass (BarGlass.tsx): its shapes over the live copy, with the thin glass of the notch's closed shapes (shader.ts MAIN_FS).

import { GLASS_GLSL } from "../../../notch/glass/shader.ts";
import { LOOK } from "../look.ts";

/** The shapes the shader draws as glass: as many as the tiles (look.ts LOOK.maxTiles), the rest keep their CSS surface. */
export const MAX_RECTS = LOOK.maxTiles;

/**
 * The shapes (look.ts glassShapes) as rounded boxes, bent along the rim and blurred in the middle, under one veil, with the rim light
 * and the outline. No inner shadow, as on the closed notch: the icons run close to the rim. Premultiplied, like MAIN_FS.
 */
export const BAR_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;        // the live copy, BGRA bytes uploaded as RGBA, its mips the blur pyramid
uniform vec2 uRes;             // canvas, device px
uniform float uDpr;            // device px per CSS px
uniform vec2 uTexScale;        // uv = p * uTexScale + uTexOffset (params.ts textureMap)
uniform vec2 uTexOffset;
uniform vec4 uRects[${MAX_RECTS}];      // x, y, w, h, CSS px in the canvas
uniform int uCount;
uniform float uRadius;         // the corners, at most half the box's shorter side
uniform float uBand;           // the rim that bends (params.ts GLASS.closedBand)
uniform float uThick;          // the glass's thickness for the bend (GLASS.closedThick)
uniform float uMaxShift;       // lower with reduced motion, times Refraction
uniform vec2 uLod;             // blur level at the rim and in the middle, with Frost (params.ts lodFor)
uniform vec4 uVeil;            // --glass-tint's colour, and the veil after the bar's Transparency (look.ts barVeil)
uniform vec4 uRim;             // --glass-rim, its strength times Rim light
uniform float uHair;           // the outline, stronger on light themes
uniform float uEdgeFade;       // 1: past the copy's zone the veil alone
out vec4 o;

${GLASS_GLSL}

float sdShapes(vec2 p) {
  float d = 1e9;
  for (int i = 0; i < ${MAX_RECTS}; i++) {
    if (i >= uCount) break;
    vec2 h = 0.5 * uRects[i].zw;
    d = min(d, sdRound(p, uRects[i].xy + h, h, min(uRadius, min(h.x, h.y))));
  }
  return d;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  float d = sdShapes(p);
  float cover = clamp(0.5 - d * uDpr, 0.0, 1.0);
  if (cover <= 0.0) { o = vec4(0.0); return; }

  float inward = max(-d, 0.0);
  float band = clamp(inward / uBand, 0.0, 1.0);
  vec2 g = vec2(0.0, 1.0);
  vec2 shift = vec2(0.0);
  float slope = 0.0;
  bool rim = inward < uBand + 2.0;
  if (rim) {
    const float h = 0.5;
    g = vec2(sdShapes(p + vec2(h, 0.0)) - sdShapes(p - vec2(h, 0.0)), sdShapes(p + vec2(0.0, h)) - sdShapes(p - vec2(0.0, h)));
    float gl = length(g);
    g = gl > 1e-5 ? g / gl : vec2(0.0, 1.0);
    shift = bend(inward, uBand, g, uThick, uMaxShift, slope);
  }
  vec2 uv = (p + shift) * uTexScale + uTexOffset;
  float lod = mix(uLod.x, uLod.y, smoothstep(0.0, 1.0, band));
  vec3 col = textureLod(uTex, uv, lod).bgr;
  // Clamped before the veil, so the veil's worst case stays a white or a black backdrop (themes.ts glassVeil).
  col = clamp(mix(vec3(luma(col)), col, SAT), 0.0, 1.0);
  col = mix(col, uVeil.rgb, uVeil.a);
  // Past the copy's zone, while a grown shape waits for its new one (live.ts), the veil alone, faded in over 4 px.
  if (uEdgeFade > 0.0) {
    vec2 m = min(uv, 1.0 - uv) / uTexScale;
    col = mix(uVeil.rgb, col, clamp(1.0 + min(m.x, m.y) / 4.0, 0.0, 1.0));
  }
  if (rim) {
    col += uRim.rgb * uRim.a * shine(g, slope, inward, band);
    col = mix(col, vec3(0.0), uHair * (1.0 - smoothstep(0.0, 1.0, inward * uDpr)));
  }
  o = vec4(clamp(col, 0.0, 1.0) * cover, cover);
}`;
