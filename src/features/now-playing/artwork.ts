import { useEffect, useState } from "react";
import { boxBlur } from "./blur";

/** A missing cover only counts after this long (track changes often send one late). */
const EMPTY_AFTER_MS = 800;

/**
 * The cover to show, swapped only once the new image is decoded: the crossfade then
 * starts with a finished image instead of popping in halfway (big data URLs take a
 * moment). A short gap without a cover keeps the old one.
 */
export function useSmoothArtwork(src: string | null): string | null {
  const [shown, setShown] = useState(src);
  useEffect(() => {
    let alive = true;
    if (!src) {
      const id = window.setTimeout(() => alive && setShown(null), EMPTY_AFTER_MS);
      return () => {
        alive = false;
        window.clearTimeout(id);
      };
    }
    const img = new Image();
    img.src = src;
    void img
      .decode()
      .catch(() => {})
      .then(() => alive && setShown(src));
    return () => {
      alive = false;
    };
  }, [src]);
  return shown;
}

/**
 * The cover drawn at `size` px square (centre crop) and blurred there, as a data URL, to stretch over a whole panel:
 * blurred while tiny it becomes a smooth wash, where a CSS blur on the large surface cost whole frames in WebView2 and a
 * sharp tiny image showed its squares. null without a cover, or when the image can't be read back (a cross-origin cover
 * taints the canvas). The last one stays while the next decodes.
 */
export function useTinyArtwork(src: string | null, size = 96): string | null {
  const [tiny, setTiny] = useState<string | null>(null);
  useEffect(() => {
    if (!src) return setTiny(null);
    let alive = true;
    const img = new Image();
    img.src = src;
    img
      .decode()
      .then(() => {
        if (!alive) return;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return setTiny(null);
        // Centre crop by placing the whole image scaled past the canvas: Chrome draws nothing for an SVG (the demo's
        // covers) given a source rectangle.
        const w = img.naturalWidth || size, h = img.naturalHeight || size, k = size / Math.min(w, h);
        ctx.drawImage(img, (size - w * k) / 2, (size - h * k) / 2, w * k, h * k);
        const pixels = ctx.getImageData(0, 0, size, size);
        // About 4 % of the side: shapes and colours of the cover stay recognisable, its details go.
        boxBlur(pixels.data, size, size, Math.round(size / 24));
        ctx.putImageData(pixels, 0, 0);
        setTiny(canvas.toDataURL());
      })
      .catch(() => alive && setTiny(null));
    return () => {
      alive = false;
    };
  }, [src, size]);
  return tiny;
}
