/** The cover's side in px at the Music tool's default height (tabs.ts, 232) and at most. */
export const COVER = { min: 56, max: 140 };
/** Room the title, the progress bar and the controls take beside the cover, px. */
const ROOM = 176;
/** The shortest the Music tool can be with its controls inside: that room and the smallest cover (tabs.ts, #64). */
export const MIN_HEIGHT = ROOM + COVER.min;

/**
 * The cover's side for a panel `panelH` px tall (the size the user chose, without a lyrics or mixer panel below):
 * the height beyond the default goes to the cover, so title, progress and controls keep their room.
 */
export function coverSize(panelH: number): number {
  if (!Number.isFinite(panelH)) return COVER.min;
  return Math.round(Math.min(COVER.max, Math.max(COVER.min, panelH - ROOM)));
}
