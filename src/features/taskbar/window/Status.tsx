import { useEffect, type MouseEventHandler, type ReactNode } from "react";
import { t } from "../../../i18n";
import { BatteryGlyph, NetGlyph, SpeakerGlyph } from "../../../ui/glyphs";
import { barStatus, startStatus } from "../status";
import { batteryGlyph, glyphSize, netGlyph, soundGlyph, statusParts, statusWidth } from "../statusModel";
import { Item, type ItemProps } from "./Item";
import type { Common } from "./Tray";

/**
 * Stato: the network, the volume and the battery as one button, each glyph left out while it has nothing to say (no battery on a
 * desktop PC), and nothing at all without any. A click opens the quick panel over it. It redraws only when Rust sends a change.
 */
export function Status(props: {
  size: number;
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
  const name = statusParts(s).map(([k, p]) => t(k, p)).join(", ") || t("Status");
  return (
    <Item
      {...props.item("status", name)}
      kind="status"
      tile={props.tile()}
      width={statusWidth(props.size, parts.length, battery !== null)}
      expanded={props.expanded}
      onClick={props.onClick}
      onContextMenu={props.onMenu}
    >
      <span className="flex gap-1">
        {parts.map(([key, part]) => (
          <span key={key} className="flex">
            {part}
          </span>
        ))}
      </span>
    </Item>
  );
}
