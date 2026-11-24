import { memo, useLayoutEffect, useRef, useState, useSyncExternalStore, type DragEventHandler, type MouseEventHandler, type PointerEventHandler, type ReactNode, type Ref } from "react";
import { AnimatePresence, motion, useReducedMotion, useSpring, useTransform, type MotionValue } from "motion/react";
import { createStore } from "../../../lib/store";
import { design } from "../../../design/design";
import { fade, popover, pulse, springs } from "../../../design/motion";
import { itemLayer, markShape, markThick, marks } from "../itemLook";
import { settings } from "../../../settings/store";
import { magnify } from "../look";
import { placeMenu, type BarEdge, type Indicator } from "../model";
import { nudge } from "../position";
import { useBarEdge } from "./barEdge";
import { lineUnder, type Progress } from "../decorModel";
import { barShown } from "../store";

/** Thickness of the mark under an app, CSS px. */
export const MARK = 3;

/** The bar's pointer (clientX, Infinity off the bar), the pitch from one button to the next and how far the name rises over the grown icon. */
export type Magnify = { pointer: MotionValue<number>; unit: number; rise: number };

/**
 * The key of the button under the pointer, kept out of the bar's state: a hover draws again only the button it leaves and the one it
 * reaches, where drawing the whole bar cost 4 to 5 ms a time.
 */
export const barHover = createStore<string | null>(null);

/** Whether the pointer is on the button with this key. */
export const useHovered = (key: string | undefined): boolean => useSyncExternalStore(barHover.subscribe, () => key !== undefined && barHover.get() === key);

/** A button on the bar: its icon lifts (or with `magnify`, grows) under the pointer, with its name (or what went wrong) in a label above. */
export function Item(props: {
  name: string;
  /** What the label says: what went wrong or a note, nothing with null, and left out `hoverLabel` while the pointer is on the button. */
  label?: string | null;
  failed: boolean;
  /** The button's key in `barHover`. */
  hover?: string;
  /** The label under the pointer: the name the bar gave the button, which a button that renames itself keeps unless it says otherwise. */
  hoverLabel?: string;
  size: number;
  markAt: number;
  mark?: Indicator;
  /** An app's progress (taskband.rs): a line in the mark's place. */
  progress?: Progress | null;
  /** The Tiles shape: the button draws its own tile, as tall as the bar, and carries data-tile (the bar measures the tiles by it). */
  tile?: { background: string; radius: number };
  /** An item that opens the panel above the bar: whether the panel shows what it opens. */
  expanded?: boolean;
  /** What the item is (`data-kind`): the bar measures each item other than the apps by it, as it fits the apps (useAppFit). */
  kind?: string;
  /** A tray icon kept visible: its place among them (`data-tray`). */
  tray?: number;
  /** A pinned app: its pin id (`data-pin`), which the drag among the pinned apps measures it by (PinDrop). */
  pin?: string;
  ref?: Ref<HTMLButtonElement>;
  /** The button's width when its content is not an icon of `size`. */
  width?: number;
  /** The id of what a screen reader says after the name: a widget's content. */
  describedBy?: string;
  /** An icon and a title: content from the start edge, the title cut to the width. */
  labelled?: boolean;
  /** Grow as a dock's icon with the pointer near, in place of the lift. */
  magnify?: Magnify;
  onEnter: PointerEventHandler<HTMLButtonElement>;
  onLeave: () => void;
  onClick: MouseEventHandler<HTMLButtonElement>;
  onDoubleClick?: MouseEventHandler<HTMLButtonElement>;
  onContextMenu: MouseEventHandler<HTMLButtonElement>;
  /** A click of another button than the left one: the middle one, for an app. */
  onAuxClick?: MouseEventHandler<HTMLButtonElement>;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
  /** A file held over an app: its window comes forward after a rest (TaskbarWindow `dragRest`). */
  onDragEnter?: DragEventHandler<HTMLButtonElement>;
  onDragLeave?: DragEventHandler<HTMLButtonElement>;
  /** Under Material, the height of the pill and the state layer off Tiles, when the item draws a pill of its own (Stato). */
  layer?: number;
  /** Liquid Glass + owns the bar's surface: a tile keeps its glass, and the pill and the state layer take the centred indicator's shape. */
  plus?: boolean;
  children: ReactNode;
}) {
  const material = design.use() === "material";
  const edge = useBarEdge();
  const lifted = useHovered(props.hover);
  const label = props.label !== undefined ? props.label : lifted ? (props.hoverLabel ?? null) : null;
  const shape = itemLayer({ size: props.size, width: props.width ?? props.size + 16, layer: props.layer, tile: props.plus ? undefined : props.tile });
  const pill = props.mark !== undefined && marks(props.mark, "material").pill;
  // Stato draws a pill of its own, inside the lifted span: its layer rides there, over the pill's fill, as the pill lifts.
  const inPill = props.layer !== undefined;
  // Lit by the bar's hovered state, which Rust clears when the pointer leaves the window; :hover would stay on.
  const layer = material && <span aria-hidden data-hover={lifted || undefined} className={`m3-layer absolute${inPill ? " inset-0 rounded-full" : ""}`} style={inPill ? undefined : shape} />;
  return (
    // The gap at the screen's edge (GAP, h-1) belongs to the button beside it, so a click with the pointer pushed against the screen's
    // edge, left or right, lands on the button; the gap itself stays empty. A press shrinks only the icon, by `scale` (Motion's
    // lift owns its transform): shrinking the whole button, as .pressable does, would lift that strip off the edge while the
    // button is held, and the release would land beside it.
    <button
      ref={props.ref}
      aria-label={props.name}
      aria-haspopup={props.expanded === undefined ? undefined : "dialog"}
      aria-expanded={props.expanded}
      aria-describedby={props.describedBy}
      data-kind={props.kind}
      data-tray={props.tray}
      data-pin={props.pin}
      onPointerEnter={props.onEnter}
      onPointerLeave={props.onLeave}
      onClick={props.onClick}
      onDoubleClick={props.onDoubleClick}
      onContextMenu={props.onContextMenu}
      onAuxClick={props.onAuxClick}
      onPointerDown={props.onPointerDown}
      onDragEnter={props.onDragEnter}
      onDragLeave={props.onDragLeave}
      data-tile={props.tile ? "" : undefined}
      className={`group relative flex shrink-0 items-center ${props.labelled ? "justify-start px-2" : "justify-center"} after:absolute after:inset-x-0 ${edge === "top" ? "after:bottom-full" : "after:top-full"} after:h-1`}
      style={{ width: props.width ?? props.size + 16, background: props.tile?.background, borderRadius: props.tile?.radius }}
    >
      {material && props.mark && <motion.span aria-hidden data-front-pill className="absolute bg-secondary-container" style={shape} initial={false} animate={{ opacity: pill ? 1 : 0, transform: `scaleX(${pill ? 1 : 0.6})` }} transition={springs.snappy} />}
      {!inPill && layer}
      {props.magnify ? (
        <Magnified {...props.magnify} top={edge === "top"}>
          {props.children}
        </Magnified>
      ) : (
        <motion.span
          className={`relative flex transition-[scale] duration-140 ease-out motion-safe:group-active:scale-94${props.labelled ? " min-w-0" : ""}`}
          initial={false}
          animate={{ transform: `translateY(${lifted ? -nudge(edge) : 0}px)` }}
          transition={springs.peek}
        >
          {props.children}
          {inPill && layer}
        </motion.span>
      )}
      {props.progress && lineUnder(props.mark, props.progress) === "progress" ? <ProgressLine p={props.progress} at={props.markAt} side={edge} width={props.size} /> : props.mark && <Mark kind={props.mark} at={props.markAt} side={edge} />}
      <Label text={label} failed={props.failed} rise={props.magnify?.rise ?? 0} edge={edge} />
    </button>
  );
}

/**
 * The icon grown from its side on the screen's edge (`top` for a top bar) by its distance to the pointer, through a spring that keeps its velocity as the pointer moves on.
 * Motion values only: React draws nothing while the pointer moves. The button's centre is measured once each time the pointer comes
 * onto the bar and after a render (the scale never moves the button).
 */
function Magnified({ pointer, unit, top, children }: Magnify & { top: boolean; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const centre = useRef<number | null>(null);
  // Measured again after each render too: an app launched from the bar moves the buttons while the pointer stays on it.
  useLayoutEffect(() => {
    centre.current = null;
  });
  const target = useTransform(pointer, (x) => {
    if (!Number.isFinite(x)) {
      centre.current = null;
      return 1;
    }
    const button = ref.current?.parentElement?.getBoundingClientRect();
    if (!button) return 1;
    centre.current ??= button.x + button.width / 2;
    return magnify(x - centre.current, unit);
  });
  const scale = useSpring(target, springs.glide);
  return (
    // The press keeps a span of its own, so its scale and the magnify's never write the same property.
    <motion.span ref={ref} className={`relative flex ${top ? "origin-top" : "origin-bottom"}`} style={{ scale }}>
      <span className="flex transition-[scale] duration-140 ease-out motion-safe:group-active:scale-94">{children}</span>
    </motion.span>
  );
}

export type ItemProps = Parameters<typeof Item>[0];

/** Three pulses, ending on the solid accent: an app can wait for attention a long time, and the bar stays idle meanwhile. */
const ATTENTION = { ...pulse, repeat: 5 };

/**
 * Under an app (over it on a top bar: `at` px from its `side`): a dot while it is open, a longer mark while it is in front (in Crest;
 * Material puts a pill behind it), the accent while a window asks for attention, pulsing when that starts. Both shapes are drawn whole
 * and change by opacity and scale only. Memo: plain values only, so a bar drawn again for another button's change leaves its three
 * animated spans alone.
 */
export const Mark = memo(function Mark({ kind, at, side = "bottom" }: { kind: Indicator; at: number; side?: BarEdge }) {
  const appDesign = design.use();
  const style = settings.use().taskbar.marks;
  const shape = markShape(style);
  const { dot, bar } = marks(kind, appDesign);
  return (
    // No initial={false} here: a mark that appears asking for attention pulses too, where initial={false} would leave it dim.
    <motion.span
      className="absolute inset-x-0 flex items-center justify-center"
      style={{ [side]: at, height: markThick(style) }}
      animate={{ opacity: kind === "attention" ? [1, 0.35] : 1 }}
      transition={kind === "attention" ? ATTENTION : fade}
    >
      <motion.span
        className="absolute rounded-full bg-label-2"
        style={{ width: shape.dot.w, height: shape.dot.h }}
        initial={false}
        animate={{ opacity: dot ? 1 : 0, transform: `scale(${dot ? 1 : 0.5})` }}
        transition={springs.snappy}
      />
      <motion.span
        className={`absolute rounded-full ${kind === "attention" ? "bg-accent" : "bg-label"}`}
        style={{ width: shape.bar.w, height: shape.bar.h }}
        initial={false}
        animate={{ opacity: bar ? 1 : 0, transform: `scaleX(${bar ? 1 : 0.25})` }}
        transition={springs.snappy}
      />
    </motion.span>
  );
});

const FILL = { normal: "bg-green", paused: "bg-caution", error: "bg-red", indeterminate: "bg-green" } as const;

/**
 * An app's progress as Windows shows it, as wide as the icon: green, yellow while paused, red after an error; a third-wide segment
 * moving to and fro while the app cannot say how far it is, still under reduced motion. Transform only. `p` is the decor store's own
 * object, the same until the progress changes.
 */
const ProgressLine = memo(function ProgressLine({ p, at, side, width }: { p: Progress; at: number; side: BarEdge; width: number }) {
  const reduced = useReducedMotion();
  const shown = barShown.use();
  // Still while the bar is hidden or slid away too: Rust hides the window without telling WebView2, so an endless one runs on.
  const still = reduced || !shown;
  const moving = p.state === "indeterminate";
  return (
    <span aria-hidden className="absolute inset-x-0 flex justify-center" style={{ [side]: at, height: MARK }}>
      {/* Mirrored in a right-to-left language, so the fill grows and the segment moves from the inline start. */}
      <span className="relative overflow-hidden rounded-full bg-fill-2 rtl:-scale-x-100" style={{ width, height: MARK }}>
        <motion.span
          className={`absolute inset-y-0 left-0 origin-left rounded-full ${FILL[p.state]} ${moving ? "w-1/3" : "w-full"}`}
          initial={false}
          animate={moving ? (still ? { transform: "translateX(0%)" } : { transform: ["translateX(0%)", "translateX(200%)"] }) : { transform: `scaleX(${p.value})` }}
          transition={moving && !still ? { duration: 1.2, ease: "easeInOut", repeat: Infinity, repeatType: "reverse" } : springs.snappy}
        />
      </span>
    </span>
  );
});

/** A button's name on the screen's side of it, or what went wrong; never takes the pointer. */
const Label = memo(function Label({ text, failed, rise, edge }: { text: string | null; failed: boolean; rise: number; edge: BarEdge }) {
  return <AnimatePresence>{text !== null && <Bubble key={text} text={text} failed={failed} rise={rise} edge={edge} />}</AnimatePresence>;
});

/** `rise`: px past the usual 8 from the button, clear of a magnified icon. */
function Bubble({ text, failed, rise, edge }: { text: string; failed: boolean; rise: number; edge: BarEdge }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  // Centred over its button, and moved only as far as it must to stay inside the window, as the menus do.
  useLayoutEffect(() => {
    const el = ref.current;
    const button = el?.parentElement?.getBoundingClientRect();
    if (!el || !button) return;
    const w = el.offsetWidth;
    setShift(placeMenu(button.x, button.width, w, window.innerWidth) - (button.x + button.width / 2 - w / 2));
  }, []);
  return (
    <motion.span
      ref={ref}
      dir="auto"
      className={`pointer-events-none absolute ${edge === "top" ? "top-full" : "bottom-full"} left-1/2 max-w-80 -translate-x-1/2 truncate rounded-[8px] bg-elevated px-2 py-1 text-footnote font-medium shadow-[0_4px_14px_rgb(0_0_0/0.4)] ring-1 ring-separator material:rounded-[4px] material:shadow-none material:ring-0 material:text-notch ${failed ? "text-red material:bg-red" : "text-label material:bg-label"}`}
      style={{ marginLeft: shift, [edge === "top" ? "marginTop" : "marginBottom"]: 8 + rise }}
      initial={{ opacity: 0, transform: `translateY(${nudge(edge)}px) scale(0.96)` }}
      animate={{ opacity: 1, transform: "translateY(0px) scale(1)", transition: popover.enter }}
      exit={{ opacity: 0, transform: "scale(0.98)", transition: popover.exit }}
    >
      {text}
    </motion.span>
  );
}
