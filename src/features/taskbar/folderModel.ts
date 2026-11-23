// Folders of pinned apps on Crest's bar: the saved shape, its repair and every write to it. Pure, so it is tested without the app around
// it. The apps stay in `pinned`, flat; a folder only names some of them (crest-design 2026-11-23-cartelle-barra.md, section 2).

import type { Favorite } from "../launcher/apps.ts";
import type { PinSlot } from "./model.ts";

/** A folder on the bar: its apps by pin id, in the folder's order; an empty name is drawn as t("Ordner"). */
export interface Folder {
  id: string;
  name: string;
  apps: string[];
}

/** The pinned apps and their folders, as the bar's settings keep them. */
export type Pins = { pinned: Favorite[]; folders: Folder[] };

/** A folder's name, at most. */
export const FOLDER_NAME_MAX = 40;
/** How long a pinned app dragged over another place rests there before a drop makes a folder, ms: between the trash's 300 and a file's 600. */
export const FOLDER_REST = 500;
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

/** A new folder's name (decision C3): `label(1)` ("Ordner"), else `label(2)`, `label(3)` … , the first no folder is called; an unnamed one is called `label(1)`. */
export function nextName(folders: Folder[], label: (n: number) => string): string {
  const taken = new Set(folders.map((f) => f.name || label(1)));
  let n = 1;
  while (taken.has(label(n))) n++;
  return label(n);
}

/** The mini icons of a folder's button `size` px wide: `mini` px each, two by two, `pad` px round and between them. */
export function folderGrid(size: number): { mini: number; pad: number } {
  const pad = Math.max(1, Math.round(size / 16));
  return { mini: Math.floor((size - 3 * pad) / 2), pad };
}

/** The place (an app's pin id or a folder's key) whose middle half holds x, never the dragged one's own; null for a folder dragged, which never goes into another. */
export function pinOver(slots: PinSlot[], id: string, x: number): string | null {
  if (id.startsWith("folder:")) return null;
  const s = slots.find((s) => x >= s.x + s.w / 4 && x <= s.x + (3 * s.w) / 4);
  return s && s.id !== id ? s.id : null;
}

// The writes below work on the bar's places: each pinned app outside a folder, and each folder at its first app's place in `pinned`.
// They write `pinned` back with every folder's apps together at its place, in its order, so the list stays readable.
type Place = string | Folder;
const keyOf = (s: Place) => (typeof s === "string" ? s : folderKey(s.id));

function placesOf(p: Pins): Place[] {
  const of = new Map<string, Folder>();
  for (const f of p.folders) for (const a of f.apps) if (!of.has(a)) of.set(a, f);
  const seen = new Set<Folder>();
  const out: Place[] = [];
  for (const f of p.pinned) {
    const folder = of.get(f.id);
    if (!folder) out.push(f.id);
    else if (!seen.has(folder)) {
      seen.add(folder);
      out.push(folder);
    }
  }
  return out;
}

/** `places` back into pinned and folders: empty folders gone (C1), the others in the order `p` had them, new ones after. */
function write(p: Pins, places: Place[], added: Folder[] = []): Pins {
  const fav = new Map(p.pinned.map((f) => [f.id, f]));
  const pinned = places.flatMap((s) => (typeof s === "string" ? [s] : s.apps)).flatMap((id) => fav.get(id) ?? []);
  const kept = new Map(places.flatMap((s) => (typeof s === "string" || !s.apps.length ? [] : [[s.id, s] as const])));
  const folders = [...p.folders, ...added].flatMap((f) => kept.get(f.id) ?? []);
  return { pinned, folders };
}

/** The index among `places` of a pin or a folder's key, a pin inside a folder at its folder's; -1 when neither. */
const placeOf = (places: Place[], key: string) => places.findIndex((s) => keyOf(s) === key || (typeof s !== "string" && s.apps.includes(key)));

/** `places` with `pin` taken from wherever it is, as a copy whose folders are copies too. */
const without = (places: Place[], pin: string): Place[] =>
  places.flatMap((s): Place[] => (typeof s === "string" ? (s === pin ? [] : [s]) : [{ ...s, apps: s.apps.filter((a) => a !== pin) }]));

/** A folder of `pin` alone, at its place (from a folder, right after that one), with id `id` and name `name`. */
export function newFolder(p: Pins, pin: string, id: string, name: string): Pins {
  const out = takeOut(p, pin);
  const places = placesOf(out);
  const at = places.indexOf(pin);
  if (at < 0) return p;
  const folder = { id, name, apps: [pin] };
  places[at] = folder;
  return write(out, places, [folder]);
}

/**
 * `pin` held on `target`: into folder `target` (a folder's key, or an app inside one) at its end, or a new folder `id` named `name` of
 * the two at the target's place, the one below first. Out of the folder it was in, which goes once empty. The same object on itself,
 * on its own folder or on a place that is not there.
 */
export function intoFolder(p: Pins, pin: string, target: string, id: string, name: string): Pins {
  const places = placesOf(p);
  const from = placeOf(places, pin), to = placeOf(places, target);
  if (from < 0 || to < 0 || from === to) return p;
  const next = without(places, pin);
  // Found again by its key: the pin's own place, gone from `next`, may have stood before it.
  const i = next.findIndex((s) => keyOf(s) === keyOf(places[to]));
  const there = next[i];
  if (typeof there === "string") {
    const folder = { id, name, apps: [there, pin] };
    next[i] = folder;
    return write(p, next, [folder]);
  }
  there.apps.push(pin);
  return write(p, next);
}

/** `pin` out of its folder: before `before` (a pin or a folder's key, null for the end), else right after its folder. The same object when it is in none, or `before` is not there. */
export function takeOut(p: Pins, pin: string, before?: string | null): Pins {
  const places = placesOf(p);
  const from = places.findIndex((s) => typeof s !== "string" && s.apps.includes(pin));
  const at = before === undefined ? from + 1 : before === null ? places.length : placeOf(places, before);
  if (from < 0 || at < 0) return p;
  const next = without(places, pin);
  next.splice(at, 0, pin);
  return write(p, next);
}

/** `pin` moved before the app at `at` inside its folder (indexes as the folder has them; its length puts it last). `pinned` stays as it is. */
export function moveInFolder(p: Pins, pin: string, at: number): Pins {
  const folder = p.folders.find((f) => f.apps.includes(pin));
  const from = folder ? folder.apps.indexOf(pin) : -1;
  if (!folder || at === from || at === from + 1) return p;
  const apps = folder.apps.filter((a) => a !== pin);
  apps.splice(at > from ? at - 1 : at, 0, pin);
  return { pinned: p.pinned, folders: p.folders.map((f) => (f === folder ? { ...f, apps } : f)) };
}

/**
 * A drop on the bar before `before` (a pin or a folder's key, null for the end): a folder's key moves its apps as a block, an app in a
 * folder comes out (takeOut), any other app moves as movePinned moves it. The same object on its own place, or with either not there.
 */
export function dropOnBar(p: Pins, id: string, before: string | null): Pins {
  const places = placesOf(p);
  const inside = places.some((s) => typeof s !== "string" && s.apps.includes(id));
  if (inside) return takeOut(p, id, before);
  const from = places.findIndex((s) => keyOf(s) === id);
  const at = before === null ? places.length : placeOf(places, before);
  if (from < 0 || at < 0 || at === from || at === from + 1) return p;
  const next = places.filter((_, i) => i !== from);
  next.splice(at > from ? at - 1 : at, 0, places[from]);
  return write(p, next);
}

/** The folder's apps back on the bar at its place, in its order; the folder gone. The same object for a folder that is not there. */
export function ungroup(p: Pins, folder: string): Pins {
  const places = placesOf(p);
  const at = places.findIndex((s) => typeof s !== "string" && s.id === folder);
  if (at < 0) return p;
  const next = [...places];
  next.splice(at, 1, ...(places[at] as Folder).apps);
  return write(p, next);
}

/** Folder `id` called `name`, trimmed and cut to FOLDER_NAME_MAX; the same list when that changes nothing. */
export function renameFolder(folders: Folder[], id: string, name: string): Folder[] {
  const v = name.trim().slice(0, FOLDER_NAME_MAX);
  if (!folders.some((f) => f.id === id && f.name !== v)) return folders;
  return folders.map((f) => (f.id === id ? { ...f, name: v } : f));
}

/** Where files dropped before `before` go in `pinned`: a folder's key stands for its first app there; null for a folder that is not there. */
export function pinBefore(p: Pins, before: string | null): string | null {
  if (before === null || !before.startsWith("folder:")) return before;
  const folder = p.folders.find((f) => folderKey(f.id) === before);
  return (folder && p.pinned.find((f) => folder.apps.includes(f.id))?.id) ?? null;
}

/**
 * The cell a key moves to in a grid of `count` cells, `cols` to a row, from cell `at`: Left and Right step through them (mirrored right
 * to left), Up and Down go a row, to the short last row's last cell, Home and End to the ends; no wrap. Undefined for any other key.
 */
export function gridKey(key: string, at: number, count: number, cols: number, rtl: boolean): number | undefined {
  if (count <= 0) return undefined;
  const last = count - 1;
  if (key === "Home") return 0;
  if (key === "End") return last;
  if (key === "ArrowLeft" || key === "ArrowRight") return Math.min(last, Math.max(0, at + ((key === "ArrowRight") !== rtl ? 1 : -1)));
  if (key === "ArrowUp") return at >= cols ? at - cols : at;
  if (key === "ArrowDown") return Math.floor(at / cols) < Math.floor(last / cols) ? Math.min(last, at + cols) : at;
  return undefined;
}
