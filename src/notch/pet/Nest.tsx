import { useEffect, useRef, useState } from "react";
import { motion, type MotionValue } from "motion/react";
import { springs } from "../../design/motion";
import { useNowPlaying } from "../../platform/media";
import { system } from "../../features/system/store";
import { finishedDownload } from "../../features/downloads/store";
import { saved } from "../../features/capture/store";
import { todos } from "../../features/todos/store";
import { uprightCss, type Edge } from "../edge";
import type { PetId, PetSettings } from "../row/parts";
import { petMarkup } from "./art";
import "./pet.css";

/*
 * The nest: a small island of its own beside the closed notch with the chosen pet, at its own size. Every pet does the same
 * things: it bobs to the music, runs with the CPU load (faster as it rises), hops at a notice, cheers when something is done
 * (a finished download, a saved capture, a to-do ticked), waves while the pointer is on the notch, and falls asleep after
 * SLEEP_MS with none of that. The pointer passes through it: the nest only shows.
 */

/** Designed size of the nest; the chosen size scales it (a transform, so no layout pass). */
export const NEST_BOX = 48;
const SLEEP_MS = 5 * 60_000, CHEER_MS = 2600, RUN_FROM = 30;

export type PetMood = "idle" | "music" | "run" | "alert" | "cheer" | "wave" | "sleep";

/** CPU load as a stride: 0.7 s at RUN_FROM %, 0.3 s at 100 %. */
export const paceFor = (cpu: number) => `${(0.7 - (Math.min(100, Math.max(RUN_FROM, cpu)) - RUN_FROM) * (0.4 / (100 - RUN_FROM))).toFixed(2)}s`;

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
    if (last <= seen.current || Date.now() - last > CHEER_MS) return void (seen.current = last);
    seen.current = last;
    setOn(true);
    const id = window.setTimeout(() => setOn(false), CHEER_MS);
    return () => window.clearTimeout(id);
  }, [last]);
  return on;
}

export function usePetMood(notice: boolean, hovered: boolean): { mood: PetMood; pace: string } {
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
  const mood: PetMood = notice ? "alert" : cheer ? "cheer" : hovered ? "wave" : playing ? "music" : busy ? "run" : asleep ? "sleep" : "idle";
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
 * The nest beside the closed shape, inside the notch's hit wrapper: `top` follows the shape's top as it springs, the side
 * is the chosen one. On the bottom and side edges the frame turns the wrapper, so the nest's content is turned back upright.
 */
export function Nest({ pet, edge, top, notice, hovered }: { pet: PetSettings & { id: PetId }; edge: Edge; top: MotionValue<number>; notice: boolean; hovered: boolean }) {
  const { mood, pace } = usePetMood(notice, hovered);
  const right = pet.side === "right";
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute"
      style={{ top, [right ? "left" : "right"]: "calc(100% - 8px)", width: NEST_BOX, height: NEST_BOX, transformOrigin: right ? "0% 0%" : "100% 0%" }}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: pet.size / NEST_BOX }}
      exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.18 } }}
      transition={springs.snappy}
    >
      <div
        className="grid size-full place-items-center rounded-full bg-(--shape) shadow-[0_8px_22px_rgb(0_0_0/0.45)]"
        style={{ transform: uprightCss(edge), backgroundImage: "radial-gradient(60% 60% at 50% 38%, rgb(255 255 255 / 0.09), transparent 80%)" }}
      >
        <PetArt id={pet.id} mood={mood} pace={pace} size={NEST_BOX - 2} />
      </div>
    </motion.div>
  );
}
