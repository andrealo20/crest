import { useLayoutEffect, type ReactNode } from "react";
import { Airplane, Leaf, Network, type Icon } from "@phosphor-icons/react";
import { t } from "../../../i18n";
import { taskbar } from "../../../platform/services";
import { RadioSwitch, useQuick, useSwitchJob } from "../../overview/QuickControls";
import { BrightnessTile, OutputList, VolumeTile, useBrightness, useOutputs } from "../../overview/QuickTiles";
import { MIXER_MAX_ROWS, MIXER_ROW } from "../../now-playing/Mixer";
import { closePanel, quickLayout } from "../panel";
import { barStatus } from "../status";
import { wifiTile } from "../statusModel";
import { holdBriefly } from "./hold";

/**
 * Stato's quick panel, sized by QUICK_SIZE: the radios that apply (Wi-Fi, Bluetooth, the cable), the volume with its outputs, the
 * bar's own monitor brightness where Crest can set it, Energy saver and Airplane mode, and a footer with what went wrong and Windows'
 * Settings. Built from Overview's pieces, whose reads run only while the panel is open.
 */
export default function QuickPanel() {
  const [quick, reload] = useQuick();
  const job = useSwitchJob(reload);
  const { network, power } = barStatus.use();
  const { outputs, listOpen, device, toggle, pick } = useOutputs();
  const { bright, setBright, busy, hold } = useBrightness();
  const wired = network?.kind === "wired";
  // Until the radios are read the row keeps what the last open found (the default the first time), so the panel does not jump.
  const radios = (quick === null ? quickLayout.get().radios : quick.wifi !== null || quick.bluetooth !== null) || wired;
  const rows = Math.min(MIXER_MAX_ROWS, outputs.length);
  const list = listOpen ? rows * MIXER_ROW + 14 : 0;
  const brightness = bright !== null;
  useLayoutEffect(() => {
    quickLayout.set({ radios, brightness, list });
  }, [radios, brightness, list]);
  useLayoutEffect(() => () => quickLayout.set({ ...quickLayout.get(), brightness: false, list: 0 }), []);

  // A Windows surface comes to the front: the panel goes and the bar stays up meanwhile.
  const away = (open: () => Promise<void>) => {
    closePanel();
    holdBriefly();
    void open().catch(() => {});
  };
  const wifi = wifiTile(quick?.wifi === true, network);

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      {radios && (
        <div className="flex h-14 shrink-0 gap-2">
          {quick?.wifi != null && (
            <Tile lead={<RadioSwitch kind="wifi" on={quick.wifi} job={job} />} name={t("WLAN")} line={wifi.ssid ?? t(wifi.key)} />
          )}
          {quick?.bluetooth != null && <Tile lead={<RadioSwitch kind="bluetooth" on={quick.bluetooth} job={job} />} name={t("Bluetooth")} line={quick.bluetooth ? t("An") : t("Aus")} />}
          {wired && <Tile lead={<Round icon={Network} />} name={t("Ethernet")} line={t("Verbunden")} onClick={() => away(() => taskbar.settings("ethernet"))} />}
        </div>
      )}
      <div className="flex shrink-0">
        <VolumeTile device={device} open={listOpen} onDevices={toggle} />
      </div>
      {listOpen && <OutputList outputs={outputs} rows={rows} onPick={pick} />}
      {brightness && <BrightnessTile level={bright} busy={busy} hold={hold} onLevel={setBright} />}
      <div className="flex h-10 shrink-0 gap-2">
        <Chip icon={Leaf} name={t("Energiesparmodus")} state={power ? (power.saver ? t("An") : t("Aus")) : null} onClick={() => away(() => taskbar.settings("saver"))} />
        <Chip icon={Airplane} name={t("Flugzeugmodus")} state={null} onClick={() => away(() => taskbar.settings("airplane"))} />
      </div>
      <div className="flex h-8 shrink-0 items-center gap-2">
        <span role="status" className="min-w-0 flex-1 truncate ps-1 text-caption text-label-3">
          {job.note}
        </span>
        <button
          // Settings' home: Win+A (taskbar.shell("quick")) is not yet known to open Windows' quick settings while its taskbar is hidden.
          onClick={() => away(() => taskbar.settings("home"))}
          className="pressable shrink-0 rounded-full px-2.5 py-1 text-footnote font-medium text-label-2 hover:bg-fill-2 hover:text-label"
        >
          {t("Weitere Einstellungen")}
        </button>
      </div>
    </div>
  );
}

/** A radios-row tile: its switch or icon, its name and a line under it; a button as a whole when it opens something. */
function Tile({ lead, name, line, onClick }: { lead: ReactNode; name: string; line: string; onClick?: () => void }) {
  const body = (
    <>
      {lead}
      <span className="flex min-w-0 flex-1 flex-col text-start">
        <span className="truncate text-footnote font-medium text-label">{name}</span>
        <span className="truncate text-caption text-label-3">{line}</span>
      </span>
    </>
  );
  const box = "flex min-w-0 flex-1 basis-0 items-center gap-2 rounded-[12px] bg-fill-1 px-2.5";
  return onClick ? (
    <button onClick={onClick} className={`pressable ${box} hover:bg-fill-2`}>
      {body}
    </button>
  ) : (
    <div className={box}>{body}</div>
  );
}

/** The Ethernet tile's icon, as round as the radios' switches beside it. */
function Round({ icon: I }: { icon: Icon }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-fill-2 text-label-2">
      <I size={15} weight="bold" />
    </span>
  );
}

/** One of the two buttons under the sliders: an icon, a name and, for Energy saver, its state; a click opens its page in Settings. */
function Chip({ icon: I, name, state, onClick }: { icon: Icon; name: string; state: string | null; onClick: () => void }) {
  return (
    <button onClick={onClick} className="pressable flex min-w-0 flex-1 basis-0 items-center gap-2 rounded-[12px] bg-fill-1 px-2.5 hover:bg-fill-2">
      <I size={15} weight="bold" className="shrink-0 text-label-2" />
      <span className="min-w-0 flex-1 truncate text-start text-footnote font-medium text-label">{name}</span>
      {state && <span className="shrink-0 text-caption text-label-3">{state}</span>}
    </button>
  );
}
