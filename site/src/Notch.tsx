import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { springs } from "../../src/design/motion";

/** A panel as the app draws it: a picture of the demo's panel (site/src/shots), with its size in CSS px. */
export interface Shot {
  src: string;
  w: number;
  h: number;
  alt: string;
}

const CLOSED = { w: 236, h: 36 };
/** Bottom corners of the open panel, in screenshot px (the app's panel radius). */
const RADIUS = 26;

/** The time, as the closed row shows it. */
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 10_000);
    return () => window.clearInterval(id);
  }, []);
  return now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** The concave corner where the notch meets the top edge of the screen. */
const Ear = ({ side }: { side: "left" | "right" }) => (
  <svg className={`ear ear-${side}`} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d={side === "left" ? "M0 0H14V14A14 14 0 0 0 0 0Z" : "M14 0H0V14A14 14 0 0 1 14 0Z"} fill="#000" />
  </svg>
);

/**
 * Crest's notch, moved by the app's own springs: closed it shows a row (cover, time, equalizer); open it grows into the
 * panel of `shot`, scaled to fit `maxW`. Changing `shot` while open morphs from one panel to the next.
 */
export function Notch({ shot, open, maxW, onToggle, label }: { shot: Shot | null; open: boolean; maxW: number; onToggle?: () => void; label?: string }) {
  const time = useClock();
  const scale = shot ? Math.min(1.25, maxW / shot.w) : 1;
  const size = open && shot ? { w: Math.round(shot.w * scale), h: Math.round(shot.h * scale) } : CLOSED;
  const radius = open ? RADIUS * scale : 18;

  const body = (
    <>
      <AnimatePresence initial={false} mode="popLayout">
        {open && shot ? (
          <motion.img
            key={shot.src}
            src={shot.src}
            alt={shot.alt}
            width={Math.round(shot.w * scale)}
            height={Math.round(shot.h * scale)}
            className="notch-shot"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={springs.morph}
          />
        ) : (
          <motion.div key="row" className="notch-row" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }}>
            <span className="notch-cover" aria-hidden="true" />
            <span className="notch-time">{time}</span>
            <span className="notch-bars" aria-hidden="true"><i /><i /><i /><i /></span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  const props = {
    className: "notch",
    initial: false,
    animate: { width: size.w, height: size.h, borderBottomLeftRadius: radius, borderBottomRightRadius: radius },
    transition: open ? springs.open : springs.close,
  } as const;

  return (
    <div className="notch-wrap">
      <Ear side="left" />
      <Ear side="right" />
      {onToggle ? (
        <motion.button type="button" {...props} onClick={onToggle} aria-expanded={open} aria-label={label}>
          {body}
        </motion.button>
      ) : (
        <motion.div {...props}>{body}</motion.div>
      )}
    </div>
  );
}
