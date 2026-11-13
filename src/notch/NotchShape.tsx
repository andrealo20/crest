import { useEffect, useRef, type ReactNode } from "react";
import { animate, motion, useMotionValue, useTransform, type MotionValue, type Transition } from "motion/react";
import type { NotchGeometry } from "./geometry";
import { across, uprightCss, type Edge } from "./edge";
import { GlassLayer, type GlassMode } from "./glass/GlassLayer";

interface Props {
  geometry: NotchGeometry;
  transition: Transition;
  /** Shadow only when the notch "floats" over content (open). */
  elevated: boolean;
  /** The edge it hangs from; the shape is drawn in that edge's frame and its content is turned back upright. */
  edge?: Edge;
  /** The line: nothing is centred across it, so its thickness takes whole device pixels instead of an even number, and half px steps show. */
  thin?: boolean;
  /** The open panel as glass (src/notch/glass): armed, the canvas waits; shown, it draws and --shape clears to let it through. */
  glass?: GlassMode;
  /** Which copy the glass draws: the open panel's (snapshot.ts) or the closed shapes' live one (live.ts). */
  look?: "panel" | "closed";
  /** The shape's top as it springs (Notch.tsx), which moves the glass's canvas over the copy. */
  top: MotionValue<number>;
  /** The open panel hangs from the edge (not a floating capsule's): the glass keeps the closed notch's colour under its header. */
  hangs: boolean;
  children?: ReactNode;
}

/**
 * The shape (black closed, the theme background open): a body with rounded bottom corners + two concave "ears"
 * at the top that blend the notch into the screen edge (the capsule has no
 * ears and rounds its top corners instead).
 *
 * All dimensions are motion values animated directly by springs, no React
 * re-render per frame. Animations are interruptible and keep their velocity
 * (important when hovering in and out quickly).
 */
export function NotchShape({ geometry, transition, elevated, edge = "top", thin = false, glass = "off", look = "panel", top, hangs, children }: Props) {
  const w = useMotionValue(geometry.w);
  const h = useMotionValue(geometry.h);
  const r = useMotionValue(geometry.r);
  const ear = useMotionValue(geometry.ear);
  const rt = useMotionValue(geometry.rt);
  const shadow = useMotionValue(elevated ? 1 : 0);
  const earOffset = useTransform(ear, (e) => -e + 0.5); // 0.5px overlap against hairlines
  // Whole device pixels: the shape is centered, so an odd or fractional size puts its edges
  // (and the cover pinned to them) on subpixels that shift every frame, which reads as jitter.
  const wPx = useTransform(w, snap);
  const hPx = useTransform(h, thin ? whole : snap);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    // Settle to within 0.01 px: the live activity follows the width on subpixels, and
    // Motion's default rest threshold ended every spring with a visible ~0.25 px jump.
    const t = { ...transition, restDelta: 0.01, restSpeed: 0.1 };
    // Rounding the top waits a moment, so the ears are already going in (notch to capsule, as in BrimDeck).
    const top = geometry.rt > rt.get() ? { ...t, delay: 0.06 } : t;
    const controls = [animate(w, geometry.w, t), animate(h, geometry.h, t), animate(r, geometry.r, t), animate(ear, geometry.ear, t), animate(rt, geometry.rt, top)];
    return () => controls.forEach((c) => c.stop());
  }, [geometry.w, geometry.h, geometry.r, geometry.ear, geometry.rt, transition, w, h, r, ear, rt]);

  useEffect(() => {
    const c = animate(shadow, elevated ? 1 : 0, { duration: 0.3, ease: [0.23, 1, 0.32, 1] });
    return () => c.stop();
  }, [elevated, shadow]);

  return (
    <motion.div
      data-notch-shape
      className="relative"
      // The theme's background open; closed black, unless the theme opts in (--notch-closed); transparent while the glass shows, open
      // or closed. Crossfades (themes.css), which lets the glass in when it shows and covers it again on the way out.
      style={{
        width: wPx,
        height: hPx,
        ["--shape" as string]: glass === "shown" && (elevated || look === "closed") ? "transparent" : elevated ? "var(--color-notch)" : "var(--notch-closed)",
      }}
    >
      {/* Under the ears and the shadow like the shape's own colour, so its ears crossfade with --shape too. */}
      {glass !== "off" && <GlassLayer mode={glass} look={look} w={wPx} h={hPx} r={r} ear={ear} rt={rt} top={top} target={geometry} hangs={hangs} />}
      <motion.span
        aria-hidden
        className="absolute top-0"
        style={{
          left: earOffset,
          width: ear,
          height: ear,
          background:
            "radial-gradient(circle farthest-side at 0% 100%, transparent calc(100% - 0.75px), var(--shape) 100%)",
        }}
      />
      <motion.span
        aria-hidden
        className="absolute top-0"
        style={{
          right: earOffset,
          width: ear,
          height: ear,
          background:
            "radial-gradient(circle farthest-side at 100% 100%, transparent calc(100% - 0.75px), var(--shape) 100%)",
        }}
      />
      <motion.div
        aria-hidden
        className="absolute inset-0"
        style={{
          opacity: shadow,
          borderTopLeftRadius: rt,
          borderTopRightRadius: rt,
          borderBottomLeftRadius: r,
          borderBottomRightRadius: r,
          // Within the window's margin around the largest panel (10 px on the sides, 20 below, display.rs), or a wide panel shows
          // the shadow cut off in a straight line on a light wallpaper.
          boxShadow: "0 10px 20px -10px rgb(0 0 0 / 0.7), 0 3px 8px rgb(0 0 0 / 0.35)",
        }}
      />
      <motion.div
        // clip instead of hidden: no scroll container, so focus/scrollIntoView can't shift the content.
        className="absolute inset-0 overflow-clip bg-(--shape)"
        style={{ borderTopLeftRadius: rt, borderTopRightRadius: rt, borderBottomLeftRadius: r, borderBottomRightRadius: r, containerType: edge === "top" ? undefined : "size" }}
      >
        {edge === "top" ? children : <Upright edge={edge}>{children}</Upright>}
      </motion.div>
    </motion.div>
  );
}

/**
 * The content turned back upright in the shape: a box as wide and tall as the shape on screen (its height and width in the frame on a side
 * edge), centred in it and turned by the inverse of the frame's mapping, so text reads normally on every edge.
 */
function Upright({ edge, children }: { edge: Edge; children?: ReactNode }) {
  const turned = across(edge);
  return (
    <div
      className="absolute top-1/2 left-1/2"
      style={{ width: turned ? "100cqh" : "100cqw", height: turned ? "100cqw" : "100cqh", transform: `translate(-50%, -50%) ${uprightCss(edge)}` }}
    >
      {children}
    </div>
  );
}

/** Nearest size that is an even number of device pixels, so both centered edges land on whole pixels. */
function snap(v: number): number {
  const dpr = window.devicePixelRatio || 1;
  return (Math.round((v * dpr) / 2) * 2) / dpr;
}

/** Nearest whole number of device pixels, at least one (BrimDeck's SnapToDevicePixels). */
function whole(v: number): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.max(1, Math.round(v * dpr)) / dpr;
}
