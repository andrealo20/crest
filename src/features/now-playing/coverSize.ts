/** The cover's side in px at the Music tool's default height (tabs.ts, 232) and at most. */
export const COVER = { min: 56, max: 140 };

/**
 * The cover's side for a panel `panelH` px tall (the size the user chose, without a lyrics or mixer panel below):
 * the height beyond the default goes to the cover, so title, progress and controls keep their room.
 */
export function coverSize(panelH: number): number {
  if (!Number.isFinite(panelH)) return COVER.min;
  return Math.round(Math.min(COVER.max, Math.max(COVER.min, panelH - 176)));
}
