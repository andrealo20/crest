// The glass (docs/themes.md, Glass): the open panel drawn over a copy of the screen behind the window, bent along the rim and blurred
// in the middle. It blurs without CSS (CONTRIBUTING.md): each copy is blurred once, into the mip levels of its texture, and a frame
// only reads them; the canvas is sized at the start of a transition, never per frame. The tool bar and its drop (bar.ts) are drawn here
// too, from the same copy: no glass is drawn over glass. The closed notch and the capsule draw here too, over the live copy (live.ts),
// in a canvas sized on the closed shape.

import { useLayoutEffect, useRef } from "react";
import { cancelFrame, frame, useReducedMotion, type MotionValue } from "motion/react";
import { activeTheme, darkInk } from "../../features/themes/store";
import { GLASS_EDGE, glassVeilAt } from "../../features/themes/themes";
import type { GlassZone } from "../../platform/native";
import { settings } from "../../settings/store";
import { DOCK_HEIGHT, HEADER_HEIGHT, type NotchGeometry } from "../geometry";
import { viewMetrics, viewZoom } from "../viewZoom";
import { barBox, drop } from "./bar";
import { freeCopy, storeCopy, type Copy } from "./copy";
import { dropLive, setLiveRenderer } from "./live";
import { GLASS, canvasBox, dropLens, dropShape, lodFor, parseTint, shapeUniform, textureMap } from "./params";
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
/** `look`: which copy is drawn, the open panel's (snapshot.ts) or the closed shapes' live one (live.ts); `hud`: a status alert fills the closed shape. */
interface Live { target: NotchGeometry; hangs: boolean; reduced: boolean; look: "panel" | "closed"; hud: boolean }
interface Glass { show(on: boolean): void; fit(): void; relook(): void; stop(): void }
type Tint = NonNullable<ReturnType<typeof parseTint>>;

/** The canvas under the open panel's content and under the closed row. Armed it rests at 1x1 with its context alive, so a peek pays no setup. */
export function GlassLayer({ mode, look, w, h, r, ear, rt, top, target, hangs, hud }: Shape & { mode: "armed" | "shown"; look: Live["look"]; target: NotchGeometry; hangs: boolean; hud: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion() === true;
  // Read by the drawing, which runs outside React.
  const live = useRef<Live>({ target, hangs, reduced, look, hud });
  live.current = { target, hangs, reduced, look, hud };
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
  // From the panel's copy to the live one or back, or the page at another scale or size (the notch on another monitor): the canvas takes
  // the size of the shape drawn now, and its place in the page is read again.
  const view = viewMetrics.use();
  useLayoutEffect(() => glass.current?.relook(), [look, view]);
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
    return { show() {}, fit() {}, relook() {}, stop() {} };
  }

  // The open panel's copy and the closed shapes' live one.
  const snap: Copy = { tex: null, w: 0, h: 0, levels: 0, meta: null };
  const liveCopy: Copy = { tex: null, w: 0, h: 0, levels: 0, meta: null };
  const maxSize: number = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  // rect is read with the shape's top at topAt, at the start of a transition and when a copy for the panel comes.
  let rect: DOMRect | null = null, topAt = 0;
  // The canvas's width in CSS px and its device px per CSS px; scale 0 while it rests at 1x1.
  let box = { w: 0, scale: 0 };
  let showing = false, covering = false, coverTimer = 0, themeUntil = 0;
  let tokens: { tint: Tint; edge: number; clear: number; rim: Tint; fill: Tint } | null = null;

  /** The theme's glass tokens (themes.ts) as the shader takes them; false while one does not read as a colour. */
  const readTokens = () => {
    const css = getComputedStyle(document.documentElement), read = (name: string) => parseTint(css.getPropertyValue(name));
    const tint = read("--glass-tint"), edge = read("--glass-tint-edge"), clear = read("--glass-tint-clear");
    const rim = read("--glass-rim"), fill = read("--color-fill-3");
    if (!tint || !edge || !clear || !rim || !fill) return false;
    tokens = { tint, edge: edge[3], clear: clear[3], rim, fill };
    return true;
  };

  /**
   * The closed shapes' glass: its veil's colour is the closed notch's; no side bands, no tool bar, no brow (draw). A theme that colours
   * the closed notch takes the CSS's tokens, which crossfade with the theme as the closed row's ink over them does. The black notch takes
   * its ink's (darkInk) from memory: its row is drawn in that ink too, and that is not on <html>.
   */
  const closedTokens = () => {
    const theme = activeTheme.get();
    if (theme.closedNotch) return tokens && { ...tokens, dark: theme.dark };
    const ink = darkInk(), tint = parseTint(ink["--glass-tint"]), clear = parseTint(ink["--glass-tint-clear"]), rim = parseTint(ink["--glass-rim"]);
    if (!tint || !clear || !rim) return null;
    return { tint, edge: tint[3], clear: clear[3], rim, fill: [0, 0, 0, 0] as Tint, dark: true };
  };
  /** The tool bar's veil (the side bands', --glass-tint-edge) for a status alert on a closed shape: the closed notch's theme's, else its ink's (darkInk). */
  const barVeil = () => (activeTheme.get().closedNotch ? tokens?.edge : parseTint(darkInk()["--glass-tint-edge"])?.[3]) ?? GLASS_EDGE;

  const paint = () => {
    const closed = live.current.look === "closed", src = closed ? liveCopy : snap;
    // Covering needs no copy: the full veil hides whatever was there.
    if (!showing || !gpu || !rect || gl.isContextLost() || (!src.meta && !covering)) return;
    // During the springs the tokens in memory serve. A theme's crossfade is read on every frame, and once more after it: frames that
    // came late (a throttled window) would leave colours from the middle of it.
    if (themeUntil) {
      readTokens();
      if (performance.now() < themeUntil) frame.render(draw);
      else themeUntil = 0;
    }
    const t = closed ? closedTokens() : tokens && { ...tokens, dark: activeTheme.get().dark };
    if (!t) return;
    const { u, p } = gpu.main, scale = box.scale;
    // The canvas where it is now, without reading the DOM: the shape's top springs on its own. Without a copy (covering) the texture is
    // unbound, read as black under the full veil.
    const map = src.meta ? textureMap(rect, viewZoom(), devicePixelRatio, src.meta, shape.top.get() - topAt) : { scale: [1, 1] as [number, number], offset: [0, 0] as [number, number] };
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(p);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    gl.uniform1f(u.uDpr, scale);
    gl.uniform2f(u.uTexScale, ...map.scale);
    gl.uniform2f(u.uTexOffset, ...map.offset);
    gl.uniform4f(u.uShape, ...shapeUniform(box.w, shape.w.get(), shape.h.get(), shape.ear.get()));
    gl.uniform1f(u.uR, shape.r.get());
    // Under half a pixel the top corners are gone: the panel hangs from the edge (a spring may also take them below 0).
    const rt = shape.rt.get();
    gl.uniform1f(u.uRt, rt < 0.5 ? 0 : rt);
    gl.uniform1f(u.uBand, closed ? GLASS.closedBand : GLASS.band);
    gl.uniform1f(u.uThick, closed ? GLASS.closedThick : GLASS.thick);
    gl.uniform1f(u.uShadow, closed ? 0 : GLASS.shadow);
    gl.uniform1f(u.uEdgeFade, closed && src.meta ? 1 : 0);
    const look = settings.get().themes, behavior = settings.get().behavior, reduced = live.current.reduced;
    // Covering, the veil at full strength hides the copy while --shape comes back. Else Transparency (themes.ts glassVeilAt): the
    // content down to the theme's clearest, the side bands never clearer than their own; the tool bar keeps its own.
    const veil = (safe: number, clearest?: number) => (covering ? 1 : glassVeilAt(safe, look.glassTransparency, clearest));
    // A status alert is clear glass like the tool bar: the side bands' veil whatever Transparency says, and no frost.
    const hud = closed && live.current.hud;
    gl.uniform1f(u.uMaxShift, ((reduced ? GLASS.maxShiftReduced : GLASS.maxShift) * look.glassRefraction) / 100);
    gl.uniform2f(u.uLod, ...lodFor(scale, hud ? 0 : look.glassFrost));
    const inside = hud ? (covering ? 1 : barVeil()) : veil(t.tint[3], t.clear);
    gl.uniform4f(u.uVeil, t.tint[0], t.tint[1], t.tint[2], inside);
    // The closed shapes keep one veil all over: their row runs up to the sides, so no clearer side bands.
    gl.uniform1f(u.uVeilEdge, closed ? inside : veil(t.edge));
    gl.uniform1f(u.uBarVeil, covering ? 1 : t.edge);
    // Negative: the tool bar's strip is the one under the header (#76).
    gl.uniform1f(u.uDock, behavior.toolBar === "top" ? -DOCK_HEIGHT : DOCK_HEIGHT);
    // The header is glass like the rest (issue #49). The brow, the veil's colour over it, is left only while covering and round top
    // corners and ears meet (a capsule near the edge springing): there it hides the top rim, and over the full veil it does not show.
    const brow = !closed && live.current.hangs && covering && rt >= 0.5 && shape.ear.get() > 0;
    gl.uniform4f(u.uBrow, t.tint[0], t.tint[1], t.tint[2], brow ? HEADER_HEIGHT : -1);
    gl.uniform4f(u.uRim, t.rim[0], t.rim[1], t.rim[2], (t.rim[3] * look.glassRim) / 100);
    if (closed) {
      // No tool bar on a closed shape: its motion values may still hold the last panel's.
      gl.uniform4f(u.uBar, 0, 0, 0, 0);
      gl.uniform4f(u.uDrop, 0, 0, 0, 0);
      gl.uniform1f(u.uLift, 0);
    } else {
      // The tool bar and its drop, in the canvas: x from its centre, which is the panel's. Covering, the Dock's own fills are back;
      // with its background off there is no capsule, and so no drop of glass either: the Dock draws its plain drop (Notch.tsx glassBar).
      const mid = box.w / 2, bh = barBox.h.get(), bottom = barBox.top.get() + bh, lift = drop.lift.get();
      gl.uniform4f(u.uBar, mid + barBox.x.get(), bottom - bh / 2, covering || !behavior.toolBarFill ? 0 : barBox.w.get() / 2, bh / 2);
      // At rest no stretch: a spring's last frame snaps to its target, and that snap would read as speed.
      const speed = reduced || !drop.x.isAnimating() ? 0 : Math.abs(drop.x.getVelocity());
      const [rise, hw, hh] = dropShape(drop.w.get(), drop.h.get(), bh, lift, drop.press.get(), speed);
      gl.uniform4f(u.uDrop, mid + drop.x.get(), bottom - rise, hw, hh);
      gl.uniform1f(u.uLift, lift);
    }
    gl.uniform4f(u.uFill, ...t.fill);
    gl.uniform2f(u.uLens, ...dropLens(look.glassRefraction));
    gl.uniform1f(u.uHair, t.dark ? GLASS.hairDark : GLASS.hairLight);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  // A throw in a frame's callback stops Motion's whole frame loop, and with it every animation of the notch: the glass gives
  // up instead, and the notch goes on opaque.
  const draw = () => {
    try {
      paint();
    } catch {
      glassBroken.set(true);
    }
  };

  /**
   * Grows the canvas to hold the shape now and the one it goes to: at the start of a transition, never per frame, never smaller while
   * shown, but `fresh`: when the look changes, the size of the shapes drawn now (a panel's canvas is about 30 times a closed notch's).
   */
  const fit = (fresh = false) => {
    if (!showing) return;
    const zoom = viewZoom(), scale = devicePixelRatio * zoom;
    const now = { w: shape.w.get(), h: shape.h.get(), ear: shape.ear.get() };
    const next = canvasBox(now, live.current.target, { w: innerWidth / zoom, h: innerHeight / zoom }, scale);
    const same = scale === box.scale && !fresh;
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

  /** The look changed: the canvas takes the size of the shapes drawn now. */
  const relook = () => {
    fit(true);
    frame.render(draw);
  };

  const upload = (m: GlassZone, bytes: Uint8Array) => {
    if (!gpu || gl.isContextLost() || Math.max(m.w, m.h) > maxSize || !readTokens()) return false;
    storeCopy(gl, gpu, snap, m, bytes);
    rect = canvas.getBoundingClientRect();
    topAt = shape.top.get();
    frame.render(draw);
    return true;
  };

  // Up to 30 a second, so no DOM read but a first one: the canvas is placed by fit, and the shape's top springs on its own (draw).
  const uploadLive = (m: GlassZone, bytes: Uint8Array) => {
    if (!gpu || gl.isContextLost() || Math.max(m.w, m.h) > maxSize) return false;
    storeCopy(gl, gpu, liveCopy, m, bytes);
    if (!rect) {
      rect = canvas.getBoundingClientRect();
      topAt = shape.top.get();
    }
    frame.render(draw);
    return true;
  };

  const free = (c: Copy) => freeCopy(gl, c);
  const freeLive = () => {
    free(liveCopy);
    liveCopy.meta = null;
  };

  const liveRenderer = { uploadLive, freeLive };
  // No copy can be drawn until the context is back: the live session stops meanwhile (live.ts).
  const onLost = (e: Event) => {
    e.preventDefault();
    dropSnapshot();
    dropLive();
    setLiveRenderer(null);
  };
  // A new copy comes with the next peek, a live one at once.
  const onRestored = () => {
    free(snap);
    freeLive();
    gpu = setup(gl);
    if (gpu) setLiveRenderer(liveRenderer);
    else glassBroken.set(true);
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
  setGlassRenderer({ upload, free: () => free(snap) });
  setLiveRenderer(liveRenderer);

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
    setLiveRenderer(null);
    // A copy on screen goes with the texture. One still on its way stays: StrictMode runs this right after mounting, after the panel
    // asked for one (Glass turned on with the panel open), and mounts again before it comes.
    if (snapshot.get().ready) dropSnapshot();
    free(snap);
    freeLive();
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

  return { show, fit: () => fit(), relook, stop };
}
