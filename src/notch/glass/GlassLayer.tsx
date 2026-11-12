// The glass (docs/themes.md, Glass): the open panel drawn over a copy of the screen behind the window, bent along the rim and blurred
// in the middle. It blurs without CSS (CONTRIBUTING.md): each copy is blurred once, into the mip levels of its texture, and a frame
// only reads them; the canvas is sized at the start of a transition, never per frame. The tool bar and its drop (bar.ts) are drawn here
// too, from the same copy: no glass is drawn over glass.

import { useLayoutEffect, useRef } from "react";
import { cancelFrame, frame, useReducedMotion, type MotionValue } from "motion/react";
import { activeTheme } from "../../features/themes/store";
import { glassVeilAt } from "../../features/themes/themes";
import { settings } from "../../settings/store";
import { DOCK_HEIGHT, HEADER_HEIGHT, type NotchGeometry } from "../geometry";
import { viewZoom } from "../viewZoom";
import { barBox, drop } from "./bar";
import { GLASS, canvasBox, dropLens, dropShape, lodFor, parseTint, shapeUniform, textureMap, type SnapshotMeta } from "./params";
import { DOWN_FS, MAIN_FS, program } from "./shader";
import { dropSnapshot, glassBroken, setGlassRenderer, snapshot } from "./snapshot";

export type GlassMode = "off" | "armed" | "shown";

/** --shape turns opaque again in 300 ms (themes.css): until then the copy stays hidden under the full veil, following the shape. */
const COVER_MS = 320;
/** Themes crossfade in 500 ms (themes.css): for this long after a change the tokens are read again on every frame. */
const THEME_FADE_MS = 520;

const ATTRS: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
  powerPreference: "low-power",
  failIfMajorPerformanceCaveat: true,
};

/** `top`: the shape's top in the page as it springs (Notch.tsx useSpringTop): a floating capsule rises as its panel opens. */
interface Shape { w: MotionValue<number>; h: MotionValue<number>; r: MotionValue<number>; ear: MotionValue<number>; rt: MotionValue<number>; top: MotionValue<number> }
interface Live { target: NotchGeometry; hangs: boolean; reduced: boolean }
interface Glass { show(on: boolean): void; fit(): void; stop(): void }
type Tint = NonNullable<ReturnType<typeof parseTint>>;
type Gpu = NonNullable<ReturnType<typeof setup>>;

/** The canvas under the open panel's content. Armed it rests at 1x1 with its context alive, so a peek pays no setup. */
export function GlassLayer({ mode, w, h, r, ear, rt, top, target, hangs }: Shape & { mode: "armed" | "shown"; target: NotchGeometry; hangs: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion() === true;
  // Read by the drawing, which runs outside React.
  const live = useRef<Live>({ target, hangs, reduced });
  live.current = { target, hangs, reduced };
  const glass = useRef<Glass | null>(null);

  // Layout effects: the canvas is sized and its frame asked for before the paint where --shape turns clear, which with reduced motion
  // (no fade) would otherwise show the notch gone for a frame.
  useLayoutEffect(() => {
    const g = startGlass(canvas.current!, { w, h, r, ear, rt, top }, live);
    glass.current = g;
    return () => {
      glass.current = null;
      g.stop();
    };
  }, [w, h, r, ear, rt, top]);
  useLayoutEffect(() => glass.current?.show(mode === "shown"), [mode]);
  // A transition starts: the canvas grows to hold where the shape goes.
  useLayoutEffect(() => glass.current?.fit(), [target.w, target.h, target.ear]);

  return <canvas ref={canvas} aria-hidden width={1} height={1} className="pointer-events-none absolute top-0" />;
}

/** Programs, vertex array and the pyramid's framebuffer; null when the programs do not link. */
function setup(gl: WebGL2RenderingContext) {
  const down = program(gl, DOWN_FS), main = program(gl, MAIN_FS);
  if (!down || !main) return null;
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  return { down, main, vao, fbo: gl.createFramebuffer() };
}

function startGlass(canvas: HTMLCanvasElement, shape: Shape, live: { current: Live }): Glass {
  // One context per element: StrictMode's second mount of the same canvas gets the same one back.
  const gl = canvas.getContext("webgl2", ATTRS);
  let gpu = gl && setup(gl);
  if (!gl || !gpu) {
    glassBroken.set(true);
    return { show() {}, fit() {}, stop() {} };
  }

  let tex: WebGLTexture | null = null, texW = 0, texH = 0, levels = 0;
  // rect is read with the shape's top at topAt, at the start of a transition and when a copy comes.
  let meta: SnapshotMeta | null = null, rect: DOMRect | null = null, topAt = 0;
  // The canvas's width in CSS px and its device px per CSS px; scale 0 while it rests at 1x1.
  let box = { w: 0, scale: 0 };
  let showing = false, covering = false, coverTimer = 0, themeUntil = 0;
  let tokens: { tint: Tint; edge: number; clear: number; bar: number; rim: Tint; brow: Tint; fill: Tint } | null = null;

  /** The theme's glass tokens (themes.ts) as the shader takes them; false while one does not read as a colour. */
  const readTokens = () => {
    const css = getComputedStyle(document.documentElement), read = (name: string) => parseTint(css.getPropertyValue(name));
    const tint = read("--glass-tint"), edge = read("--glass-tint-edge"), clear = read("--glass-tint-clear"), bar = read("--glass-tint-bar");
    const rim = read("--glass-rim"), brow = read("--notch-closed"), fill = read("--color-fill-3");
    if (!tint || !edge || !clear || !bar || !rim || !brow || !fill) return false;
    tokens = { tint, edge: edge[3], clear: clear[3], bar: bar[3], rim, brow, fill };
    return true;
  };

  const draw = () => {
    if (!showing || !gpu || !tokens || !meta || !rect || gl.isContextLost()) return;
    // During the springs the tokens in memory serve. A theme's crossfade is read on every frame, and once more after it: frames that
    // came late (a throttled window) would leave colours from the middle of it.
    if (themeUntil) {
      readTokens();
      if (performance.now() < themeUntil) frame.render(draw);
      else themeUntil = 0;
    }
    const { u, p } = gpu.main, t = tokens, scale = box.scale;
    // The canvas where it is now, without reading the DOM: the shape's top springs on its own.
    const zoom = viewZoom(), map = textureMap({ left: rect.left, top: rect.top + (shape.top.get() - topAt) * zoom }, zoom, devicePixelRatio, meta);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(p);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    gl.uniform1f(u.uDpr, scale);
    gl.uniform2f(u.uTexScale, ...map.scale);
    gl.uniform2f(u.uTexOffset, ...map.offset);
    gl.uniform4f(u.uShape, ...shapeUniform(box.w, shape.w.get(), shape.h.get(), shape.ear.get()));
    gl.uniform1f(u.uR, shape.r.get());
    // Under half a pixel the top corners are gone: the panel hangs from the edge (a spring may also take them below 0).
    const rt = shape.rt.get();
    gl.uniform1f(u.uRt, rt < 0.5 ? 0 : rt);
    gl.uniform1f(u.uBand, GLASS.band);
    const look = settings.get().themes, reduced = live.current.reduced;
    // Covering, the veil at full strength hides the copy while --shape comes back. Else Transparency (themes.ts glassVeilAt): the
    // content down to the theme's clearest, the side bands and the tool bar never clearer than their own.
    const veil = (safe: number, clearest?: number) => (covering ? 1 : glassVeilAt(safe, look.glassTransparency, clearest));
    gl.uniform1f(u.uMaxShift, ((reduced ? GLASS.maxShiftReduced : GLASS.maxShift) * look.glassRefraction) / 100);
    gl.uniform2f(u.uLod, ...lodFor(scale, look.glassFrost));
    gl.uniform4f(u.uVeil, t.tint[0], t.tint[1], t.tint[2], veil(t.tint[3], t.clear));
    gl.uniform1f(u.uVeilEdge, veil(t.edge));
    gl.uniform1f(u.uBarVeil, veil(t.bar));
    gl.uniform1f(u.uDock, DOCK_HEIGHT);
    // The brow only on a panel hanging from the edge: a floating capsule's header keeps the theme's ink (Notch.tsx).
    gl.uniform4f(u.uBrow, t.brow[0], t.brow[1], t.brow[2], live.current.hangs ? HEADER_HEIGHT : -1);
    gl.uniform4f(u.uRim, t.rim[0], t.rim[1], t.rim[2], (t.rim[3] * look.glassRim) / 100);
    // The tool bar and its drop, in the canvas: x from its centre, which is the panel's. Covering, the Dock's own fills are back.
    const mid = box.w / 2, bh = barBox.h.get(), bottom = barBox.top.get() + bh, lift = drop.lift.get();
    gl.uniform4f(u.uBar, mid + barBox.x.get(), bottom - bh / 2, covering ? 0 : barBox.w.get() / 2, bh / 2);
    // At rest no stretch: a spring's last frame snaps to its target, and that snap would read as speed.
    const speed = reduced || !drop.x.isAnimating() ? 0 : Math.abs(drop.x.getVelocity());
    const [rise, hw, hh] = dropShape(drop.w.get(), drop.h.get(), bh, lift, drop.press.get(), speed);
    gl.uniform4f(u.uDrop, mid + drop.x.get(), bottom - rise, hw, hh);
    gl.uniform1f(u.uLift, lift);
    gl.uniform4f(u.uFill, ...t.fill);
    gl.uniform2f(u.uLens, ...dropLens(look.glassRefraction));
    gl.uniform1f(u.uHair, activeTheme.get().dark ? GLASS.hairDark : GLASS.hairLight);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  /** Grows the canvas to hold the shape now and the one it goes to: at the start of a transition, never per frame, never smaller while shown. */
  const fit = () => {
    if (!showing) return;
    const zoom = viewZoom(), scale = devicePixelRatio * zoom;
    const now = { w: shape.w.get(), h: shape.h.get(), ear: shape.ear.get() };
    const next = canvasBox(now, live.current.target, { w: innerWidth / zoom, h: innerHeight / zoom }, scale);
    const same = scale === box.scale;
    if (same && next.px[0] <= canvas.width && next.px[1] <= canvas.height) return;
    canvas.width = same ? Math.max(canvas.width, next.px[0]) : next.px[0];
    canvas.height = same ? Math.max(canvas.height, next.px[1]) : next.px[1];
    box = { w: canvas.width / scale, scale };
    Object.assign(canvas.style, { width: `${box.w}px`, height: `${canvas.height / scale}px`, left: `calc(50% - ${box.w / 2}px)` });
    rect = canvas.getBoundingClientRect();
    topAt = shape.top.get();
    frame.render(draw);
  };

  /** Cleared and back to 1x1; the context stays. */
  const rest = () => {
    showing = covering = false;
    box = { w: 0, scale: 0 };
    canvas.width = canvas.height = 1;
    Object.assign(canvas.style, { width: "1px", height: "1px" });
  };

  const show = (on: boolean) => {
    if (on) {
      window.clearTimeout(coverTimer);
      showing = true;
      covering = false;
      readTokens();
      fit();
      frame.render(draw);
    } else if (!covering) {
      // Cleared at once the panel would show through without glass for all of --shape's fade; a lost context has nothing left to show.
      if (showing && !gl.isContextLost()) {
        covering = true;
        frame.render(draw);
        coverTimer = window.setTimeout(rest, COVER_MS);
      } else rest();
    }
  };

  // The blur pyramid in the texture's mip levels, each from the one above (dual filter, shader.ts).
  const pyramid = ({ down, fbo }: Gpu) => {
    gl.useProgram(down.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    for (let k = 1; k < levels; k++) {
      // Only level k - 1 is visible to the sampler while level k is the target: no feedback loop.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, k - 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, k - 1);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, k);
      gl.viewport(0, 0, Math.max(1, texW >> k), Math.max(1, texH >> k));
      gl.uniform2f(down.u.uStep, 1 / Math.max(1, texW >> (k - 1)), 1 / Math.max(1, texH >> (k - 1)));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, levels - 1);
    // Detached, or the framebuffer would keep the texture, and the copy in it, alive after free().
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  const upload = (m: SnapshotMeta, bytes: Uint8Array) => {
    if (!gpu || gl.isContextLost() || Math.max(m.w, m.h) > gl.getParameter(gl.MAX_TEXTURE_SIZE) || !readTokens()) return false;
    if (!tex || m.w !== texW || m.h !== texH) {
      if (tex) gl.deleteTexture(tex);
      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      levels = Math.floor(Math.log2(Math.max(m.w, m.h))) + 1;
      gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, m.w, m.h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      // The bend and a window partly off its monitor sample past the copy: they get its edge, not the far side.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      texW = m.w;
      texH = m.h;
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, m.w, m.h, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    pyramid(gpu);
    meta = m;
    rect = canvas.getBoundingClientRect();
    topAt = shape.top.get();
    frame.render(draw);
    return true;
  };

  // A texture freed and its size forgotten: the next copy allocates again, even at the same size.
  const free = () => {
    if (tex) gl.deleteTexture(tex);
    tex = null;
    texW = texH = 0;
  };

  const onLost = (e: Event) => {
    e.preventDefault();
    dropSnapshot();
  };
  // A new copy comes with the next peek.
  const onRestored = () => {
    free();
    gpu = setup(gl);
    if (!gpu) glassBroken.set(true);
  };

  const offs = [...Object.values(shape), ...Object.values(barBox), ...Object.values(drop)].map((v) => v.on("change", () => frame.render(draw)));
  // A long glide reaches its target frames before it ends, with no change left to draw it unstretched.
  offs.push(drop.x.on("animationComplete", () => frame.render(draw)));
  const offTheme = activeTheme.subscribe(() => {
    themeUntil = performance.now() + THEME_FADE_MS;
    frame.render(draw);
  });
  // The glass's sliders (ThemeSettings.tsx) show on the next frame; draw() returns at once while nothing shows.
  const offLook = settings.subscribe(() => frame.render(draw));
  // And at the crossfade's end, whenever that is: in a window that draws late (hidden, busy) the reads above can all fall before it,
  // and the glass would keep the last theme's veil under this theme's text.
  const onFaded = (e: TransitionEvent) => {
    if (e.target === document.documentElement && e.propertyName.startsWith("--glass") && readTokens()) frame.render(draw);
  };
  document.documentElement.addEventListener("transitionend", onFaded);
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  setGlassRenderer({ upload, free });

  const stop = () => {
    offs.forEach((off) => off());
    offTheme();
    offLook();
    document.documentElement.removeEventListener("transitionend", onFaded);
    cancelFrame(draw);
    window.clearTimeout(coverTimer);
    canvas.removeEventListener("webglcontextlost", onLost);
    canvas.removeEventListener("webglcontextrestored", onRestored);
    setGlassRenderer(null);
    // A copy on screen goes with the texture. One still on its way stays: StrictMode runs this right after mounting, after the panel
    // asked for one (Glass turned on with the panel open), and mounts again before it comes.
    if (snapshot.get().ready) dropSnapshot();
    free();
    if (gpu) {
      gl.deleteProgram(gpu.down.p);
      gl.deleteProgram(gpu.main.p);
      gl.deleteVertexArray(gpu.vao);
      gl.deleteFramebuffer(gpu.fbo);
    }
    // StrictMode mounts the same canvas again at once, and a lost context cannot be had back from it: lost only once the canvas is gone.
    window.setTimeout(() => {
      if (!canvas.isConnected) gl.getExtension("WEBGL_lose_context")?.loseContext();
    }, 0);
  };

  return { show, fit, stop };
}
