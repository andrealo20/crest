import { useEffect, useState } from "react";
import { taskbar } from "../../../platform/services";
import { settings } from "../../../settings/store";
import { SLIDE_DELAY, slides, touches, type Rect } from "../autoHide";
import { briefHold } from "./hold";

/**
 * Whether the bar is down, off the screen: SLIDE_DELAY ms after the window in front of its monitor comes to touch `band` (the bar's
 * still box, null until it has a size) with nothing holding the bar up (autoHide.ts slides: the pointer, a menu, an app asking for
 * attention, one of Windows' own surfaces as Rust says or a click that opens one, hold.ts), and up again at once when that ends.
 * Rust sends that window only while the option is on: with it off nothing is followed and the bar never moves.
 */
export function useAutoHide({ band, open, attention }: { band: Rect | null; open: boolean; attention: boolean }): boolean {
  const on = settings.use().taskbar.autoHide;
  const [front, setFront] = useState<Rect | null>(null);
  const [pointer, setPointer] = useState(false);
  const [down, setDown] = useState(false);
  useEffect(() => {
    if (!on) return;
    // What Rust sent before this page loaded or the option came on, unless a newer frame is already here (store.ts startBarWindows).
    let stale = false;
    const off = taskbar.onFront((r) => {
      stale = true;
      setFront(r);
    });
    void taskbar.front().then((r) => {
      if (!stale) setFront(r);
    });
    return () => {
      stale = true;
      off();
      // Turned on again, the bar waits for Rust's next frame rather than acting on one from before.
      setFront(null);
    };
  }, [on]);
  // From the start, so the option turned on finds the pointer where it is: Rust says only when it comes onto the zones or leaves them.
  useEffect(() => taskbar.onHover(setPointer), []);
  // Rust says false once the option turns off, so it never stays held.
  const [surface, setSurface] = useState(false);
  useEffect(() => taskbar.onHold(setSurface), []);
  const brief = briefHold.use() !== null;
  const held = surface || brief;
  const slide = slides({ on, covered: band !== null && touches(front, band), pointer, open, attention, held });
  // A timer only while the slide waits; down, the page is idle again.
  useEffect(() => {
    if (!slide) return;
    const id = window.setTimeout(() => setDown(true), SLIDE_DELAY);
    return () => {
      window.clearTimeout(id);
      setDown(false);
    };
  }, [slide]);
  // Up in the same render as whatever holds it.
  return slide && down;
}
