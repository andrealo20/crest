// The bar's Unread widget: the apps it counts and where a click on its faces lands. Pure, so it is tested without the app, and it
// imports nothing from model.ts, which imports it.

/** WhatsApp from the Microsoft Store, the first app offered (lower-case AppUserModelID). */
export const WHATSAPP = "5319275a.whatsappdesktop_cv1g1gvanyjgm!app";
/** The apps one widget counts at most. */
export const MAX_UNREAD = 3;
/** One counted app: its id, its name and the notifications it still has in Windows' notification centre. */
export interface UnreadApp {
  id: string;
  name: string;
  count: number;
}
/** An app's cell in the faces and the room between two, px at scale 1. */
export const UNREAD = { slot: 28, gap: 6 } as const;

/** Saved picks as valid ones: an array is kept (empty too), anything else is `fallback`; lower-case trimmed ids up to 512 characters, once each, MAX_UNREAD at most. */
export function normalizeUnread(v: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(v)) return [...fallback];
  const ids = v.filter((x): x is string => typeof x === "string").map((x) => x.trim().toLowerCase()).filter((x) => x && x.length <= 512);
  return [...new Set(ids)].slice(0, MAX_UNREAD);
}

/**
 * The app a click on the version with each app lands on, `x` the pointer in the face's px (null by keyboard or on the resting icon),
 * `n` the apps drawn; null with fewer than two, where the click opens the one in front. Split halfway between two cells; right to left
 * the first app is at the right end.
 */
export function unreadSlot(x: number | null, n: number, rtl: boolean): number | null {
  if (x === null || n < 2) return null;
  const at = Math.min(n - 1, Math.max(0, Math.floor((x + UNREAD.gap / 2) / (UNREAD.slot + UNREAD.gap))));
  return rtl ? n - 1 - at : at;
}
