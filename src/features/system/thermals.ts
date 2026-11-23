// The bar's Temperatures widget: the fans it shows and the last 10 minutes of the temperatures, kept by the notch's system store.

/** The fans the widget shows, rpm: the CPU's, the GPU's and the fastest case fan; null for one not known. */
export interface Fans {
  cpu: number | null;
  gpu: number | null;
  case: number | null;
}

export const NO_FANS: Fans = { cpu: null, gpu: null, case: null };
