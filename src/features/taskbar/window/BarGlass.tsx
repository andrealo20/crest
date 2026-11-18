// The bar's live glass (docs/themes.md, Glass): its shapes drawn over a live copy of the screen behind them (src/notch/glass/live.ts),
// with the closed notch's thin glass, under the veil of the bar's surface. Nothing runs at rest: the canvas draws for a frame from Rust,
// new props, a change of the glass's look or of the theme, never in a loop.

import { useEffect, useLayoutEffect, useRef } from "react";
import { cancelFrame, frame, useReducedMotion } from "motion/react";
import { createStore } from "../../../lib/store";
import { freeCopy, storeCopy, type Copy } from "../../../notch/glass/copy";
import { dropLive, liveFrame, liveSupport, setLiveRenderer, wantLive } from "../../../notch/glass/live";
import { contrastMore, reducedTransparency } from "../../../notch/glass/media";
import { GLASS, lodFor, parseTint, textureMap } from "../../../notch/glass/params";
import { DOWN_FS, program } from "../../../notch/glass/shader";
import { viewMetrics } from "../../../notch/viewZoom";
import type { GlassZone } from "../../../platform/native";
import { status } from "../../../platform/services";
import { settings } from "../../../settings/store";
import { activeTheme, forcedColors } from "../../themes/store";
import { barNeed, barRadius, barVeil, glassShapes, themeVeils, type Box } from "../look";
import type { BarShape } from "../model";
import { barShown } from "../store";
import { BAR_FS, MAX_RECTS } from "./glassShader";

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

/** The page is on screen: a bar hidden (the shortcut, a full-screen app) runs no copy. Rust may hide the window without WebView2 telling
 * the page, so the bar's own shown state (barShown, from Rust) counts too. */
const pageShown = createStore(document.visibilityState === "visible");
document.addEventListener("visibilitychange", () => pageShown.set(document.visibilityState === "visible"));

/** Energy saver is on (sysevents.rs): the glass stops, as all of it does. The notch keeps its own in the status alerts, which run only there. */
const saver = createStore(false);
status.onPower((p) => saver.set(p.saver === true));

interface Props { shape: BarShape; boxes: Box[]; radius: number; veil: number; dark: boolean }

/**
 * The bar's surface (design 6.2, 6.3) for the shape's boxes (the bar, the capsule or the tiles): the CSS background to draw, the veil
 * alone for a tile the glass does not draw (`plain`), and the glass's props while the glass may show (null otherwise). The veil is the
 * same with the glass showing or not, so the bar keeps its tone when the glass comes and goes; reduced transparency, more contrast or
 * forced colours make it opaque. `ink` is the Dark tokens the bar wears on the Notch surface (useClosedInk).
 */
export function useBarSurface(boxes: Box[], ink: Record<string, string> | undefined): { background: string; plain: string; glass: Props | null } {
  const { shape, surface, transparency, glass, height } = settings.use().taskbar;
  const theme = activeTheme.use();
  const supported = liveSupport.use()?.supported === true;
  const lessTransparency = reducedTransparency.use(), moreContrast = contrastMore.use(), forced = forcedColors.use();
  const reduced = lessTransparency || moreContrast || forced;
  const page = pageShown.use(), bar = barShown.use(), saving = saver.use(), live = liveFrame.use();
  const { dpr } = viewMetrics.use();
  const dark = surface === "notch" && ink ? true : theme.dark;
  const veil = barVeil({ transparency, glass: glass && supported, reduced, ...themeVeils(surface === "notch" && ink ? ink : theme.vars) });
  const on = glass && supported && !reduced && page && bar && !saving;
  const need = on ? barNeed(boxes, dpr) : null;
  const needKey = JSON.stringify(need);
  useEffect(() => wantLive(need), [needKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const color = surface === "notch" ? "var(--notch-closed)" : "var(--color-notch)";
  const plain = `color-mix(in srgb, ${color} ${veil * 100}%, transparent)`;
  return {
    background: on && live ? "transparent" : plain,
    plain,
    glass: on && boxes.length ? { shape, boxes, radius: barRadius(shape, height), veil, dark } : null,
  };
}

/** The canvas behind the bar, as wide as the window and down to its bottom from GLASS.zoneMargin over the shapes. */
export function BarGlass(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion() === true;
  const { dpr } = viewMetrics.use();
  // Read by the drawing, which runs outside React.
  const now = useRef({ ...props, reduced });
  now.current = { ...props, reduced };
  const redraw = useRef(() => {});
  useLayoutEffect(() => {
    const g = startBarGlass(canvas.current!, now);
    redraw.current = g.redraw;
    return () => {
      redraw.current = () => {};
      g.stop();
    };
  }, []);
  const { shape, boxes, radius, veil, dark } = props;
  useLayoutEffect(() => redraw.current(), [shape, boxes, radius, veil, dark, reduced, dpr]);
  return <canvas ref={canvas} aria-hidden width={1} height={1} className="pointer-events-none absolute bottom-0 left-0" />;
}

type Tint = NonNullable<ReturnType<typeof parseTint>>;

function setup(gl: WebGL2RenderingContext) {
  const down = program(gl, DOWN_FS), main = program(gl, BAR_FS);
  if (!down || !main) return null;
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  return { down, main, vao, fbo: gl.createFramebuffer() };
}

function startBarGlass(canvas: HTMLCanvasElement, now: { current: Props & { reduced: boolean } }) {
  // One context per element: StrictMode's second mount of the same canvas gets the same one back. Without one no renderer is set, no
  // copy runs and the bar keeps its CSS surface.
  const gl = canvas.getContext("webgl2", ATTRS);
  let gpu = gl && setup(gl);
  if (!gl || !gpu) return { redraw() {}, stop() {} };

  const copy: Copy = { tex: null, w: 0, h: 0, levels: 0, meta: null };
  const maxSize: number = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  // The veil's colour and the rim's, read from the canvas's own style (the bar's ink on the Notch surface), again after a change.
  let tokens: { tint: Tint; rim: Tint } | null = null, stale = true;
  const rects = new Float32Array(MAX_RECTS * 4);

  const clear = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };

  const paint = () => {
    if (!gpu || gl.isContextLost()) return;
    if (stale) {
      const css = getComputedStyle(canvas), tint = parseTint(css.getPropertyValue("--glass-tint")), rim = parseTint(css.getPropertyValue("--glass-rim"));
      tokens = tint && rim ? { tint, rim } : null;
      stale = false;
    }
    const { shape, boxes, radius, veil, dark, reduced } = now.current;
    const shapes = glassShapes(shape, boxes).rects.slice(0, MAX_RECTS);
    // No shapes (every box zero-sized) would put the top at Infinity.
    if (!shapes.length) return clear();
    // Sized here, when the shapes change: never per frame.
    const dpr = devicePixelRatio, top = Math.max(0, Math.min(...shapes.map((r) => r.y)) - GLASS.zoneMargin), h = innerHeight - top;
    const pw = Math.round(innerWidth * dpr), ph = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
      Object.assign(canvas.style, { width: `${innerWidth}px`, height: `${h}px` });
    }
    if (!copy.meta || !tokens) return clear();
    const { u, p } = gpu.main, map = textureMap({ left: 0, top }, 1, dpr, copy.meta), look = settings.get().themes;
    rects.fill(0);
    shapes.forEach((r, i) => rects.set([r.x, r.y - top, r.w, r.h], i * 4));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(p);
    gl.bindTexture(gl.TEXTURE_2D, copy.tex);
    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    gl.uniform1f(u.uDpr, dpr);
    gl.uniform2f(u.uTexScale, ...map.scale);
    gl.uniform2f(u.uTexOffset, ...map.offset);
    gl.uniform4fv(u["uRects[0]"], rects);
    gl.uniform1i(u.uCount, shapes.length);
    gl.uniform1f(u.uRadius, radius);
    gl.uniform1f(u.uBand, GLASS.closedBand);
    gl.uniform1f(u.uThick, GLASS.closedThick);
    gl.uniform1f(u.uMaxShift, ((reduced ? GLASS.maxShiftReduced : GLASS.maxShift) * look.glassRefraction) / 100);
    gl.uniform2f(u.uLod, ...lodFor(dpr, look.glassFrost));
    gl.uniform4f(u.uVeil, tokens.tint[0], tokens.tint[1], tokens.tint[2], veil);
    gl.uniform4f(u.uRim, tokens.rim[0], tokens.rim[1], tokens.rim[2], (tokens.rim[3] * look.glassRim) / 100);
    gl.uniform1f(u.uHair, dark ? GLASS.hairDark : GLASS.hairLight);
    gl.uniform1f(u.uEdgeFade, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  // A throw in a frame's callback stops Motion's whole frame loop: the glass gives up instead, and the bar keeps its CSS surface.
  const draw = () => {
    try {
      paint();
    } catch {
      setLiveRenderer(null);
      // Its last image would stay under the CSS surface; a lost context can throw here too.
      try {
        clear();
      } catch {
        /* nothing left to show */
      }
    }
  };

  const uploadLive = (m: GlassZone, bytes: Uint8Array) => {
    if (!gpu || gl.isContextLost() || Math.max(m.w, m.h) > maxSize) return false;
    storeCopy(gl, gpu, copy, m, bytes);
    frame.render(draw);
    return true;
  };
  const freeLive = () => {
    freeCopy(gl, copy);
    copy.meta = null;
    frame.render(draw);
  };
  const renderer = { uploadLive, freeLive };

  // No copy can be drawn until the context is back: the live session stops meanwhile (live.ts).
  const onLost = (e: Event) => {
    e.preventDefault();
    dropLive();
    setLiveRenderer(null);
  };
  const onRestored = () => {
    freeLive();
    gpu = setup(gl);
    if (gpu) setLiveRenderer(renderer);
  };
  const redraw = () => {
    stale = true;
    frame.render(draw);
  };
  const offTheme = activeTheme.subscribe(redraw);
  // The glass's look, Settings › Themes: Refraction, Frost and Rim light.
  const lookKey = () => {
    const t = settings.get().themes;
    return `${t.glassRefraction}|${t.glassFrost}|${t.glassRim}`;
  };
  let look = lookKey();
  const offLook = settings.subscribe(() => {
    if (lookKey() === look) return;
    look = lookKey();
    frame.render(draw);
  });
  // A theme crossfades its tokens (themes.css): read again once it ends.
  const onFaded = (e: TransitionEvent) => {
    if (e.target === document.documentElement && e.propertyName.startsWith("--glass")) redraw();
  };
  document.documentElement.addEventListener("transitionend", onFaded);
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  setLiveRenderer(renderer);

  const stop = () => {
    offTheme();
    offLook();
    document.documentElement.removeEventListener("transitionend", onFaded);
    cancelFrame(draw);
    canvas.removeEventListener("webglcontextlost", onLost);
    canvas.removeEventListener("webglcontextrestored", onRestored);
    setLiveRenderer(null);
    freeCopy(gl, copy);
    copy.meta = null;
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

  return { redraw, stop };
}
