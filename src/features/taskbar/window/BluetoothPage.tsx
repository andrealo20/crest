import { useEffect, useLayoutEffect, useState } from "react";
import { t } from "../../../i18n";
import { btIcon } from "../../../notch/row/status";
import { STATUS_ICON } from "../../../notch/row/statusIcons";
import { taskbar } from "../../../platform/services";
import { RadioSwitch, type SwitchJob } from "../../overview/QuickControls";
import { sizeQuickPage } from "../panel";
import { PAGE_ROW } from "../panelModel";
import { btLine, btRows, btView, type BtDevice } from "../quickPages";
import { QuickPageFrame, away } from "./QuickPage";

/** The quick panel's Bluetooth page: the paired devices, connected first with their battery, each opening Bluetooth in Settings. */
export function BluetoothPage({ on, job }: { on: boolean; job: SwitchJob }) {
  const [devices, setDevices] = useState<BtDevice[] | null>(null);
  const [failed, setFailed] = useState(false);
  // A failed read keeps the last list.
  const read = () =>
    void taskbar.btDevices().then(
      (d) => {
        setDevices(d);
        setFailed(false);
      },
      () => setFailed(true),
    );
  const view = btView(on, devices, failed);

  // Read when the page opens and when its switch turns the radio on, then on each device the alerts hear: never at intervals.
  useEffect(() => {
    if (on) read();
  }, [on]);
  useEffect(() => taskbar.onBluetooth(read), []);

  useLayoutEffect(() => sizeQuickPage("bluetooth", btRows(view, devices?.length ?? 0), 0), [view, devices]);

  return (
    <QuickPageFrame
      title={t("Bluetooth")}
      actions={<RadioSwitch kind="bluetooth" on={on} job={job} />}
      note={job.note}
      footer={{ label: t("Weitere Bluetooth-Geräte"), onClick: () => away(() => taskbar.settings("bluetooth")) }}
    >
      {view === "off" && <p className="px-1 text-footnote text-label-2">{t("Bluetooth ist ausgeschaltet")}</p>}
      {view === "failed" && <p className="px-1 text-footnote text-label-2">{t("Das hat nicht geklappt")}</p>}
      {view === "empty" && <p className="px-1 text-footnote text-label-2">{t("Keine gekoppelten Geräte")}</p>}
      {view === "list" &&
        devices?.map((d) => {
          const Icon = STATUS_ICON[btIcon(d.categories)];
          const line = btLine(d);
          return (
            <button
              key={d.id}
              onClick={() => away(() => taskbar.settings("bluetooth"))}
              className="flex w-full items-center gap-2.5 rounded-[10px] px-2 hover:bg-fill-1 material:rounded-full"
              style={{ height: PAGE_ROW }}
            >
              <Icon size={16} weight="regular" className={`shrink-0 ${d.connected ? "text-label" : "text-label-3"}`} />
              <span className="flex min-w-0 flex-1 flex-col items-start">
                <span className="w-full truncate text-start text-footnote font-medium text-label">{d.name}</span>
                {line && <span className="w-full truncate text-start text-caption text-label-3">{t(...line)}</span>}
              </span>
            </button>
          );
        })}
    </QuickPageFrame>
  );
}
