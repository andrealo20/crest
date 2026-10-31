import { LockSimple, SignOut } from "@phosphor-icons/react";
import { t } from "../../../i18n";
import { fps, useFpsPolling } from "../../../features/system/gaming";
import { levelColor } from "../../../features/system/SystemView";
import { system } from "../../../features/system/store";
import type { ClosedSettings } from "../parts";
import { CAPTION_FONT, measureText } from "../measure";

export type ReadingId = "fps" | "cpu" | "ram" | "gpu";
export interface Reading { id: ReadingId; value: number | null }

export const READING_GAP = 6;
const DIAL = 16, DIAL_GAP = 3;
const LETTER: Record<Exclude<ReadingId, "fps">, string> = { cpu: "C", ram: "M", gpu: "G" };

// Room for "100%": tabular digits are each as wide as an 8.
const digits = () => measureText("888%");
export const readingWidth = (id: ReadingId) => (id === "fps" ? measureText("FPS", CAPTION_FONT) : DIAL) + DIAL_GAP + digits();

/** Once the GPU has answered with a number it has counters; before that (or never, without them) it stays out of the row. */
let gpuSeen = false;

/**
 * The readings to show, in order: FPS first during gaming (polled here, once a second), then CPU, RAM, GPU. Gaming forces
 * CPU, RAM and GPU on even when the part or the single readings are off. Without numbers yet, and no gaming, none.
 * The values come from the system store's own rhythms (GPU every 2 s while it is in the row); the ping is never woken here.
 */
export function useReadings(closed: ClosedSettings, gaming: boolean): Reading[] {
  useFpsPolling(gaming);
  const f = fps.use();
  const { stats } = system.use();
  if (stats?.gpu != null) gpuSeen = true;
  if (!gaming && (!closed.parts.readings || !stats)) return [];
  const on = closed.readings, list: Reading[] = [];
  if (gaming) list.push({ id: "fps", value: f.value });
  if (gaming || on.cpu) list.push({ id: "cpu", value: stats?.cpu ?? null });
  if (gaming || on.ram) list.push({ id: "ram", value: stats ? (stats.memUsed / stats.memTotal) * 100 : null });
  if ((gaming || on.gpu) && gpuSeen) list.push({ id: "gpu", value: stats?.gpu ?? null });
  return list;
}

/** A dial open at the bottom with its letter, then the number; FPS as a word instead of the dial. */
export function ReadingView({ reading: { id, value } }: { reading: Reading }) {
  const color = id === "fps" ? "var(--color-label)" : levelColor(value ?? 0);
  return (
    <span className="flex shrink-0 items-center" style={{ gap: DIAL_GAP, width: readingWidth(id), color }}>
      {id === "fps" ? <span className="text-caption font-medium text-label-3">FPS</span> : <Dial letter={LETTER[id]} value={value ?? 0} />}
      <span className="tabular text-right text-footnote font-medium transition-colors duration-300" style={{ width: digits() }}>
        {id === "fps" ? <FpsValue /> : value === null ? "-" : `${Math.round(value)}%`}
      </span>
    </span>
  );
}

function Dial({ letter, value }: { letter: string; value: number }) {
  const v = Math.min(100, Math.max(0, value)) * 0.75;
  return (
    <svg width={DIAL} height={DIAL} viewBox="0 0 16 16" className="shrink-0" aria-hidden>
      {/* 270 degrees from bottom left round to bottom right, the gap at the bottom. */}
      <g transform="rotate(135 8 8)" fill="none" strokeWidth="2" strokeLinecap="round">
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeOpacity={0.25} pathLength={100} strokeDasharray="75 100" />
        {v > 0 && <circle cx="8" cy="8" r="7" stroke="currentColor" pathLength={100} strokeDasharray={`${v} 100`} />}
      </g>
      <text x="8" y="8.5" textAnchor="middle" dominantBaseline="middle" fontSize="7" fontWeight="700" fill="currentColor">
        {letter}
      </text>
    </svg>
  );
}

/** Lock = not unlocked yet (Settings, Display), sign-out = unlocked, active after the next sign-in, dash = no frame measured yet. */
function FpsValue() {
  const f = fps.use();
  if (f.error === "no-admin") return <LockSimple size={11} weight="bold" className="inline text-label-3" aria-label={t("FPS freischalten: Einstellungen → Darstellung")} />;
  if (f.error === "relogin") return <SignOut size={11} weight="bold" className="inline text-orange" aria-label={t("Einmal ab- und wieder anmelden, dann laufen die FPS")} />;
  return <>{f.value === null ? "-" : Math.round(f.value)}</>;
}
