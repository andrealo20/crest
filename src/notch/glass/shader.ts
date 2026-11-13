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

/**
 * The glass: the open panel over the copy taken as it opens, the closed notch and the capsule over the live copy (live.ts), bent along the
 * rim and blurred in the middle, under a veil. The tool bar and its drop (bar.ts) are glass of their own inside the panel, from the same copy.
 */
export const MAIN_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;        // the copy of the screen, BGRA bytes uploaded as RGBA, its mips the blur pyramid
uniform vec2 uRes;             // canvas, device px
uniform float uDpr;            // device px per CSS px of the shape
uniform vec2 uTexScale;        // uv = p * uTexScale + uTexOffset (params.ts textureMap)
uniform vec2 uTexOffset;
uniform vec4 uShape;           // body left, right, height, ear radius, CSS px in the canvas
uniform float uR;              // bottom corner radius
uniform float uRt;             // top corner radius: 0 hangs from y = 0 (the notch, a capsule near the edge), more floats
uniform float uBand;           // the rim that bends
uniform float uMaxShift;       // lower with reduced motion, times Refraction
uniform vec2 uLod;             // blur level at the rim and in the middle, with Frost (params.ts lodFor)
uniform vec4 uVeil;            // --glass-tint's colour, and the content's veil after Transparency (themes.ts glassVeilAt)
uniform float uVeilEdge;       // the side bands' veil after Transparency
uniform float uDock;           // DOCK_HEIGHT: no side bands along the tool bar's strip
uniform vec4 uBrow;            // --notch-closed and HEADER_HEIGHT; -1 where there is none (a floating panel, the closed shapes)
uniform vec4 uRim;             // --glass-rim, its strength times Rim light
uniform float uHair;           // the outline, stronger on light themes
uniform float uThick;          // the glass's thickness for the bend: the panel's, or the closed shapes' thinner one (params.ts GLASS)
uniform float uShadow;         // the inner shadow along the rim; 0 on the closed shapes, whose row runs close to it
uniform float uEdgeFade;       // 1 for the live copy (live.ts): past its zone the veil alone
uniform vec4 uBar;             // the tool bar's capsule: centre x and y, half width and height; half width 0: none
uniform float uBarVeil;        // its veil (--glass-tint-bar, the side bands'), which Transparency leaves as it is
uniform vec4 uDrop;            // the drop on it: centre x and y, half width and height; half width 0: none
uniform float uLift;           // the drop lifted into a lens, 0 to 1
uniform vec4 uFill;            // --color-fill-3, the drop's tint
uniform vec2 uLens;            // the drop's bend at its rim in px and its magnification, fully lifted (params.ts dropLens)
out vec4 o;

const float IOR = 1.5;
const float SLOPE = 1.6;
const float SAT = 1.2;
const vec2 LIGHT = vec2(-0.6, -0.8);
const vec4 SPEC = vec4(1.0, 0.5, 1.4, 1.5);
const vec2 GLOSS = vec2(0.22, 5.0);
const float BAR_BAND = 8.0;    // the bar's rim that bends; clear of its icons (11 px from its long sides on buttons from about 32 px)
const float DROP_BAND = 6.0;   // the drop's; clear of the icon under it, but for a press at high Refraction
const float BAR_THICK = 10.0;  // the bar's and the drop's glass, thinner than the panel's
const float BAR_SHADOW = 0.12; // the bar's soft shadow on the panel around it, inside the tool bar's strip
const float MERGE = 6.0;       // the lifted drop's smooth union with the bar, WinIsland's 6 px
const float HEAD = 36.0;       // the header's rows, HEADER_HEIGHT + 4 (Notch.tsx Header)

float sdRound(vec2 p, vec2 c, vec2 b, float r) {
  vec2 q = abs(p - c) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// Signed distance to the open panel (CSS px, negative inside). Hanging from y = 0 the body runs on past the screen edge, so that edge
// has no rim, and the ears are the two corners between body and screen edge (NotchShape.tsx draws them with radial-gradient).
// Floating, it is the whole box from y = 0 with top corners uRt; while a shape near the edge opens or closes, the ears come and go
// beside it, their strip only outside the body's columns (half a pixel in, as the CSS ears) so the top corners stay round. The top rim
// that strip leaves until uRt reaches 0 lies under the brow.
float sdPanel(vec2 p) {
  float L = uShape.x, R = uShape.y, H = uShape.z, e = uShape.w;
  float d = uRt > 0.0
    ? sdRound(p, vec2(0.5 * (L + R), 0.5 * H), vec2(0.5 * (R - L), 0.5 * H), p.y < 0.5 * H ? uRt : uR)
    : sdRound(p, vec2(0.5 * (L + R), H - 4000.0), vec2(0.5 * (R - L), 4000.0), uR);
  if (e > 0.0) {
    d = min(d, uRt > 0.0 ? max(p.y - e, min(p.x - L, R - p.x) - 0.5) : p.y - e);
    vec2 ql = vec2(p.x - (L - e), e - p.y);
    vec2 qr = vec2((R + e) - p.x, e - p.y);
    float ol = length(max(ql, 0.0)) + min(max(ql.x, ql.y), 0.0) - e;
    float orr = length(max(qr, 0.0)) + min(max(qr.x, qr.y), 0.0) - e;
    d = max(d, max(-ol, -orr));
  }
  return d;
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Polynomial smooth minimum (Inigo Quilez), as WinIsland joins its shapes; k 0 is min().
float smin(float a, float b, float k) {
  if (k <= 0.0) return min(a, b);
  float h = clamp(1.0 - abs(a - b) / k, 0.0, 1.0);
  return min(a, b) - k * 0.25 * h * h;
}

// The drop, a capsule, cut by the panel while the springs run.
float sdDrop(vec2 p) { return max(sdRound(p, uDrop.xy, uDrop.zw, min(uDrop.z, uDrop.w)), sdPanel(p)); }

// The bar, a capsule, with the lifted drop risen out of it, cut by the panel.
float sdBar(vec2 p) {
  float b = sdRound(p, uBar.xy, uBar.zw, uBar.w);
  if (uDrop.z > 0.0) b = smin(b, sdRound(p, uDrop.xy, uDrop.zw, min(uDrop.z, uDrop.w)), MERGE * uLift);
  return max(b, sdPanel(p));
}

// The backdrop's shift at inward px into a rim w wide with outward normal n: the slope of the profile, refract(), along the ray through
// glass thick px, at most most. The slope comes back for the light.
vec2 bend(float inward, float w, vec2 n, float thick, float most, out float slope) {
  slope = 0.0;
  float b = clamp(inward / w, 0.0, 1.0);
  if (b >= 1.0) return vec2(0.0);
  float u = 1.0 - b;
  float u3 = u * u * u;
  slope = min(SLOPE * u3 * pow(max(1.0 - u3 * u, 1e-4), -0.75), 12.0);
  vec3 ray = refract(vec3(0.0, 0.0, -1.0), normalize(vec3(n * slope, 1.0)), 1.0 / IOR);
  vec2 s = ray.z < 0.0 ? ray.xy / -ray.z * (thick + inward * 0.5) : vec2(0.0);
  float len = length(s);
  return len > most ? s * (most / len) : s;
}

// The rim light and the gloss of a rim with outward normal n, at inward px and band (0 at the edge, 1 past the rim).
float shine(vec2 n, float slope, float inward, float band) {
  vec2 light = normalize(LIGHT);
  float rl = exp(-(inward * inward) / (SPEC.z * SPEC.z));
  float lit = pow(max(dot(n, light), 0.0), SPEC.w) * SPEC.x + pow(max(dot(n, -light), 0.0), SPEC.w) * SPEC.y;
  vec3 rv = reflect(vec3(0.0, 0.0, -1.0), normalize(vec3(n * slope, 1.0)));
  float gloss = pow(max(dot(rv, normalize(vec3(light, 0.75))), 0.0), GLOSS.y) * GLOSS.x * (1.0 - band);
  return rl * lit + gloss;
}

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
    shift = bend(inward, uBand, g, uThick, uMaxShift, slope);
  }
  vec2 q = p + shift;
  float lod = mix(uLod.x, uLod.y, smoothstep(0.0, 1.0, band));

  // The tool bar and the drop on it (bar.ts): glass of their own inside the panel's, from the same copy, only in the bar's box.
  float inB = 0.0, inD = 0.0, glow = 0.0, hairB = 0.0, shade = 0.0;
  // 16 px around it: the shadow's tail and a squashed, stretched drop at an end tool.
  if (uBar.z > 0.0 && abs(p.x - uBar.x) < uBar.z + 16.0 && abs(p.y - uBar.y) < uBar.w + 16.0) {
    float dB = sdBar(p);
    inB = clamp(0.5 - dB * uDpr, 0.0, 1.0);
    shade = BAR_SHADOW * exp(-max(dB, 0.0) / 3.0) * (1.0 - inB);
    if (inB > 0.0) {
      // Along the panel's edge (the bar's bottom, 2 px off it) the panel's rim is the one that shows.
      float free = smoothstep(4.0, 10.0, inward);
      float iB = max(-dB, 0.0), bB = clamp(iB / BAR_BAND, 0.0, 1.0), sB = 0.0;
      vec2 qB = p;
      if (iB < BAR_BAND + 2.0) {
        const float h = 0.5;
        vec2 n = vec2(sdBar(p + vec2(h, 0.0)) - sdBar(p - vec2(h, 0.0)), sdBar(p + vec2(0.0, h)) - sdBar(p - vec2(0.0, h)));
        float nl = length(n);
        n = nl > 1e-5 ? n / nl : vec2(0.0, -1.0);
        qB += bend(iB, BAR_BAND, n, BAR_THICK, uMaxShift, sB);
        glow = shine(n, sB, iB, bB) * free * inB;
        hairB = (1.0 - smoothstep(0.0, 1.0, iB * uDpr)) * free * inB;
      }
      // In the bar its own rim bends, not the panel's bottom band.
      q = mix(q, qB, inB);
      lod = mix(lod, mix(uLod.x, uLod.y, smoothstep(0.0, 1.0, bB)), inB);
      if (uDrop.z > 0.0) {
        float dD = sdDrop(p);
        inD = clamp(0.5 - dD * uDpr, 0.0, 1.0);
        if (inD > 0.0 && uLift > 0.0) {
          float iD = max(-dD, 0.0), bD = clamp(iD / DROP_BAND, 0.0, 1.0), sD = 0.0;
          // A lens: what is under it magnified, and bent at its rim.
          vec2 qD = uDrop.xy + (p - uDrop.xy) / (1.0 + (uLens.y - 1.0) * uLift);
          if (iD < DROP_BAND + 2.0) {
            const float h = 0.5;
            vec2 n = vec2(sdDrop(p + vec2(h, 0.0)) - sdDrop(p - vec2(h, 0.0)), sdDrop(p + vec2(0.0, h)) - sdDrop(p - vec2(0.0, h)));
            float nl = length(n);
            n = nl > 1e-5 ? n / nl : vec2(0.0, -1.0);
            qD += bend(iD, DROP_BAND, n, BAR_THICK, uLens.x, sD) * uLift;
            glow = max(glow, shine(n, sD, iD, bD) * uLift * inD * free);
          }
          q = mix(q, qD, inD * uLift);
          lod = mix(lod, uLod.x + 0.5 * (lod - uLod.x), inD * uLift);
        }
      }
    }
  }

  vec2 uv = q * uTexScale + uTexOffset;
  vec3 col = textureLod(uTex, uv, lod).bgr;
  // Clamped before the veil, so the veil's worst case stays a white or a black backdrop (themes.ts glassVeil).
  col = clamp(mix(vec3(luma(col)), col, SAT), 0.0, 1.0);

  // The veil: the theme's background, lighter in the side bands above the tool bar, thinner in the bar, with the drop's tint on it.
  // Round top corners bring the bands under the header's buttons: there they start below it.
  float side = smoothstep(0.35, 0.75, abs(g.x));
  float strip = smoothstep(uShape.z - uDock - 8.0, uShape.z - uDock, p.y);
  float head = uRt > 0.0 ? smoothstep(HEAD, HEAD + 8.0, p.y) : 1.0;
  float edge = (1.0 - smoothstep(0.5 * uBand, uBand, inward)) * side * (1.0 - strip) * head;
  col = mix(col, uVeil.rgb, mix(mix(uVeil.a, uVeilEdge, edge), uBarVeil, inB));
  // The live copy holds a zone around the closed shape (live.ts): past it, while a grown shape waits for its new zone, the veil alone,
  // faded in over 4 px. Not on the copy's own edges: the hanging notch's top is the screen's.
  if (uEdgeFade > 0.0) {
    vec2 m = min(uv, 1.0 - uv) / uTexScale;
    col = mix(uVeil.rgb, col, clamp(1.0 + min(m.x, m.y) / 4.0, 0.0, 1.0));
  }
  col = mix(col, uFill.rgb, uFill.a * inD);
  col *= 1.0 - shade * strip;

  if (rim) {
    vec2 light = normalize(LIGHT);
    // Not inside the bar: its ink is worked out over the veil alone (themes.ts glassInk).
    col *= 1.0 - uShadow * exp(-inward / 5.0) * (0.55 + 0.45 * max(dot(g, -light), 0.0)) * (1.0 - inB);
    col += uRim.rgb * uRim.a * shine(g, slope, inward, band);
    col = mix(col, vec3(0.0), uHair * (1.0 - smoothstep(0.0, 1.0, inward * uDpr)));
  }
  col += uRim.rgb * uRim.a * glow;
  col = mix(col, vec3(0.0), uHair * hairB);

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
