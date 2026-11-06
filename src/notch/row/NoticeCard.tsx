import { useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { HUE_PALETTE } from "../../features/themes/themes";
import type { Hue } from "../../features/themes/hues";
import { CAPTION_FONT, ROW_FONT, measureText } from "./measure";
import { Marquee } from "./Marquee";

/*
 * A notice as a card in the closed notch: its icon in a circle tinted with the notice's colour, a title,
 * a line of text and buttons on the right, with a line of the same colour drawn along the bottom edge.
 * The notch grows to CARD_H while one shows (NoticeLayer reports the height, Notch.tsx takes it).
 */

/** Designed height of a card, like the row's 30 (drawn at the notch's content scale). */
export const CARD_H = 52;
const ICON_BOX = 32, GAP = 10, PAD = 6, TEXT_MAX = 300, TEXT_MIN = 120;

export interface CardSpec {
  key: string;
  /** Drawn in the tinted circle; `image` takes the place of the circle (an app icon, a screenshot). */
  icon?: ReactNode;
  image?: ReactNode;
  /** Width of `image`, when it is not the icon circle's. */
  imageWidth?: number;
  hue: Hue;
  /** A colour of its own instead of the hue's (a brand's, for its app). */
  color?: string;
  title: string;
  text?: string;
  /** Scrolls three laps instead of one: text that has to be read before a button is pressed. */
  read?: boolean;
  actions?: ReactNode;
  actionsWidth?: number;
  /** A click on the icon or the text. Not stopped, so the notch also opens. */
  onOpen?: () => void;
}

/** The light shade of a hue: the card always sits on the black notch. */
export function tintOf(hue: Hue): string {
  return HUE_PALETTE[hue][0];
}

/** The scrolling line: it stops under the pointer, and a text to be read has its whole text as a tooltip. */
function CardText({ text, textWidth, width, read }: { text: string; textWidth: number; width: number; read: boolean }) {
  const [hovered, setHovered] = useState(false);
  return (
    <span className="h-[15px]" title={read ? text : undefined} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
      <Marquee text={text} textWidth={textWidth} width={width} paused={hovered} once={!read} className="text-caption font-medium text-label-2" />
    </span>
  );
}

export function noticeCard(spec: CardSpec, max: number): { width: number; height: number; key: string; body: ReactNode } {
  const lead = spec.image ? (spec.imageWidth ?? ICON_BOX) : ICON_BOX;
  const actions = spec.actions ? GAP + (spec.actionsWidth ?? 0) : 0;
  // The title is semibold, wider than the row's medium.
  const titleW = measureText(spec.title, ROW_FONT.replace(/^500/, "600")), textW = spec.text ? measureText(spec.text, CAPTION_FONT) : 0;
  const room = Math.max(TEXT_MIN, Math.min(TEXT_MAX, max - 2 * PAD - lead - GAP - actions));
  const column = Math.min(room, Math.max(titleW, textW));
  const tint = spec.color ?? tintOf(spec.hue);
  return {
    width: 2 * PAD + lead + GAP + column + actions,
    height: CARD_H,
    key: spec.key,
    body: (
      <span className="relative flex h-full w-full items-center" style={{ gap: GAP, paddingInline: PAD }}>
        <button className="pointer-events-auto flex h-full min-w-0 items-center text-start" style={{ gap: GAP }} onClick={spec.onOpen} tabIndex={spec.onOpen ? 0 : -1}>
          {spec.image ?? (
            <span className="flex shrink-0 items-center justify-center rounded-full" style={{ width: ICON_BOX, height: ICON_BOX, color: tint, background: `color-mix(in srgb, ${tint} 20%, transparent)` }}>
              {spec.icon}
            </span>
          )}
          <span className="flex min-w-0 flex-col justify-center" style={{ width: column }}>
            <span dir="auto" className="truncate text-footnote font-semibold text-label">{spec.title}</span>
            {spec.text && <CardText text={spec.text} textWidth={textW} width={column} read={!!spec.read} />}
          </span>
        </button>
        {spec.actions && <span className="flex shrink-0 items-center gap-1.5">{spec.actions}</span>}
        {/* The notice's colour along the bottom edge, drawn out from the middle as the card arrives. */}
        <motion.span
          aria-hidden
          className="pointer-events-none absolute bottom-[3px] h-[2px] rounded-full"
          style={{ left: PAD + 8, right: PAD + 8, background: tint, transformOrigin: "50% 50%" }}
          initial={{ opacity: 0, transform: "scaleX(0)" }}
          animate={{ opacity: 0.85, transform: "scaleX(1)" }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.12 }}
        />
      </span>
    ),
  };
}
