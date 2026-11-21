import { createStore } from "../lib/store";

/** The style of every Crest window: its own, or Material 3 with the theme's accent as the seed (src/features/themes/material.ts). */
export type Design = "crest" | "material";

/** The style on screen, set with the theme in each window (src/features/themes/store.ts apply()), for what draws differently in Material. */
export const design = createStore<Design>("crest");
