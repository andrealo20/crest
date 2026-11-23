// Folders of pinned apps on Crest's bar: the saved shape and its repair. Pure, so it is tested without the app around it. The apps
// stay in `pinned`, flat; a folder only names some of them (crest-design 2026-11-23-cartelle-barra.md, section 2).

import type { Favorite } from "../launcher/apps.ts";

/** A folder on the bar: its apps by pin id, in the folder's order; an empty name is drawn as t("Ordner"). */
export interface Folder {
  id: string;
  name: string;
  apps: string[];
}

/** A folder's name, at most. */
export const FOLDER_NAME_MAX = 40;
/** A folder's button on the bar: no launcher id starts so (apps.ts, ownpins.rs). */
export const folderKey = (id: string) => `folder:${id}`;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Saved folders as valid ones: none from anything but an array, or before any app was pinned; a folder without a string id, or with an
 * id seen before, goes; its name trimmed and cut to FOLDER_NAME_MAX; its apps only pinned ids, once, each in the first folder that has
 * it; a folder left without apps goes, one with a single app stays (decision C1).
 */
export function normalizeFolders(v: unknown, pinned: Favorite[] | null): Folder[] {
  if (!Array.isArray(v) || !pinned) return [];
  const pins = new Set(pinned.map((p) => p.id));
  const ids = new Set<string>(), taken = new Set<string>();
  const out: Folder[] = [];
  for (const f of v) {
    if (!isObj(f) || typeof f.id !== "string" || !f.id || ids.has(f.id)) continue;
    ids.add(f.id);
    const apps: string[] = [];
    for (const a of Array.isArray(f.apps) ? f.apps : []) {
      if (typeof a !== "string" || !pins.has(a) || taken.has(a)) continue;
      taken.add(a);
      apps.push(a);
    }
    if (!apps.length) continue;
    out.push({ id: f.id, name: typeof f.name === "string" ? f.name.trim().slice(0, FOLDER_NAME_MAX) : "", apps });
  }
  return out;
}
