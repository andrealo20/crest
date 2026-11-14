import { AnimatePresence, motion } from "motion/react";
import { createStore } from "../../lib/store";
import { artwork as artworkSwap } from "../../design/motion";

/** The tiny cover the Music tool asks to show behind its whole panel (header and dock too); null = none. */
export const coverBackdrop = createStore<string | null>(null);

/**
 * Behind the open panel (Notch.tsx, under the content like the ambience tint): the tiny cover stretched over the panel,
 * which reads as blurred, darkened so the Dark theme's light text stays readable, and darker at the bottom where the
 * controls and the dock sit. A new cover fades in over the old one. Over the glass (dark themes only) it is partly see-through, so the glass shows under it.
 */
export function CoverBackdrop({ glass }: { glass: boolean }) {
  const src = coverBackdrop.use();
  return (
    <AnimatePresence initial={false}>
      {src && (
        <motion.div
          key="backdrop"
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]"
          initial={{ opacity: 0 }}
          animate={{ opacity: glass ? 0.65 : 1, transition: artworkSwap.enter }}
          exit={{ opacity: 0, transition: artworkSwap.exit }}
        >
          <AnimatePresence initial={false}>
            <motion.img
              key={src}
              src={src}
              alt=""
              draggable={false}
              // Larger than the panel, so the softened edges of the stretched image stay out of sight.
              className="absolute inset-0 size-full scale-125 object-cover"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: artworkSwap.enter }}
              exit={{ opacity: 0, transition: artworkSwap.exit }}
            />
          </AnimatePresence>
          <div className="absolute inset-0 bg-black/45" />
          <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/60 to-transparent" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
