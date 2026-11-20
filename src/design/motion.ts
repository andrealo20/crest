import type { Transition } from "motion/react";

/*
 * Motion presets. Every animation in the app uses one of these,
 * no inline values in components.
 *
 * Apple-style springs (visualDuration + bounce) instead of stiffness/damping:
 * easier to read and matches SwiftUI's .spring(duration:bounce:).
 * springs.glide is the exception, written as stiffness and damping so it keeps its velocity (physics()).
 * The Material style puts its own values into these same objects (setMotionDesign).
 */

// ?slow=4 in the URL slows all springs down for tuning. Both reads are guarded, since tests load this module without a page.
const slow = typeof location === "undefined" ? 1 : Number(new URLSearchParams(location.search).get("slow")) || 1;

const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function spring(visualDuration: number, bounce: number): Transition {
  if (reduceMotion) return { type: "spring", visualDuration: 0.2 * slow, bounce: 0 };
  return { type: "spring", visualDuration: visualDuration * slow, bounce };
}

/**
 * spring() as stiffness and damping, the same curve from rest: Motion 14 starts a spring set by duration and bounce from rest whenever
 * it is aimed somewhere else, this one keeps its velocity (the tool bar's drop, src/notch/glass/bar.ts).
 */
function physics(visualDuration: number, bounce: number): Transition {
  const [d, b] = reduceMotion ? [0.2, 0] : [visualDuration, bounce];
  const root = (2 * Math.PI) / (d * slow * 1.2);
  return { type: "spring", stiffness: root * root, damping: 2 * (1 - b) * root, mass: 1 };
}

/** A Material "effects" spring, for opacity: no bounce, and like the fades it follows ?slow but not reduced motion. */
function effect(visualDuration: number): Transition {
  return { type: "spring", visualDuration: visualDuration * slow, bounce: 0 };
}

export const springs = {
  /** Notch opens: lively, a noticeable but short overshoot. */
  open: spring(0.42, 0.24),
  /** Notch closes: faster than opening, no bounce. */
  close: spring(0.32, 0.04),
  /** Hover nudge: small and playful, says "I see you". */
  peek: spring(0.26, 0.32),
  /** Shape change while open (tab switch, live activity). */
  morph: spring(0.36, 0.14),
  /** Small elements inside (tab pill, toggles). */
  snappy: spring(0.24, 0.12),
  /** The drop in the tool bar: snappy, keeping its velocity when it is sent somewhere else. */
  glide: physics(0.24, 0.12),
  /** A squashed shape springing back past its rest: the tool bar's drop after a click. */
  rebound: spring(0.32, 0.6),
  /** A control's own quick move (a switch's knob, a menu's scale, a press): snappy here, Material's fast spring in its style. */
  pop: spring(0.24, 0.12),
} as const;

const easeOut = [0.23, 1, 0.32, 1] as const;

/** Quick fade for overlays ("Copied", status changes). */
export const fade: Transition = { duration: 0.16 * slow, ease: easeOut };

/** Crossfade for large areas (covers, charts), a bit calmer. */
export const crossfade = { duration: 0.4 * slow, ease: "easeInOut" } satisfies Transition;

/**
 * Cover swap: the new image fades in on top, the old one leaves a beat later, so
 * there is never a gap or a hard cut (same calm pace as the accent color).
 */
export const artwork = {
  enter: { duration: 0.45 * slow, ease: "easeInOut" } satisfies Transition,
  exit: { duration: 0.35 * slow, delay: 0.2 * slow, ease: "easeInOut" } satisfies Transition,
} as const;

/** Menus/popovers: fast in, even faster out. */
export const popover: Record<"enter" | "exit", Transition> = {
  enter: { duration: 0.16 * slow, ease: easeOut },
  exit: { duration: 0.1 * slow, ease: easeOut },
};

/** Continuous spin for "loading" (refresh icon). */
export const spin = { repeat: Infinity, duration: 0.9, ease: "linear" } satisfies Transition;

/** Calm pulse for "ringing" (opacity back and forth). */
export const pulse = { repeat: Infinity, repeatType: "reverse", duration: 0.7, ease: "easeInOut" } satisfies Transition;

/** Content appears after the shape starts moving; disappears immediately. */
export const content: Record<"enter" | "exit", Transition> = {
  enter: {
    duration: 0.24 * slow,
    delay: 0.05 * slow,
    ease: [0.23, 1, 0.32, 1],
  },
  exit: {
    duration: 0.12 * slow,
    ease: [0.23, 1, 0.32, 1],
  },
};

/**
 * A notice card's way in, after the shape has started growing; the overshoot is an entrance only, it leaves with a plain fade. Each
 * value carries its own delay: Motion ignores the root's for a value with a transition of its own.
 */
export const card: Transition = {
  opacity: { duration: 0.25 * slow, delay: 0.08 * slow },
  // Stiffness 420, damping 26.
  transform: { ...physics(0.2555, 0.3657), delay: 0.08 * slow },
};

/** "Wrong" (PIN): a short, damped side-to-side shake like the macOS login field. */
export const shake = {
  keyframes: ["translateX(0px)", "translateX(-9px)", "translateX(7px)", "translateX(-5px)", "translateX(3px)", "translateX(0px)"],
  transition: { duration: 0.38 * slow, ease: "easeOut" } satisfies Transition,
} as const;

/** Countdowns that step once per second (2FA ring): linear, exactly one tick long. */
export const tick = { duration: 1, ease: "linear" } satisfies Transition;

/** The presets the Style changes, by name: the very objects components hold, which setMotionDesign rewrites. */
const live = { ...springs, fade, card, contentEnter: content.enter, contentExit: content.exit, popoverEnter: popover.enter, popoverExit: popover.exit };
type Presets = Record<keyof typeof live, Transition>;

/**
 * The same presets in the Material style, from Material 3's spring tokens (stiffness k, damping ratio ζ) written as
 * spring(2π / (1.2 √k), 1 - ζ), which draws the same curve from rest: spatial springs for what moves, effects springs for opacity.
 */
function material(): Presets {
  return {
    open: spring(0.37, 0.2), // expressive slow spatial, k 200 ζ 0.8: inside the window's margins, at the pace of today's opening
    close: spring(0.198, 0.1), // standard default spatial, k 700 ζ 0.9: dips 0.8 px under the closed shape, the expressive ones 8
    peek: spring(0.269, 0.2), // expressive default spatial, k 380 ζ 0.8
    morph: spring(0.269, 0.2),
    snappy: spring(0.269, 0.2),
    glide: physics(0.269, 0.2),
    rebound: spring(0.185, 0.4), // expressive fast spatial, k 800 ζ 0.6
    pop: spring(0.185, 0.4),
    fade: effect(0.085), // fast effects, k 3800
    card: { opacity: { ...effect(0.131), delay: 0.08 * slow }, transform: { ...spring(0.185, 0.4), delay: 0.08 * slow } }, // default effects, k 1600
    contentEnter: { ...effect(0.131), delay: 0.05 * slow },
    contentExit: effect(0.085),
    popoverEnter: { default: spring(0.185, 0.4), opacity: effect(0.085) },
    popoverExit: effect(0.085),
  };
}

/** The presets as written above, kept at the first switch to be put back. */
let crest: Presets | undefined;

/** Puts the Style's motion into every preset, in place: components keep their references and take the values at their next animation. */
export function setMotionDesign(d: "crest" | "material"): void {
  crest ??= structuredClone(live);
  const next = d === "material" ? material() : crest;
  for (const [name, preset] of Object.entries(live) as [keyof Presets, Record<string, unknown>][]) {
    // Every key goes first: one left over changes the spring (a stiffness wins over visualDuration, a per-value entry over the root).
    for (const key of Object.keys(preset)) delete preset[key];
    Object.assign(preset, next[name]);
  }
}
