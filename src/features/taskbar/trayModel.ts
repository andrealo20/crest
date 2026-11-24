// Which of the tray's icons the bar shows and which wait in the panel behind its ^ button, and how a drag changes that. Pure, so the
// rules are tested alone.

import type { TrayIcon } from "./model.ts";

/**
 * The icons whose id is in `shown`, in the order of `shown` (icons sharing an id stay in their own order), and the rest: first those in
 * `hiddenOrder`, in its order, then the others in Rust's. An id in both lists stays visible; ids with no icon are passed over.
 */
export function splitTray(icons: TrayIcon[], shown: string[], hiddenOrder: string[] = []): { visible: TrayIcon[]; hidden: TrayIcon[] } {
  const ids = new Set(shown);
  const rest = icons.filter((i) => !ids.has(i.id));
  const listed = new Set(hiddenOrder);
  const first = [...listed].filter((id) => !ids.has(id)).flatMap((id) => rest.filter((i) => i.id === id));
  return { visible: shown.flatMap((id) => icons.filter((i) => i.id === id)), hidden: [...first, ...rest.filter((i) => !listed.has(i.id))] };
}

/**
 * `shown` with `id` at `slot`: a kept id moves there, counting its own place as the bar shows it, so a slot right before or right
 * after it leaves the order as it is; a new one goes in.
 */
export function promote(shown: string[], id: string, slot: number): string[] {
  const from = shown.indexOf(id);
  const next = shown.filter((s) => s !== id);
  next.splice(from >= 0 && slot > from ? slot - 1 : slot, 0, id);
  return next;
}

/** `shown` without `id`: its icons go to the panel. */
export const demote = (shown: string[], id: string): string[] => shown.filter((s) => s !== id);

/** The place in `shown` of the gap before the bar's `slot`-th icon (`visible`, as splitTray gives it), the end for the gap after the last. */
export const shownSlot = (shown: string[], visible: TrayIcon[], slot: number): number => (slot < visible.length ? shown.indexOf(visible[slot].id) : shown.length);

/**
 * `hiddenOrder` with `id` at the panel's `slot` among the `hidden` icons (as splitTray draws them): the list as the panel shows it, with
 * the saved ids that have no icon now kept in their places, as `shown` keeps them, and none of `shown`, so an icon from the bar goes in.
 */
export function placeHidden(hiddenOrder: string[], shown: string[], hidden: TrayIcon[], id: string, slot: number): string[] {
  const order = [...new Set([...hiddenOrder.filter((h) => !shown.includes(h)), ...hidden.map((i) => i.id)])];
  return promote(order, id, shownSlot(order, hidden, slot));
}

/**
 * Whether a tray picture's pixels (`rgba`, 4 bytes each, as ImageData holds them) are a plain white glyph, as apps and Windows draw
 * their icons for a dark taskbar. The bar draws those in the ink of what is under them, so they stay readable on a light theme (#93).
 */
export function plainWhite(rgba: ArrayLike<number>): boolean {
  let seen = false;
  for (let i = 0; i < rgba.length; i += 4) {
    // An antialiased edge is too faint to tell its colour (icons keep straight alpha, so a visible one shows its own).
    if (rgba[i + 3] < 32) continue;
    const hi = Math.max(rgba[i], rgba[i + 1], rgba[i + 2]);
    const lo = Math.min(rgba[i], rgba[i + 1], rgba[i + 2]);
    // Grey and light, as the dim parts of Windows' own glyphs are; one coloured or dark pixel keeps the icon's colours.
    if (hi - lo > 24 || lo < 160) return false;
    seen = true;
  }
  return seen;
}
