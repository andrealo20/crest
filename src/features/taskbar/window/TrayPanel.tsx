import { t } from "../../../i18n";
import { settings } from "../../../settings/store";
import { AppIcon } from "../../launcher/AppIcon";
import { fitIcon, trayIcon } from "../model";
import { trayPictures, trayState } from "../tray";
import { splitTray } from "../trayModel";
import { trayButton } from "./Tray";

/**
 * The tray's hidden icons in the panel above the bar, sized by TRAY_SIZE: five to a row at the bar's icon size, scrolling past four
 * rows, each taking the clicks as on the bar and dragged onto it to keep it there. A line instead while another program has the
 * tray, or while no icon is hidden. Its box (`data-tray-panel`) is where an icon dragged off the bar is hidden.
 */
export function TrayPanel() {
  const { yielded, icons } = trayState.use();
  const { trayShown, height, iconSize } = settings.use().taskbar;
  const pictures = trayPictures.use();
  const { hidden } = splitTray(icons, trayShown);
  const size = fitIcon(height, iconSize);
  if (yielded || !hidden.length)
    return (
      <p data-tray-panel className="flex h-full items-center justify-center px-5 text-center text-caption text-label-3">
        {yielded ? t("Ein anderes Programm verwaltet die Symbole der Taskleiste.") : t("Keine ausgeblendeten Symbole")}
      </p>
    );
  return (
    <div data-tray-panel className="grid h-full grid-cols-5 content-start overflow-y-auto p-3 [scrollbar-width:none]" style={{ gridAutoRows: size + 16 }}>
      {hidden.map((icon) => (
        <button
          key={icon.key}
          aria-label={icon.tip || t("Infobereich")}
          title={icon.tip || undefined}
          {...trayButton(icon, "panel")}
          className="flex items-center justify-center rounded-[8px] outline-none hover:bg-fill-2 focus-visible:bg-fill-2"
        >
          <AppIcon src={icon.img === null ? null : pictures[icon.img]} size={trayIcon(size)} />
        </button>
      ))}
    </div>
  );
}
