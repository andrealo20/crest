import { createStore } from "../../lib/store";
import { FONTS } from "../../features/themes/themes";

// Text widths for the closed row, from a canvas (no layout pass), or from a hidden span where the canvas cannot draw the text as the
// page does. Not a pure module: it needs the DOM.

/** text-footnote font-medium, the row's text (live bindings: setRowFamily changes them). */
export let ROW_FONT = `500 12px ${FONTS.inter}`;
/** text-caption font-medium, the FPS label and a card's text. */
export let CAPTION_FONT = `500 11px ${FONTS.inter}`;
/** text-caption's letter-spacing in px, which the canvas leaves out (themes.ts captionSpacing). */
let captionSpacing = 0.11;

const cache = new Map<string, number>();
let ctx: CanvasRenderingContext2D | null = null;
let span: HTMLSpanElement | null = null;
/** measureTabular measures in the page (the Material style). */
let tabularFromDom = false;
/** The canvas draws otherwise than the page, so every width comes from the page; null until the first width after a change checks it. */
let canvasOff: boolean | null = null;
/** A line like the row's, for that check. */
const CHECK = "Midnight City 12:45";

/** Bumped when a font finishes loading: widths measured before were taken with a fallback face. */
export const fontEpoch = createStore(0);
/** Widths measured before no longer hold: they are forgotten, the canvas is checked again, and the row measures anew. */
function invalidate() {
  cache.clear();
  canvasOff = null;
  fontEpoch.set((n) => n + 1);
}
document.fonts?.addEventListener("loadingdone", invalidate);

/** The font chosen in Themes and its caption's tracking (themes.ts captionSpacing): widths measured before were taken with the old one. */
export function setRowFamily(family: string, spacing: number) {
  ROW_FONT = `500 12px ${family}`;
  CAPTION_FONT = `500 11px ${family}`;
  captionSpacing = spacing;
  invalidate();
}

/** On in the Material style (themes/store.ts applyFont): measureTabular then measures in the page. */
export function setTabularFromDom(on: boolean) {
  if (on === tabularFromDom) return;
  tabularFromDom = on;
  invalidate();
}

function canvasWidth(text: string, font: string): number {
  ctx ??= document.createElement("canvas").getContext("2d");
  if (!ctx) return 0;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/** As the page lays the text out, with tabular-nums if asked: the canvas knows neither that nor, maybe in WKWebView, opsz. */
function pageWidth(text: string, font: string, tabular: boolean): number {
  if (!span) {
    span = document.createElement("span");
    span.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre";
    document.body.append(span);
  }
  span.style.font = font;
  // After font, whose shorthand resets it.
  span.style.fontVariantNumeric = tabular ? "tabular-nums" : "";
  span.textContent = text;
  return span.getBoundingClientRect().width;
}

function measure(text: string, font: string, tabular: boolean): number {
  const key = `${tabular ? "tab" : ""}\n${font}\n${text}`;
  let w = cache.get(key);
  if (w === undefined) {
    // Google Sans Flex's opsz follows the size, and an engine may apply it in the page and not on the canvas (Edge applies it to both;
    // WKWebView was never measured). Checked after every change, since the first widths may come before the font has loaded.
    canvasOff ??= Math.abs(canvasWidth(CHECK, ROW_FONT) - pageWidth(CHECK, ROW_FONT, false)) > 0.5;
    const width = tabular || canvasOff ? pageWidth(text, font, tabular) : canvasWidth(text, font);
    w = Math.ceil(width + (font === CAPTION_FONT ? captionSpacing * text.length : 0));
    // One entry per song title over a long session; start over rather than grow without end.
    if (cache.size > 500) cache.clear();
    cache.set(key, w);
  }
  return w;
}

/** Width in CSS px, rounded up so a reserved box never clips its text. */
export function measureText(text: string, font = ROW_FONT): number {
  return measure(text, font, false);
}

/**
 * The width of `.tabular` text, its digits already swapped for the widest by the caller (so the key repeats). In the Material style it
 * comes from the page: Google Sans Flex's tnum widens spaces and punctuation as well, and the clock would be 4.7 px short on the canvas.
 * In Crest's from the canvas as before, since Inter's tnum would move the clock by a pixel.
 */
export function measureTabular(text: string, font = ROW_FONT): number {
  return measure(text, font, tabularFromDom);
}
