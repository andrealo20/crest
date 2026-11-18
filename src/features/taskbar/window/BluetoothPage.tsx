import { useLayoutEffect } from "react";
import { t } from "../../../i18n";
import { taskbar } from "../../../platform/services";
import { RadioSwitch, type SwitchJob } from "../../overview/QuickControls";
import { quickPage } from "../panel";
import { QuickPageFrame, away } from "./QuickPage";

/** The quick panel's Bluetooth page: the radio's switch and, for now, only whether it is off. */
export function BluetoothPage({ on, job }: { on: boolean; job: SwitchJob }) {
  useLayoutEffect(() => quickPage.set({ page: "bluetooth", rows: 1, extra: 0 }), []);
  return (
    <QuickPageFrame
      title={t("Bluetooth")}
      actions={<RadioSwitch kind="bluetooth" on={on} job={job} />}
      note={job.note}
      footer={{ label: t("Weitere Bluetooth-Geräte"), onClick: () => away(() => taskbar.settings("bluetooth")) }}
    >
      {!on && <p className="ps-1 text-footnote text-label-3">{t("Bluetooth ist ausgeschaltet")}</p>}
    </QuickPageFrame>
  );
}
