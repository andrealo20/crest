import { useEffect } from "react";
import { createStore } from "../../lib/store";
import type { PartId } from "./parts";

/** Whether the closed row is on screen (notch closed or peeking, not the line, not focus, not hidden for fullscreen). CompactRow sets it while mounted; the usage and system polling read it. */
export const rowVisible = createStore(false);

/** The parts Crest's bar shows as widgets while it is on and shown (only Discord while it hides, feed.tsx), else none: the system, calendar, Discord and downloads stores run their source for them even with the part or tool off. */
export const barParts = createStore<readonly PartId[]>([]);

/** Rows and columns mounted: an exiting one and the next can overlap for a moment, and the polling must stay on in between. */
let mounted = 0;

/** Marks the closed row (or the side column) as on screen while the calling component is mounted and `on`. */
export function useRowVisible(on = true) {
  useEffect(() => {
    if (!on) return;
    rowVisible.set(++mounted > 0);
    return () => rowVisible.set(--mounted > 0);
  }, [on]);
}
