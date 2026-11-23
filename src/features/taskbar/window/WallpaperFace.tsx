// The face of the bar's Wallpaper widget, the wallpaper it follows and its menu's rows.

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { artwork } from "../../../design/motion";
import { t } from "../../../i18n";
import type { PartId } from "../../../notch/row/parts";
import type { WallNow, WallScreen } from "../../../platform/services";
import { CaretLeft, CaretRight } from "../../../ui/iconset";
import { creditOf, followWall, screenOf, stepWallpaper, thumbOf, wallNow } from "../../wallpapers/store";
import { WALL } from "../faceKeys";
import { variantOf } from "../model";
import { Row } from "./BarMenu";
import type { Body, WidgetContext } from "./Widget";

/** What the Widgets page's previews show: a bundled picture, never the desktop's. */
const SAMPLE: WallScreen = { id: "", primary: true, path: "pawel-czerwinski-PvgqqicSLvA.jpg", crest: "pawel-czerwinski-PvgqqicSLvA" };
const THUMB_HEIGHT = 24;

/** The wallpaper the Wallpaper widget follows in the bar's own window; null for every other widget, which never re-renders for it. */
export function useWall(id: PartId): WallNow | null {
  const on = id === "wallpaper";
  useEffect(() => (on ? followWall() : undefined), [on]);
  return useSyncExternalStore(wallNow.subscribe, () => (on ? wallNow.get() : null));
}

/** The main screen's wallpaper as a small picture, with Previous and Next beside it in its other version; null without one. */
export function wallpaperPart(ctx: WidgetContext): Body | null {
  const now = ctx.sample ? null : (ctx.wall ?? null), main = ctx.sample ? SAMPLE : screenOf(now, null);
  const src = thumbOf(now, main), credit = creditOf(main);
  if (!src) return null;
  const keys = variantOf(ctx.variants, "wallpaper") === "keys";
  return { node: <WallFace src={src} keys={keys} credit={credit} />, width: keys ? WALL.width : WALL.thumb, tip: credit ?? undefined };
}

/** A key's column, its glyph hidden from screen readers: the menu and the tool name what the keys do. */
function Key({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden className="grid shrink-0 place-items-center text-label-2" style={{ width: WALL.key }}>
      {children}
    </span>
  );
}

/**
 * The picture, a new one fading in over the old in one cell, with a faint inner line that sets it off from the bar; left to right in
 * every language, so a click lands on the key widgetKey finds there. The credit is the button's description.
 */
function WallFace({ src, keys, credit }: { src: string; keys: boolean; credit: string | null }) {
  return (
    <span dir="ltr" className="flex items-center">
      {keys && (
        <Key>
          <CaretLeft size={12} weight="bold" />
        </Key>
      )}
      <span className="relative grid shrink-0 overflow-hidden rounded-[5px] bg-fill-2" style={{ width: WALL.thumb, height: THUMB_HEIGHT }}>
        <AnimatePresence initial={false}>
          <motion.img
            key={src}
            src={src}
            alt=""
            draggable={false}
            className="col-start-1 row-start-1 size-full object-cover"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: artwork.enter }}
            exit={{ opacity: 0, transition: artwork.exit }}
          />
        </AnimatePresence>
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[5px] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]" />
      </span>
      {keys && (
        <Key>
          <CaretRight size={12} weight="bold" />
        </Key>
      )}
      {credit && <span className="sr-only">{credit}</span>}
    </span>
  );
}

/** Next wallpaper and Previous wallpaper over the widget's Crest menu rows; a step that fails opens Wallpapers over the widget. */
export function WallpaperRows({ close, openTool }: { close: () => void; openTool: (tool: string) => void }) {
  const step = (by: 1 | -1) => () => {
    close();
    void stepWallpaper(by).catch(() => openTool("wallpapers"));
  };
  return (
    <>
      <Row label={t("Nächstes Hintergrundbild")} onClick={step(1)} />
      <Row label={t("Vorheriges Hintergrundbild")} onClick={step(-1)} />
      <div className="h-px bg-separator my-1" />
    </>
  );
}
