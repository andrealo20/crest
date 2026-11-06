import { useEffect, useRef, useState } from "react";
import { frame, motion, type MotionValue, type Transition } from "motion/react";
import { springs } from "../../design/motion";
import { useNowPlaying } from "../../platform/media";
import { system } from "../../features/system/store";
import { finishedDownload } from "../../features/downloads/store";
import { saved } from "../../features/capture/store";
import { todos } from "../../features/todos/store";
import { uprightCss, type Edge } from "../edge";
import { keyboardFocus, onPetHover, setPetRect } from "../../platform/native";
import { NEST_GAP, NEST_ZOOM, type PetId, type PetSettings } from "../row/parts";
import { petMarkup } from "./art";
import "./pet.css";

/*
 * The nest: a small island of its own beside the closed notch with the chosen pet, at its own size. Every pet does the same
 * things: it bobs to the music, runs with the CPU load (faster as it rises), hops at a notice, cheers when something is done
 * (a finished download, a saved capture, a to-do ticked), waves while the pointer is on the notch, and falls asleep after
 * SLEEP_MS with none of that. A click makes it bigger until the pointer leaves.
 */

/** Designed size of the nest; the chosen size scales it (a transform, so no layout pass). */
export const NEST_BOX = 48;
const SLEEP_MS = 5 * 60_000, CHEER_MS = 2600, ALERT_MS = 4000, RUN_FROM = 30;
/** The nest comes in after the closing panel has mostly folded away. */
const ENTER_DELAY = 0.2;

export type PetMood = "idle" | "music" | "run" | "alert" | "cheer" | "wave" | "sleep";

/** CPU load as a stride: 0.7 s at RUN_FROM %, 0.3 s at 100 %, in 0.05 s steps (a new duration jumps the running animations' phase). */
export const paceFor = (cpu: number) => `${(Math.round((0.7 - (Math.min(100, Math.max(RUN_FROM, cpu)) - RUN_FROM) * (0.4 / (100 - RUN_FROM))) * 20) / 20).toFixed(2)}s`;

/** Something just got done: a finished download, a saved capture or a to-do ticked; true for CHEER_MS after it. */
function useCheer(): boolean {
  const download = finishedDownload.use()?.at ?? 0;
  const capture = saved.use()?.at ?? 0;
  const tasks = todos.use().tasks;
  const ticked = tasks.reduce((m, t) => Math.max(m, t.doneAt ?? 0), 0);
  const last = Math.max(download, capture, ticked);
  const [on, setOn] = useState(false);
  const seen = useRef(last);
  useEffect(() => {
    // Only what happens from now on: tasks done before Crest started don't count.
    const fresh = last > seen.current && Date.now() - last <= CHEER_MS;
    seen.current = last;
    // The cleanup of the run before cancelled its timer: if last fell (the download's notice was dismissed), nothing else would turn it off.
    if (!fresh) return setOn(false);
    setOn(true);
    const id = window.setTimeout(() => setOn(false), CHEER_MS);
    return () => window.clearTimeout(id);
  }, [last]);
  return on;
}

/** True for `ms` after `on` turns true: a recording or a question stays on for long, the pet only jumps at it. */
function useBriefly(on: boolean, ms: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(on);
    if (!on) return;
    const id = window.setTimeout(() => setShown(false), ms);
    return () => window.clearTimeout(id);
  }, [on, ms]);
  return shown;
}

export function usePetMood(noticeOn: boolean, hovered: boolean): { mood: PetMood; pace: string } {
  const notice = useBriefly(noticeOn, ALERT_MS);
  const playing = !!useNowPlaying()?.isPlaying;
  const cpu = system.use().stats?.cpu ?? 0;
  const cheer = useCheer();
  const busy = cpu >= RUN_FROM;
  const [asleep, setAsleep] = useState(false);
  const active = playing || hovered || notice || cheer || busy;
  useEffect(() => {
    if (active) return setAsleep(false);
    const id = window.setTimeout(() => setAsleep(true), SLEEP_MS);
    return () => window.clearTimeout(id);
  }, [active]);
  const mood: PetMood = cheer ? "cheer" : notice ? "alert" : hovered ? "wave" : playing ? "music" : busy ? "run" : asleep ? "sleep" : "idle";
  return { mood, pace: paceFor(cpu) };
}

/** The pet itself, 80x80 designed, in `mood`. The markup is built from constants in art.ts, never from user text. */
export function PetArt({ id, mood, pace, size, paused }: { id: PetId; mood: PetMood; pace: string; size: number; paused?: boolean }) {
  return (
    <svg
      viewBox="0 0 80 80"
      width={size}
      height={size}
      aria-hidden
      className={`pet ${mood}${paused ? " paused" : ""}`}
      style={{ ["--pace" as string]: pace }}
      dangerouslySetInnerHTML={{ __html: petMarkup(id) }}
    />
  );
}

/**
 * The nest beside the closed shape, in the notch's wrapper (outside its hit zone, so the pointer on the pet doesn't open the
 * notch): `top` follows the shape's top as it springs, `shapeWidth` puts it beside the shape on the chosen side. No backdrop:
 * the pet stands on its own shadow. On the bottom and side edges the frame turns the wrapper, so the pet is turned back upright.
 * Natively the nest reports its own zone to Rust, which makes the window take the pointer there and says when it leaves.
 */
export function Nest({ pet, edge, top, shapeWidth, shapeTransition, notice, hovered }: { pet: PetSettings & { id: PetId }; edge: Edge; top: MotionValue<number>; shapeWidth: number; shapeTransition: Transition; notice: boolean; hovered: boolean }) {
  const { mood, pace } = usePetMood(notice, hovered);
  const right = pet.side === "right";
  const [big, setBig] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // The last zone sent: top's changes and the animation's updates often land in one frame with the same rect.
  const sent = useRef("");
  const report = () => {
    const r = ref.current?.getBoundingClientRect();
    const key = r && `${r.x},${r.y},${r.width},${r.height}`;
    if (!r || key === sent.current) return;
    sent.current = key!;
    setPetRect({ x: r.x, y: r.y, w: r.width, h: r.height });
  };
  useEffect(() => {
    report();
    const offTop = top.on("change", () => frame.postRender(report));
    const offHover = onPetHover((inside) => !inside && setBig(false));
    // Another edge or a window of another length (another monitor) moves the nest by a transform or by its centring, which nothing here animates.
    const onResize = () => frame.postRender(report);
    window.addEventListener("resize", onResize);
    return () => {
      offTop();
      offHover();
      window.removeEventListener("resize", onResize);
      sent.current = "";
      setPetRect(null);
    };
    // report reads the element each time; it needs no dependencies of its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top, edge]);
  const scale = (pet.size / NEST_BOX) * (big ? NEST_ZOOM : 1);
  const x = right ? shapeWidth / 2 + NEST_GAP : -(shapeWidth / 2 + NEST_GAP + NEST_BOX);
  return (
    <motion.div
      ref={ref}
      aria-hidden
      className="pointer-events-auto absolute left-1/2 cursor-pointer"
      style={{ top, width: NEST_BOX, height: NEST_BOX, transformOrigin: right ? "0% 0%" : "100% 0%" }}
      initial={{ opacity: 0, scale: 0.6, x }}
      animate={{ opacity: 1, scale, x }}
      exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.18 } }}
      transition={{ default: springs.snappy, x: shapeTransition, opacity: { ...springs.snappy, delay: ENTER_DELAY } }}
      onUpdate={() => frame.postRender(report)}
      onClick={(e) => {
        // Its own click: the notch neither opens nor closes.
        e.stopPropagation();
        setBig(true);
        // The click activated the window; give the keyboard back to the app it came from.
        keyboardFocus(false);
      }}
      onPointerLeave={() => setBig(false)}
    >
      <div className="grid size-full place-items-center" style={{ transform: uprightCss(edge) }}>
        <PetArt id={pet.id} mood={mood} pace={pace} size={NEST_BOX} paused={mood === "sleep"} />
      </div>
    </motion.div>
  );
}
