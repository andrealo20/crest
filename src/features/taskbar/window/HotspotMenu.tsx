import { t } from "../../../i18n";
import { taskbar } from "../../../platform/services";
import { CrestMenu, Row } from "./BarMenu";
import { holdBriefly } from "./hold";

/**
 * The hotspot button's right-click menu: Windows' Mobile hotspot page, where its name, password and band are seen and changed (Crest
 * reads none of them), then the Crest menu's rows.
 */
export function HotspotMenu({ close }: { close: () => void }) {
  return (
    <>
      <Row
        label={t("Hotspot-Einstellungen")}
        onClick={() => {
          close();
          holdBriefly();
          void taskbar.settings("hotspot").catch(() => {});
        }}
      />
      <div className="h-px bg-separator my-1" />
      <CrestMenu close={close} />
    </>
  );
}
