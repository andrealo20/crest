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

/**
 * The picked apps in their order with their counts from `counts` (lower-case app id to toasts waiting), 0 for one not there; the name
 * Windows gave (`seen`, notices.apps), else "WhatsApp" for WHATSAPP, else the id. Null while `counts` is, that is Windows is not read.
 */
export function unreadApps(picks: readonly string[], seen: Record<string, string>, counts: Record<string, number> | null): UnreadApp[] | null {
  if (!counts) return null;
  return picks.map((id) => ({ id, name: seen[id] ?? (id === WHATSAPP ? "WhatsApp" : id), count: counts[id] ?? 0 }));
}

/** The app with the most waiting, the first on a tie; null for none. */
export function unreadLead(apps: readonly UnreadApp[]): UnreadApp | null {
  return apps.reduce<UnreadApp | null>((lead, a) => (!lead || a.count > lead.count ? a : lead), null);
}

/**
 * The apps the settings offer: WhatsApp first, seen or not, then the apps seen by name, then picks no longer among them with their id
 * as the name; once each. crest-notify's sources (`cli:`) are left out, since they never leave a toast in the notification centre.
 */
export function unreadChoices(seen: Record<string, string>, picks: readonly string[]): { id: string; name: string }[] {
  const apps = Object.entries(seen)
    .filter(([id]) => id !== WHATSAPP && !id.startsWith("cli:"))
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const gone = picks.filter((id) => id !== WHATSAPP && !(id in seen)).map((id) => ({ id, name: id }));
  return [{ id: WHATSAPP, name: seen[WHATSAPP] ?? "WhatsApp" }, ...apps, ...gone];
}

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
