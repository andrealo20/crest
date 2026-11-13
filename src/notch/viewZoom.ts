import { createStore } from "../lib/store";
import { isNative } from "../platform/native";
import { settings } from "../settings/store";

/**
 * The panel scale as the page sees it. Natively Rust zooms the whole WebView (display.rs), so CSS px, pointer positions and the monitor
 * all scale together and this is 1. In the browser the notch's layer is drawn with CSS zoom instead: pointer moves and viewport sizes
 * come in unzoomed px and are divided by this to reach the layer's px.
 */
export const viewZoom = (): number => (isNative ? 1 : settings.get().behavior.scale / 100);

/**
 * The page's scale and size as a store: what a render works out in physical px (the live glass's zone, Notch.tsx) is worked out again
 * when the window moves to a monitor with another scale, the panel scale changes or the window is resized; none of them renders by itself.
 */
export const viewMetrics = createStore({ dpr: devicePixelRatio, width: innerWidth, height: innerHeight });
const readMetrics = () => {
  const v = viewMetrics.get();
  if (v.dpr !== devicePixelRatio || v.width !== innerWidth || v.height !== innerHeight) viewMetrics.set({ dpr: devicePixelRatio, width: innerWidth, height: innerHeight });
};
// A query for the scale as it is now changes once, when the scale does: asked again for each new one.
const watchScale = () =>
  matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener("change", () => (readMetrics(), watchScale()), { once: true });
watchScale();
addEventListener("resize", readMetrics);
