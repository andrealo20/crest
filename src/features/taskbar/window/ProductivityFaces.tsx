// The faces of the bar's Stopwatch, Next to-do and Note preview widgets, which read what Crest already saves.

import type { PartId } from "../../../notch/row/parts";
import type { Body, WidgetContext } from "./Widget";

/** What the stopwatch, the next to-do and the note preview read from their saved stores. */
export type Own = Record<string, unknown>;

/** The saved stores widget `id` draws from, undefined for one that reads none; `paused` while the bar rests. */
export function useOwn(_id: PartId, _paused: boolean): Own | undefined {
  return undefined;
}

/** The stopwatch, the next to-do or the note's first line as the bar draws it; null while it has nothing to show. */
export function productivityPart(_id: "stopwatch" | "todo" | "note", _ctx: WidgetContext): Body | null {
  return null;
}
