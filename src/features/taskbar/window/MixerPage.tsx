import { useLayoutEffect } from "react";
import { t } from "../../../i18n";
import { taskbar } from "../../../platform/services";
import { MIXER_ROW, MixerList, useMixer } from "../../now-playing/Mixer";
import { sizeQuickPage } from "../panel";
import { PAGE_ROW } from "../panelModel";
import { QuickPageFrame, away } from "./QuickPage";

/** The quick panel's volume mixer: each app's volume and Windows' own, as Now Playing's mixer, read every 1.5 s while it shows. */
export function MixerPage() {
  const data = useMixer(true);
  // The mixer's rows are shorter than a page's: as many page rows as they fill, the system row and the separator included.
  const rows = Math.ceil(((data.apps.length + 1) * MIXER_ROW + 12) / PAGE_ROW);
  useLayoutEffect(() => sizeQuickPage("mixer", rows, 0), [rows]);
  return (
    <QuickPageFrame title={t("Lautstärkemixer")} note={null} footer={{ label: t("Weitere Einstellungen"), onClick: () => away(() => taskbar.settings("mixer")) }}>
      <MixerList data={data} />
    </QuickPageFrame>
  );
}
