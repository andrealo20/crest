// The search panel's glow (SearchGlow.tsx): what is pure about it, so it runs under the tests.

/** Google's colours with a purple, as the glow its assistant draws round a phone's screen: a turn of the wheel that closes on itself. */
export const GLOW_COLOURS = "conic-gradient(#4285f4, #9b72cb, #ea4335, #fbbc04, #34a853, #4285f4)";

/** How far the glow reaches in from the edge, CSS px at 100 %: about a tenth of the panel's width, soft as that glow. */
export const GLOW_BAND = 40;

/** How strong it shows at the edge: a hint of colour, under the search's own. */
export const GLOW_OPACITY = 0.45;

/**
 * The mask that keeps the glow to a band along the edge: a fade in from each side, brightest on the edge and nothing at the band's
 * inner edge, so the sides add up in the corners without a seam and the shape's own rounding cuts them. Gradients only, no blur, and
 * drawn once: what turns under it is a transform.
 */
export function edgeMask(band = GLOW_BAND): string {
  // An ease-out: alpha by how far in from the edge, as a share of the band.
  const stops: [number, number][] = [[0, 1], [0.25, 0.6], [0.5, 0.28], [0.75, 0.08], [1, 0]];
  const fade = stops.map(([d, a]) => `rgb(0 0 0 / ${a}) ${d * band}px`).join(", ");
  return ["to bottom", "to top", "to right", "to left"].map((side) => `linear-gradient(${side}, ${fade})`).join(", ");
}
