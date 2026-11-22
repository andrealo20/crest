// The song title's versions with a cover or keys, and the Microphone widget, as the bar draws them.

import type { PartId } from "../../../notch/row/parts";
import type { NowPlaying } from "../../../platform/media/types";
import type { FaceKey } from "../faceKeys";
import type { WidgetVariants } from "../model";
import type { Body, WidgetContext } from "./Widget";

/** The song the bar's own window follows, for the song title's versions; null for every other widget. */
export function useTrack(_id: PartId): NowPlaying | null {
  return null;
}

/** The song title in one of its versions past the scrolling line; null while no song plays, and the bar draws its icon. */
export function trackPart(_variant: Exclude<WidgetVariants["title"], "text">, _ctx: WidgetContext): Body | null {
  return null;
}

/** The microphone, with the sound beside it in its other version; null while the bar draws its icon. */
export function micPart(_ctx: WidgetContext): Body | null {
  return null;
}

/** Does what a face's key does; `fail` puts what went wrong in the widget's label. */
export function runFaceKey(_key: FaceKey, _fail: (text: string) => void): void {}
