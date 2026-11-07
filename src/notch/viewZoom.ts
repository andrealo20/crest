import { isNative } from "../platform/native";
import { settings } from "../settings/store";

/**
 * The panel scale as the page sees it. Natively Rust zooms the whole WebView (display.rs), so CSS px, pointer positions and the monitor
 * all scale together and this is 1. In the browser the notch's layer is drawn with CSS zoom instead: pointer moves and viewport sizes
 * come in unzoomed px and are divided by this to reach the layer's px.
 */
export const viewZoom = (): number => (isNative ? 1 : settings.get().behavior.scale / 100);
