import { useEffect, useState, type ReactNode } from "react";
import type { PetId } from "../parts";

/*
 * A small animated pet in the closed row, drawn here (no artwork from elsewhere). It breathes and blinks, bobs to the music
 * while something plays, looks up and hops while the pointer is on the notch, and falls asleep after SLEEP_MS with neither.
 * All motion is CSS keyframes on transform (global.css, .pet-*): the compositor runs them, and they pause while a notice
 * covers the row and stop for reduced motion.
 */

export const PET_W = 24;
const SLEEP_MS = 5 * 60_000;

export const PET_NAMES: Record<PetId, string> = { cat: "Katze", dog: "Hund", robot: "Roboter", jelly: "Qualle", slime: "Schleim", flame: "Flämmchen" };

type Mood = "awake" | "music" | "look" | "sleep";

/** Awake, or asleep after a while with no music and no visit. */
function useMood(playing: boolean, hovered: boolean): Mood {
  const [asleep, setAsleep] = useState(false);
  useEffect(() => {
    if (playing || hovered) return setAsleep(false);
    const id = window.setTimeout(() => setAsleep(true), SLEEP_MS);
    return () => window.clearTimeout(id);
  }, [playing, hovered]);
  if (hovered) return "look";
  if (playing) return "music";
  return asleep ? "sleep" : "awake";
}

/** Two eyes at (x, y) apart by `gap`: open with a blink, or closed lines while asleep; while looking they turn up. */
function Eyes({ x, y, gap, mood, color = "#1b1b1f", r = 1.3 }: { x: number; y: number; gap: number; mood: Mood; color?: string; r?: number }) {
  if (mood === "sleep")
    return (
      <g stroke={color} strokeWidth={1} strokeLinecap="round" fill="none">
        <path d={`M${x - r} ${y} q${r} ${r * 0.9} ${2 * r} 0`} />
        <path d={`M${x + gap - r} ${y} q${r} ${r * 0.9} ${2 * r} 0`} />
      </g>
    );
  return (
    <g className="pet-blink" fill={color} style={{ transform: mood === "look" ? "translate(0.6px, -0.8px)" : undefined }}>
      <circle cx={x} cy={y} r={r} />
      <circle cx={x + gap} cy={y} r={r} />
    </g>
  );
}

const draw: Record<PetId, (mood: Mood) => ReactNode> = {
  cat: (mood) => (
    <>
      <path d="M5 9 L6.5 3 L10.5 7 Z M19 9 L17.5 3 L13.5 7 Z" fill="#f4a27c" />
      <ellipse cx={12} cy={12.5} rx={8} ry={6.2} fill="#f4a27c" />
      <Eyes x={9} y={12} gap={6} mood={mood} />
      <path d="M11.2 14.3 h1.6 l-0.8 0.9 Z" fill="#e8657a" />
      <path d="M3 13.5 h3.4 M3.3 15.2 l3.1 -0.6 M21 13.5 h-3.4 M20.7 15.2 l-3.1 -0.6" stroke="#fff" strokeOpacity={0.55} strokeWidth={0.6} strokeLinecap="round" />
    </>
  ),
  dog: (mood) => (
    <>
      {/* Floppy ears behind the head, hanging at its sides. */}
      <path d="M6.6 7.4 C3.6 7.6 2.8 12.4 4.2 15.2 C5.2 15.8 6.6 14.6 7.4 12.4 Z" fill="#a8744a" />
      <path d="M17.4 7.4 C20.4 7.6 21.2 12.4 19.8 15.2 C18.8 15.8 17.4 14.6 16.6 12.4 Z" fill="#a8744a" />
      <ellipse cx={12} cy={12.5} rx={6.8} ry={6.2} fill="#e3b07a" />
      <Eyes x={9.3} y={11.6} gap={5.4} mood={mood} />
      <ellipse cx={12} cy={14.6} rx={1.5} ry={1.05} fill="#1b1b1f" />
      {mood === "music" && <path d="M11.3 16 h1.4 v1.1 a0.7 0.7 0 0 1 -1.4 0 Z" fill="#ef7a8b" />}
    </>
  ),
  robot: (mood) => (
    <>
      <path d="M12 6.2 V2.8" stroke="#9aa7c7" strokeWidth={1.1} strokeLinecap="round" />
      <circle cx={12} cy={2.4} r={1.4} fill="#5ee0ff" className={mood === "sleep" ? undefined : "pet-glow"} />
      <rect x={4} y={6} width={16} height={12.5} rx={4.2} fill="#9aa7c7" />
      <rect x={5.6} y={7.6} width={12.8} height={9.3} rx={3} fill="#1e2433" />
      {mood === "sleep" ? (
        <Eyes x={9.2} y={12.4} gap={5.6} mood={mood} color="#5ee0ff" />
      ) : (
        <g className="pet-blink" fill="#5ee0ff" style={{ transform: mood === "look" ? "translate(0.6px, -0.8px)" : undefined }}>
          <rect x={8} y={10.3} width={2.4} height={4.2} rx={1.2} />
          <rect x={13.6} y={10.3} width={2.4} height={4.2} rx={1.2} />
        </g>
      )}
    </>
  ),
  jelly: (mood) => (
    <>
      <g className={mood === "sleep" ? undefined : "pet-wave"} stroke="#f49ac1" strokeWidth={1.2} strokeLinecap="round" fill="none">
        <path d="M7 12 q-1 2.5 0 4.5 t0 3" />
        <path d="M10.3 12 q-1 2.5 0 4.5 t0 3" />
        <path d="M13.7 12 q1 2.5 0 4.5 t0 3" />
        <path d="M17 12 q1 2.5 0 4.5 t0 3" />
      </g>
      <path d="M4.2 12.6 Q4 3.6 12 3.6 Q20 3.6 19.8 12.6 Q12 14.2 4.2 12.6 Z" fill="#f49ac1" />
      <Eyes x={9.6} y={9.4} gap={4.8} mood={mood} />
    </>
  ),
  slime: (mood) => (
    <>
      <path d="M3.5 18.5 Q3 10.5 9 8 Q12 4.8 15 8 Q21 10.5 20.5 18.5 Z" fill="#7ee08f" />
      <ellipse cx={8} cy={10.6} rx={1.3} ry={0.8} fill="#fff" fillOpacity={0.5} />
      <Eyes x={9.4} y={13.2} gap={5.2} mood={mood} />
    </>
  ),
  flame: (mood) => (
    <>
      <path d="M5.5 18.6 L18.5 16.4 M18.5 18.6 L5.5 16.4" stroke="#8a5a3c" strokeWidth={1.8} strokeLinecap="round" />
      <g className={mood === "sleep" ? undefined : "pet-flicker"}>
        <path d="M12 2.5 C15.8 6.6 17.6 9.6 17 12.8 C16.4 15.6 14.2 17 12 17 C9.8 17 7.6 15.6 7 12.8 C6.5 10.2 8 8.4 9.4 7 C9.6 8.7 10.4 9.6 11.2 9.8 C10.8 7.2 11.2 4.8 12 2.5 Z" fill={mood === "sleep" ? "#c7713f" : "#ff8a3d"} />
        <path d="M12 8.8 C13.9 10.7 14.6 12.4 14.2 13.9 C13.8 15.3 12.9 15.9 12 15.9 C11.1 15.9 10.2 15.3 9.8 13.9 C9.5 12.6 10.6 11.3 12 8.8 Z" fill={mood === "sleep" ? "#d9a35a" : "#ffd36a"} />
      </g>
      <Eyes x={10.6} y={13.4} gap={2.8} mood={mood} r={0.8} />
    </>
  ),
};

/** The pet, in the mood `playing` and `hovered` give; `paused` stops its motion (a notice covers the row). */
export function PetPart({ pet, playing, hovered, paused }: { pet: PetId; playing: boolean; hovered: boolean; paused: boolean }) {
  const mood = useMood(playing, hovered);
  return (
    <span className="relative flex items-center" style={{ width: PET_W, height: 20 }} data-paused={paused ? "" : undefined}>
      <svg viewBox="0 0 24 20" width={PET_W} height={20} className={`pet pet-${mood}`} aria-hidden>
        <g className="pet-body">{draw[pet](mood)}</g>
      </svg>
      {mood === "sleep" && (
        <span aria-hidden className="pet-z pointer-events-none absolute -top-1 -right-1 text-[8px] leading-none font-bold text-label-3">
          z
        </span>
      )}
    </span>
  );
}
