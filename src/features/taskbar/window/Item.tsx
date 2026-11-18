import { useLayoutEffect, useRef, useState, type MouseEventHandler, type PointerEventHandler, type ReactNode, type Ref } from "react";
import { AnimatePresence, motion } from "motion/react";
import { fade, popover, pulse, springs } from "../../../design/motion";
import { placeMenu, type Indicator } from "../model";

/** Thickness of the mark under an app, CSS px. */
export const MARK = 3;

/** A button on the bar: its icon lifts under the pointer, with its name (or what went wrong) in a label above. */
export function Item(props: {
  name: string;
  label: string | null;
  failed: boolean;
  lifted: boolean;
  size: number;
  markAt: number;
  mark?: Indicator;
  /** The Tiles shape: the button draws its own tile, as tall as the bar, and carries data-tile (the bar measures the tiles by it). */
  tile?: { background: string; radius: number };
  /** An item that opens the panel above the bar: whether the panel shows what it opens. */
  expanded?: boolean;
  /** What the item is (`data-kind`): the bar measures each item other than the apps by it, as it fits the apps (useAppFit). */
  kind?: string;
  /** A tray icon kept visible: its place among them (`data-tray`). */
  tray?: number;
  ref?: Ref<HTMLButtonElement>;
  /** The button's width when its content is not an icon of `size`. */
  width?: number;
  /** The id of what a screen reader says after the name: a widget's content. */
  describedBy?: string;
  onEnter: () => void;
  onLeave: () => void;
  onClick: MouseEventHandler<HTMLButtonElement>;
  onDoubleClick?: MouseEventHandler<HTMLButtonElement>;
  onContextMenu: MouseEventHandler<HTMLButtonElement>;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
  children: ReactNode;
}) {
  return (
    // The gap under the bar (GAP, h-1) belongs to the button above it, so a click with the pointer pushed against the screen's
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
      onPointerEnter={props.onEnter}
      onPointerLeave={props.onLeave}
      onClick={props.onClick}
      onDoubleClick={props.onDoubleClick}
      onContextMenu={props.onContextMenu}
      onPointerDown={props.onPointerDown}
      data-tile={props.tile ? "" : undefined}
      className="group relative flex shrink-0 items-center justify-center after:absolute after:inset-x-0 after:top-full after:h-1"
      style={{ width: props.width ?? props.size + 16, background: props.tile?.background, borderRadius: props.tile?.radius }}
    >
      <motion.span
        className="flex transition-[scale] duration-140 ease-out motion-safe:group-active:scale-94"
        initial={false}
        animate={{ transform: `translateY(${props.lifted ? -2 : 0}px)` }}
        transition={springs.peek}
      >
        {props.children}
      </motion.span>
      {props.mark && <Mark kind={props.mark} bottom={props.markAt} />}
      <Label text={props.label} failed={props.failed} />
    </button>
  );
}

export type ItemProps = Parameters<typeof Item>[0];

/** Three pulses, ending on the solid accent: an app can wait for attention a long time, and the bar stays idle meanwhile. */
const ATTENTION = { ...pulse, repeat: 5 };

/**
 * Under an app: a dot while it is open, a longer mark while it is in front, the accent while a window asks for attention, pulsing
 * when that starts. Both shapes are drawn whole and change by opacity and scale only.
 */
function Mark({ kind, bottom }: { kind: Indicator; bottom: number }) {
  const long = kind === "front" || kind === "attention";
  return (
    // No initial={false} here: a mark that appears asking for attention pulses too, where initial={false} would leave it dim.
    <motion.span
      className="absolute inset-x-0 flex justify-center"
      style={{ bottom, height: MARK }}
      animate={{ opacity: kind === "attention" ? [1, 0.35] : 1 }}
      transition={kind === "attention" ? ATTENTION : fade}
    >
      <motion.span
        className="absolute rounded-full bg-label-2"
        style={{ width: MARK, height: MARK }}
        initial={false}
        animate={{ opacity: kind === "open" ? 1 : 0, transform: `scale(${kind === "open" ? 1 : 0.5})` }}
        transition={springs.snappy}
      />
      <motion.span
        className={`absolute w-4 rounded-full ${kind === "attention" ? "bg-accent" : "bg-label"}`}
        style={{ height: MARK }}
        initial={false}
        animate={{ opacity: long ? 1 : 0, transform: `scaleX(${long ? 1 : 0.25})` }}
        transition={springs.snappy}
      />
    </motion.span>
  );
}

/** A button's name above it, or what went wrong; never takes the pointer. */
function Label({ text, failed }: { text: string | null; failed: boolean }) {
  return <AnimatePresence>{text !== null && <Bubble key={text} text={text} failed={failed} />}</AnimatePresence>;
}

function Bubble({ text, failed }: { text: string; failed: boolean }) {
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
      className={`pointer-events-none absolute bottom-full left-1/2 mb-2 max-w-80 -translate-x-1/2 truncate rounded-[8px] bg-elevated px-2 py-1 text-footnote font-medium shadow-[0_4px_14px_rgb(0_0_0/0.4)] ring-1 ring-separator ${failed ? "text-red" : "text-label"}`}
      style={{ marginLeft: shift }}
      initial={{ opacity: 0, transform: "translateY(2px) scale(0.96)" }}
      animate={{ opacity: 1, transform: "translateY(0px) scale(1)", transition: popover.enter }}
      exit={{ opacity: 0, transform: "scale(0.98)", transition: popover.exit }}
    >
      {text}
    </motion.span>
  );
}
