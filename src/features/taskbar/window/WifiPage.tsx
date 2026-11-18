import { useLayoutEffect } from "react";
import { t } from "../../../i18n";
import { taskbar } from "../../../platform/services";
import { RadioSwitch, type SwitchJob } from "../../overview/QuickControls";
import { quickPage } from "../panel";
import { QuickPageFrame, away } from "./QuickPage";

/** The quick panel's Wi-Fi page: the radio's switch and, for now, only whether it is off. */
export function WifiPage({ on, job }: { on: boolean; job: SwitchJob }) {
  useLayoutEffect(() => quickPage.set({ page: "wifi", rows: 1, extra: 0 }), []);
  return (
    <QuickPageFrame
      title={t("WLAN")}
      actions={<RadioSwitch kind="wifi" on={on} job={job} />}
      note={job.note}
      footer={{ label: t("Weitere WLAN-Einstellungen"), onClick: () => away(() => taskbar.settings("wifi")) }}
    >
      {!on && <p className="ps-1 text-footnote text-label-3">{t("WLAN ist ausgeschaltet")}</p>}
    </QuickPageFrame>
  );
}
