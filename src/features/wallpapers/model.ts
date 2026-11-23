// The Wallpapers tool's settings. Pure, so the saved shape can be repaired and tested without the app around it.

export type WallSource = "crest" | "folder";
export type WallFit = "fill" | "fit" | "span";
/** The automatic change, minutes: off, every 15 minutes, every hour, every day. */
export const EVERY = [0, 15, 60, 1440] as const;
export type WallEvery = (typeof EVERY)[number];

/** Crest's collection or a folder (any path: Rust checks it), how a picture fills the screen, and the automatic change. */
export interface WallpaperSettings {
  source: WallSource;
  folder: string;
  fit: WallFit;
  every: WallEvery;
}

export const WALLPAPER_DEFAULTS: WallpaperSettings = { source: "crest", folder: "", fit: "fill", every: 0 };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Saved settings as valid ones: an unknown value takes its default. */
export function normalizeWallpapers(v: unknown): WallpaperSettings {
  const s = isObj(v) ? v : {}, d = WALLPAPER_DEFAULTS;
  return {
    source: s.source === "folder" ? "folder" : d.source,
    folder: typeof s.folder === "string" ? s.folder : d.folder,
    fit: s.fit === "fit" || s.fit === "span" ? s.fit : d.fit,
    every: EVERY.includes(s.every as WallEvery) ? (s.every as WallEvery) : d.every,
  };
}
