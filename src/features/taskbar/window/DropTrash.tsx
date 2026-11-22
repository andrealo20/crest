import { useEffect, useReducer, useRef, type CSSProperties, type Ref } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { design } from "../../../design/design";
import { popover, springs } from "../../../design/motion";
import { Trash } from "../../../ui/iconset";
import type { BarEdge } from "../model";
import { TRASH_ARM_MS, trashArmed, trashRest } from "../panelModel";
import { growFrom, nudge } from "../position";

/**
 * Whether the trash is armed with the pointer `inside` it (trashArmed). Each move of the drag renders it again; a pointer resting
 * still on the trash is woken when its time is up, and once more by a wake that comes a little early.
 */
export function useTrashArmed(inside: boolean): boolean {
  // Written while rendering, as glass/bar.ts writes its `place`: the moves that render it are what it follows.
  const since = useRef<number | null>(null);
  const now = performance.now();
  since.current = trashRest(since.current, inside, now);
  const at = since.current, armed = trashArmed(at, now);
  const [woken, wake] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (at === null || armed) return;
    const id = window.setTimeout(wake, at + TRASH_ARM_MS - performance.now());
    return () => window.clearTimeout(id);
  }, [at, armed, woken]);
  return armed;
}

/** Armed, a deeper red: still 4.5:1 for Dark's black glyph, and only darker under a light theme's light one. */
const ARMED_FILL = { background: "color-mix(in srgb, var(--color-red), black 15%)" };

/**
 * The red disc a dragged item is dropped on to take it away (ItemDrop on the bar, DockDrop on the notch's tool bar), there while
 * the drag runs (`shown`) and growing out of its side towards `edge` as a menu does. Armed (useTrashArmed) it swells and turns a
 * deeper red with a ring, so the change is not the scale alone, since only then does a release there take the item away. Drawn
 * only: the pressed button holds the pointer, so the drag tests the pointer against the disc's box itself. `className` and `style`
 * place it.
 */
export function DropTrash({ shown, armed, edge, className, style, ref }: { shown: boolean; armed: boolean; edge: BarEdge; className: string; style?: CSSProperties; ref?: Ref<HTMLSpanElement> }) {
  const appDesign = design.use();
  // As BarMenu: MotionConfig's reducedMotion keeps a transform string, so the reduced start is chosen here.
  const reduced = useReducedMotion() === true;
  return (
    <AnimatePresence>
      {shown && (
        <motion.span
          key="trash"
          ref={ref}
          aria-hidden
          className={`pointer-events-none flex size-10 ${className}`}
          style={{ ...style, transformOrigin: growFrom(edge) }}
          initial={{ opacity: 0, transform: `scale(${appDesign === "material" && !reduced ? 0.8 : 0.96}) translateY(${nudge(edge)}px)` }}
          animate={{ opacity: 1, transform: "scale(1) translateY(0px)", transition: popover.enter }}
          exit={{ opacity: 0, transform: "scale(0.98)", transition: popover.exit }}
        >
          {/* Opaque, as it stands over the bare desktop or the tool view; in forced colours the outline alone tells the armed disc. */}
          <motion.span
            className={`flex size-full items-center justify-center rounded-full bg-red text-notch shadow-[0_10px_30px_rgb(0_0_0/0.6)] material:shadow-level2 forced-colors:outline-2 ${
              armed ? "outline-2 outline-offset-2 outline-label forced-colors:outline-[Highlight]" : "forced-colors:outline-[CanvasText]"
            }`}
            style={armed ? ARMED_FILL : undefined}
            initial={false}
            animate={{ transform: `scale(${armed ? 1.15 : 1})` }}
            transition={springs.pop}
          >
            <Trash size={20} weight="bold" />
          </motion.span>
        </motion.span>
      )}
    </AnimatePresence>
  );
}
