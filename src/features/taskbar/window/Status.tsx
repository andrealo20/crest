import { useEffect, type MouseEventHandler, type ReactNode } from "react";
import { t } from "../../../i18n";
import { BatteryGlyph, NetGlyph, SpeakerGlyph } from "../../../ui/glyphs";
import { barStatus, startStatus } from "../status";
import { batteryGlyph, glyphGap, glyphSize, netGlyph, soundGlyph, statusParts, statusPill, statusWidth } from "../statusModel";
import { Item, type ItemProps } from "./Item";
import type { Common } from "./Tray";

/**
 * Stato: the network, the volume and the battery as one button, each glyph left out while it has nothing to say (no battery on a
 * desktop PC), and nothing at all without any, in a pill of the theme's fill (the closed notch's ink's where the bar wears it), but
 * on Tiles, whose tile is already a rounded fill. A click opens the quick panel over it. It redraws only when Rust sends a change.
 */
export function Status(props: {
  size: number;
  /** The bar's height, which sets the pill's. */
  height: number;
  /** What every button has in common, by the key it is hovered under (TaskbarWindow's `item`). */
  item: (key: string, name: string) => Common;
  tile: () => ItemProps["tile"];
  /** Whether the panel shows the quick panel. */
  expanded: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
  /** A right click, which has no menu of its own: the Crest menu over the pointer. */
  onMenu: MouseEventHandler<HTMLButtonElement>;
}) {
  useEffect(() => startStatus(), []);
  const s = barStatus.use();
  const net = s.network && netGlyph(s.network);
  const sound = soundGlyph(s.sound);
  const battery = batteryGlyph(s.power);
  const size = glyphSize(props.size);
  const parts: [string, ReactNode][] = [];
  if (net) parts.push(["net", <NetGlyph glyph={net} size={size} />]);
  if (sound) parts.push(["sound", <SpeakerGlyph glyph={sound} size={size} />]);
  if (battery && s.power)
    parts.push(["battery", <BatteryGlyph percent={s.power.percent} charging={s.power.charging} warning={battery === "warning"} saver={s.power.saver === true} size={size} />]);
  if (!parts.length) return null;
  const tile = props.tile();
  const pill = tile ? null : statusPill(props.height);
  const name = statusParts(s).map(([k, p]) => t(k, p)).join(", ") || t("Status");
  return (
    <Item
      {...props.item("status", name)}
      kind="status"
      tile={tile}
      width={statusWidth(props.size, parts.length, battery !== null, pill && props.height)}
      expanded={props.expanded}
      onClick={props.onClick}
      onContextMenu={props.onMenu}
    >
      {/* The button's own lift and press move the pill with the glyphs; it adds no hover fill of its own. */}
      <span
        className={`flex items-center ${pill ? "rounded-full bg-fill-2" : ""}`}
        style={{ gap: glyphGap(pill !== null), height: pill?.height, paddingInline: pill?.pad }}
      >
        {parts.map(([key, part]) => (
          <span key={key} className="flex">
            {part}
          </span>
        ))}
      </span>
    </Item>
  );
}
