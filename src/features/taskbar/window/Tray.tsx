import { useEffect, type MouseEvent, type MouseEventHandler } from "react";
import { CaretUp } from "@phosphor-icons/react";
import { t } from "../../../i18n";
import { taskbar } from "../../../platform/services";
import { AppIcon } from "../../launcher/AppIcon";
import type { TrayIcon } from "../model";
import { startTray, trayPictures } from "../tray";
import { Item, type ItemProps } from "./Item";

type Common = Pick<ItemProps, "name" | "label" | "failed" | "lifted" | "size" | "markAt" | "onEnter" | "onLeave">;

/**
 * The notification area on the bar: each icon kept visible as a button of its own, then the ^ button for the others. An icon gets
 * the clicks as from Windows' tray (left, right, double) with the box it is drawn in. The ^ button opens nothing yet.
 */
export function Tray({
  visible,
  size,
  item,
  tile,
  onMenu,
}: {
  visible: TrayIcon[];
  size: number;
  /** What every button has in common, by the key it is hovered under (TaskbarWindow's `item`). */
  item: (key: string, name: string) => Common;
  tile: () => ItemProps["tile"];
  /** A right click on the ^ button, which has no menu of its own: the Crest menu over the pointer. */
  onMenu: MouseEventHandler<HTMLButtonElement>;
}) {
  useEffect(() => startTray(), []);
  const pictures = trayPictures.use();
  const send = (icon: TrayIcon, button: "left" | "right" | "double", e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    // The program may be gone, or refuse; nothing changes then.
    taskbar.trayClick(icon.key, button, { x: r.x, y: r.y, w: r.width, h: r.height }).catch(() => {});
  };
  const more = t("Ausgeblendete Symbole anzeigen");
  return (
    <>
      {visible.map((icon, i) => (
        <Item
          key={icon.key}
          {...item(`tray:${icon.key}`, icon.tip || t("Infobereich"))}
          tile={tile()}
          tray={i}
          onClick={(e) => send(icon, "left", e)}
          onDoubleClick={(e) => send(icon, "double", e)}
          onContextMenu={(e) => {
            e.preventDefault();
            send(icon, "right", e);
          }}
        >
          <AppIcon src={icon.img === null ? null : pictures[icon.img]} size={size} />
        </Item>
      ))}
      {/* The panel behind it comes with the next task (PanelContent has no tray yet): until then it only answers the pointer. */}
      <Item {...item("tray-more", more)} tile={tile()} expanded={false} onClick={() => {}} onContextMenu={onMenu}>
        <CaretUp size={size} weight="bold" />
      </Item>
    </>
  );
}
