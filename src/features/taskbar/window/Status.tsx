import { useEffect, type MouseEventHandler } from "react";
import {
  BatteryCharging,
  BatteryFull,
  BatteryHigh,
  BatteryLow,
  BatteryMedium,
  BatteryWarning,
  Network,
  NetworkSlash,
  SpeakerHigh,
  SpeakerLow,
  SpeakerNone,
  SpeakerSimpleSlash,
  WifiHigh,
  WifiLow,
  WifiMedium,
  WifiNone,
  WifiSlash,
  WifiX,
  type Icon,
} from "@phosphor-icons/react";
import { t } from "../../../i18n";
import { barStatus, startStatus } from "../status";
import { batteryGlyph, glyphSize, netGlyph, soundGlyph, statusParts, statusWidth } from "../statusModel";
import { Item, type ItemProps } from "./Item";
import type { Common } from "./Tray";

/** The network glyph's icon, here and in the quick panel's Wi-Fi tile. */
export const NET: Record<ReturnType<typeof netGlyph>, Icon> = {
  wired: Network,
  "wifi-off": WifiSlash,
  "wifi-unlinked": WifiX,
  "wifi-0": WifiNone,
  "wifi-1": WifiLow,
  "wifi-2": WifiMedium,
  "wifi-3": WifiHigh,
  offline: NetworkSlash,
};
const SOUND: Record<NonNullable<ReturnType<typeof soundGlyph>>, Icon> = { muted: SpeakerSimpleSlash, low: SpeakerNone, mid: SpeakerLow, high: SpeakerHigh };
const BATTERY: Record<NonNullable<ReturnType<typeof batteryGlyph>>, Icon> = {
  charging: BatteryCharging,
  full: BatteryFull,
  high: BatteryHigh,
  medium: BatteryMedium,
  low: BatteryLow,
  warning: BatteryWarning,
};

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
  const glyphs: [string, Icon, string?][] = [];
  if (net) glyphs.push(["net", NET[net]]);
  if (sound) glyphs.push(["sound", SOUND[sound]]);
  // Energy saver tints the battery, as Windows does.
  if (battery) glyphs.push(["battery", BATTERY[battery], s.power?.saver ? "var(--color-green)" : undefined]);
  if (!glyphs.length) return null;
  const name = statusParts(s).map(([k, p]) => t(k, p)).join(", ") || t("Status");
  return (
    <Item
      {...props.item("status", name)}
      tile={props.tile()}
      width={statusWidth(props.size, glyphs.length)}
      expanded={props.expanded}
      onClick={props.onClick}
      onContextMenu={props.onMenu}
    >
      <span className="flex gap-1">
        {glyphs.map(([key, Glyph, color]) => (
          <Glyph key={key} size={size} weight="bold" style={color ? { color } : undefined} />
        ))}
      </span>
    </Item>
  );
}
