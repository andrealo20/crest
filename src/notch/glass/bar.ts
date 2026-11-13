// The tool bar (Notch.tsx Dock): its capsule and the drop on it, measured from the DOM only when something changes and moved by springs.
// The glass draws them (GlassLayer.tsx, shader.ts), and where it does not show the Dock's own element (usePlainDrop): while they move,
// never at rest.

import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent, type RefObject } from "react";
import { animate, cancelFrame, frame, motionValue, useReducedMotion, type MotionValue } from "motion/react";
import { springs } from "../../design/motion";
import { glassInk, type ResolvedTheme } from "../../features/themes/themes";
import { onNativeHover } from "../../platform/native";
import { viewZoom } from "../viewZoom";
import { dropShape, dropTransform, visiblePart } from "./params";

/** The capsule: its centre's x from the open panel's centre, its top in the panel, its size; CSS px. Width 0 until measured. */
export const barBox = { x: motionValue(0), top: motionValue(0), w: motionValue(0), h: motionValue(0) };
/**
 * The drop: centre x from the panel's centre, the box of the tool under it (width 0: none), lift (0 resting, 1 a lens under the
 * pointer), press (a click's squash).
 */
export const drop = { x: motionValue(0), w: motionValue(0), h: motionValue(0), lift: motionValue(0), press: motionValue(0) };

let ink: { theme: ResolvedTheme; hues: boolean; vars: Record<string, string> } | null = null;
/** glassInk for the theme on screen, kept until it changes: worked out once per theme, not on every render of the Dock. */
export function barInk(theme: ResolvedTheme, hues: boolean): Record<string, string> {
  if (ink?.theme !== theme || ink.hues !== hues) ink = { theme, hues, vars: glassInk(theme, hues) };
  return ink.vars;
}

/**
 * The tool pointed at (pointer or keyboard) and the capsule's handlers, with the glass or without. `tools`: the bar's tools in order,
 * which can move its buttons without resizing the capsule (a tool switched on with the bar at its widest, or moved).
 */
export function useBarDrop(capsule: RefObject<HTMLDivElement | null>, strip: RefObject<HTMLDivElement | null>, active: string, tools: string) {
  // Kept apart, so the pointer leaving the bar hands the drop back to the button the keyboard is on.
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const pointed = hovered ?? focused;
  // As the Dock mounts, that is at every opening: Motion's hook does not follow a change.
  const reduced = useReducedMotion() === true;
  const target = pointed ?? active;
  // The observers call it too: it reads this render's target.
  const place = useRef((_glide: boolean) => {});
  place.current = (glide) => {
    const cap = capsule.current, panel = cap?.closest("[data-open-panel]");
    if (!cap || !panel) return;
    // Relative to the panel's rect, so its slide in and out cancels out; over the browser's CSS zoom (1 in the app).
    const z = viewZoom(), p = panel.getBoundingClientRect(), c = cap.getBoundingClientRect(), mid = p.left + p.width / 2;
    barBox.x.jump((c.left + c.width / 2 - mid) / z);
    barBox.top.jump((c.top - p.top) / z);
    barBox.w.jump(c.width / z);
    barBox.h.jump(c.height / z);
    const b = cap.querySelector<HTMLElement>(`[data-tool="${CSS.escape(target)}"]`);
    // The layout size, not the rect's: a press scales the button (.pressable) for 140 ms; offsetWidth would round it.
    const css = b && getComputedStyle(b);
    const view = b && strip.current?.contains(b) ? strip.current.getBoundingClientRect() : null;
    // Without a button (a page such as What's new) the drop shrinks where it is.
    const [x, w] = b && css ? visiblePart(b.getBoundingClientRect(), parseFloat(css.width) * z, view) : [drop.x.get() * z + mid, 0];
    // One that comes back from nothing starts on its tool.
    if (drop.w.get() < 0.5 && w > 0) drop.x.jump((x - mid) / z);
    // On its way the drop is sent on, keeping its speed, to where the tool is now; at rest it follows at once (a scroll, a resize).
    // With reduced motion it jumps, like the mark under the icon.
    const go = (v: MotionValue<number>, to: number) => {
      if (!reduced && (glide || v.isAnimating())) animate(v, to, springs.glide);
      else v.jump(to);
    };
    go(drop.x, (x - mid) / z);
    go(drop.w, w / z);
    go(drop.h, css ? parseFloat(css.height) : 0);
  };

  useLayoutEffect(() => {
    const cap = capsule.current!, panel = cap.closest("[data-open-panel]")!, list = strip.current;
    const again = () => place.current(false);
    again();
    const size = new ResizeObserver(again);
    size.observe(cap);
    size.observe(panel);
    list?.addEventListener("scroll", again, { passive: true });
    return () => {
      size.disconnect();
      list?.removeEventListener("scroll", again);
      drop.lift.jump(0);
      drop.press.jump(0);
      // Opened again before a spring ends, the first measure jumps instead of sliding on from here.
      [drop.x, drop.w, drop.h].forEach((v) => v.stop());
    };
  }, [capsule, strip]);
  // A tool taken off the bar while pointed at would leave the drop with nothing under it: the pointing starts over.
  useLayoutEffect(() => {
    setHovered(null);
    setFocused(null);
  }, [tools]);
  // To the tool pointed at, or back to the current one, or where its button went.
  useLayoutEffect(() => {
    place.current(true);
  }, [target, tools]);
  // A click on the pointed tool resizes the panel without moving the target: measured now, the observer would draw it a frame late.
  // After the effect above, so a drop it sent on keeps sliding.
  useLayoutEffect(() => {
    place.current(false);
  }, [active]);
  // Whether anything is pointed, not which tool: peek starts from rest, so sent again at every tool it would rise in steps.
  const lifted = pointed !== null && !reduced;
  useLayoutEffect(() => {
    animate(drop.lift, lifted ? 1 : 0, springs.peek);
  }, [lifted]);
  // Natively the page gets no pointerleave once the window lets the pointer through (hit_test.rs): Rust's hover says it left.
  useEffect(
    () =>
      onNativeHover((inside) => {
        if (!inside) setHovered(null);
      }),
    [],
  );

  const tool = (el: EventTarget | null) => (el instanceof Element ? (el.closest("[data-tool]")?.getAttribute("data-tool") ?? null) : null);
  // Also while the press is still on its way: a quick click lets go before its first frame.
  const release = () => {
    if (drop.press.get() !== 0 || drop.press.isAnimating()) animate(drop.press, 0, springs.rebound);
  };
  const handlers = {
    // Only a tool changes it: across the gaps between buttons the drop stays put.
    onPointerOver: (e: PointerEvent) => {
      const id = tool(e.target);
      if (id) setHovered(id);
    },
    // Only with the button still down: after a pointerup it would start the bounce over from rest and cut it short.
    onPointerLeave: (e: PointerEvent) => {
      setHovered(null);
      if (e.buttons !== 0) release();
    },
    onPointerDown: (e: PointerEvent) => {
      if (!reduced && tool(e.target)) animate(drop.press, 1, springs.snappy);
    },
    onPointerUp: release,
    onPointerCancel: release,
    // The keyboard points like the pointer; the focus a click leaves does not.
    onFocus: (e: FocusEvent) => {
      const id = tool(e.target);
      setFocused(id && (e.target as Element).matches(":focus-visible") ? id : null);
    },
    onBlur: (e: FocusEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(null);
    },
  };
  return { pointed, handlers };
}

/** The Dock's fills fade for this long as the glass comes and goes (Notch.tsx FILL_FADE), and a frame more. */
const FILL_FADE_MS = 320;

/** Where the glass does not show (`on`) the Dock draws the drop itself, as `el`: the same values, as a transform over the tool's box. */
export function usePlainDrop(el: RefObject<HTMLElement | null>, on: boolean) {
  const drew = useRef(false);
  useLayoutEffect(() => {
    // The glass is back over a drop drawn here: its fill fades out, and until it has the drop still follows the values.
    const node = el.current, fading = !on && drew.current;
    drew.current = on;
    if (!node || !(on || fading)) return;
    // The layout size, as for the tool's box above: offsetWidth would round it.
    const css = getComputedStyle(node);
    let bw = parseFloat(css.width), bh = parseFloat(css.height);
    const draw = () => {
      // A throw in a frame's callback would stop Motion's whole frame loop: the drop stops following instead.
      try {
        paint();
      } catch {
        stop();
      }
    };
    const paint = () => {
      const w = drop.w.get(), h = drop.h.get();
      // The box only between springs: while one runs the drop is its transform alone.
      // Not for the 1e-13 px a measure differs by from one tool to the next.
      if (w > 0 && (Math.abs(w - bw) > 0.01 || Math.abs(h - bh) > 0.01) && !drop.w.isAnimating() && !drop.h.isAnimating()) {
        node.style.width = `${(bw = w)}px`;
        node.style.height = `${(bh = h)}px`;
      }
      // As the glass draws it (GlassLayer.tsx), but no taller than the bar: its fill past the bar's would show in another tone.
      const speed = drop.x.isAnimating() ? Math.abs(drop.x.getVelocity()) : 0;
      node.style.transform = dropTransform(drop.x.get() - barBox.x.get(), dropShape(w, h, barBox.h.get(), drop.lift.get(), drop.press.get(), speed, 0), bw, bh);
    };
    const again = () => frame.render(draw);
    const offs = [barBox.x, barBox.h, ...Object.values(drop)].map((v) => v.on("change", again));
    // A spring's last frame still counts as running: the drop unstretched, in its new box, comes with the frame after.
    offs.push(...[drop.x, drop.w, drop.h].map((v) => v.on("animationComplete", again)));
    const stop = () => {
      offs.forEach((off) => off());
      cancelFrame(draw);
    };
    draw();
    const id = fading ? window.setTimeout(stop, FILL_FADE_MS) : 0;
    return () => {
      window.clearTimeout(id);
      stop();
    };
  }, [el, on]);
}
