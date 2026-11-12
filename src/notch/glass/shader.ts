// Adapted from WinIsland (GPL-3.0, github.com/WinIslandProject/WinIsland), crates/winisland-render/src/shaders/liquid.sksl at b0bdef0:
// the refraction step (normal from the profile slope, refract(), shift along the ray) and the rim light. The squircle profile is from
// kube.io, "Liquid Glass in the browser" (formula only); the downsample is Marius Bjorge's dual filter ("Bandwidth-Efficient Rendering",
// SIGGRAPH 2015).

/** One triangle over the whole canvas, without vertex buffers. */
const VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
  vec2 p = P[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

/** One level of the blur pyramid from the level above (bound alone through BASE_LEVEL and MAX_LEVEL). */
export const DOWN_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uStep;
in vec2 vUv;
out vec4 o;
void main() {
  vec4 s = texture(uSrc, vUv) * 4.0;
  s += texture(uSrc, vUv - uStep);
  s += texture(uSrc, vUv + uStep);
  s += texture(uSrc, vUv + vec2(uStep.x, -uStep.y));
  s += texture(uSrc, vUv - vec2(uStep.x, -uStep.y));
  o = s * 0.125;
}`;

/** The open panel as glass: the copy bent along the rim and blurred in the middle, under the theme's background as a veil. */
export const MAIN_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;        // the copy of the screen, BGRA bytes uploaded as RGBA, its mips the blur pyramid
uniform vec2 uRes;             // canvas, device px
uniform float uDpr;            // device px per CSS px of the shape
uniform vec2 uTexScale;        // uv = p * uTexScale + uTexOffset (params.ts textureMap)
uniform vec2 uTexOffset;
uniform vec4 uShape;           // body left, right, height, ear radius, CSS px in the canvas
uniform float uR;              // bottom corner radius
uniform float uBand;           // the rim that bends
uniform float uMaxShift;       // lower with reduced motion, times Refraction
uniform vec2 uLod;             // blur level at the rim and in the middle, with Frost (params.ts lodFor)
uniform vec4 uVeil;            // --glass-tint's colour, and the content's veil after Transparency (themes.ts glassVeilAt)
uniform float uVeilEdge;       // the side bands' veil after Transparency
uniform float uDock;           // DOCK_HEIGHT: the tool bar keeps the content's veil
uniform vec4 uBrow;            // --notch-closed and HEADER_HEIGHT
uniform vec4 uRim;             // --glass-rim, its strength times Rim light
uniform float uHair;           // the outline, stronger on light themes
out vec4 o;

const float IOR = 1.5;
const float SLOPE = 1.6;
const float THICK = 18.0;
const float SAT = 1.2;
const float SHADOW = 0.18;
const vec2 LIGHT = vec2(-0.6, -0.8);
const vec4 SPEC = vec4(1.0, 0.5, 1.4, 1.5);
const vec2 GLOSS = vec2(0.22, 5.0);

float sdRound(vec2 p, vec2 c, vec2 b, float r) {
  vec2 q = abs(p - c) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// Signed distance to the open panel (CSS px, negative inside). It hangs from y = 0: the body runs on past the screen edge, so that
// edge has no rim, and the ears are the two corners between body and screen edge (NotchShape.tsx draws them with radial-gradient).
float sdPanel(vec2 p) {
  float L = uShape.x, R = uShape.y, H = uShape.z, e = uShape.w;
  float d = sdRound(p, vec2(0.5 * (L + R), H - 4000.0), vec2(0.5 * (R - L), 4000.0), uR);
  if (e > 0.0) {
    d = min(d, p.y - e);
    vec2 ql = vec2(p.x - (L - e), e - p.y);
    vec2 qr = vec2((R + e) - p.x, e - p.y);
    float ol = length(max(ql, 0.0)) + min(max(ql.x, ql.y), 0.0) - e;
    float orr = length(max(qr, 0.0)) + min(max(qr.x, qr.y), 0.0) - e;
    d = max(d, max(-ol, -orr));
  }
  return d;
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  float d = sdPanel(p);
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
    g = vec2(sdPanel(p + vec2(h, 0.0)) - sdPanel(p - vec2(h, 0.0)), sdPanel(p + vec2(0.0, h)) - sdPanel(p - vec2(0.0, h)));
    float gl = length(g);
    g = gl > 1e-5 ? g / gl : vec2(0.0, 1.0);
    if (band < 1.0) {
      float u = 1.0 - band;
      float u3 = u * u * u;
      slope = min(SLOPE * u3 * pow(max(1.0 - u3 * u, 1e-4), -0.75), 12.0);
      vec3 ray = refract(vec3(0.0, 0.0, -1.0), normalize(vec3(g * slope, 1.0)), 1.0 / IOR);
      if (ray.z < 0.0) shift = ray.xy / -ray.z * (THICK + inward * 0.5);
      float len = length(shift);
      if (len > uMaxShift) shift *= uMaxShift / len;
    }
  }

  vec3 col = textureLod(uTex, (p + shift) * uTexScale + uTexOffset, mix(uLod.x, uLod.y, smoothstep(0.0, 1.0, band))).bgr;
  // Clamped before the veil, so the veil's worst case stays a white or a black backdrop (themes.ts glassVeil).
  col = clamp(mix(vec3(luma(col)), col, SAT), 0.0, 1.0);

  // The veil: the theme's background at its least readable opacity, lighter only in the side bands above the tool bar.
  float side = smoothstep(0.35, 0.75, abs(g.x));
  float bar = smoothstep(uShape.z - uDock - 8.0, uShape.z - uDock, p.y);
  float edge = (1.0 - smoothstep(0.5 * uBand, uBand, inward)) * side * (1.0 - bar);
  col = mix(col, uVeil.rgb, mix(uVeil.a, uVeilEdge, edge));

  if (rim) {
    vec2 light = normalize(LIGHT);
    vec3 n = normalize(vec3(g * slope, 1.0));
    col *= 1.0 - SHADOW * exp(-inward / 5.0) * (0.55 + 0.45 * max(dot(g, -light), 0.0));
    float rl = exp(-(inward * inward) / (SPEC.z * SPEC.z));
    float lit = pow(max(dot(g, light), 0.0), SPEC.w) * SPEC.x + pow(max(dot(g, -light), 0.0), SPEC.w) * SPEC.y;
    vec3 rv = reflect(vec3(0.0, 0.0, -1.0), n);
    float gloss = pow(max(dot(rv, normalize(vec3(light, 0.75))), 0.0), GLOSS.y) * GLOSS.x * (1.0 - band);
    col += uRim.rgb * uRim.a * (rl * lit + gloss);
    col = mix(col, vec3(0.0), uHair * (1.0 - smoothstep(0.0, 1.0, inward * uDpr)));
  }

  // The brow: the closed notch's colour over the header, ears included.
  col = mix(col, uBrow.rgb, 1.0 - smoothstep(uBrow.a - 0.5 / uDpr, uBrow.a + 0.5 / uDpr, p.y));
  o = vec4(clamp(col, 0.0, 1.0) * cover, cover);
}`;

export interface Program { p: WebGLProgram; u: Record<string, WebGLUniformLocation> }

/** The full canvas triangle with `fs`, and its uniforms by name; null when it does not link. */
export function program(gl: WebGL2RenderingContext, fs: string): Program | null {
  const p = gl.createProgram();
  const shaders = ([[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]] as const).map(([type, src]) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    gl.attachShader(p, s);
    return s;
  });
  gl.linkProgram(p);
  const linked = gl.getProgramParameter(p, gl.LINK_STATUS) === true;
  if (!linked && import.meta.env.DEV) console.debug("glass", shaders.map((s) => gl.getShaderInfoLog(s)).join(" "), gl.getProgramInfoLog(p));
  shaders.forEach((s) => gl.deleteShader(s));
  if (!linked) {
    gl.deleteProgram(p);
    return null;
  }
  const u: Record<string, WebGLUniformLocation> = {};
  for (let i = 0, n: number = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
    const name = gl.getActiveUniform(p, i)!.name;
    u[name] = gl.getUniformLocation(p, name)!;
  }
  return { p, u };
}
