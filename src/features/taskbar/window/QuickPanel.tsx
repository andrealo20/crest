import { useEffect, useLayoutEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CaretRight } from "@phosphor-icons/react";
import { content } from "../../../design/motion";
import { t } from "../../../i18n";
import { systemControls, taskbar } from "../../../platform/services";
import { AirplaneGlyph, NetGlyph, SaverGlyph } from "../../../ui/glyphs";
import { RadioDisc, RadioGlyph, useQuick, useSwitchJob, type SwitchJob } from "../../overview/QuickControls";
import { BrightnessTile, OutputList, VolumeTile, useBrightness, useOutputs } from "../../overview/QuickTiles";
import { MIXER_MAX_ROWS, MIXER_ROW } from "../../now-playing/Mixer";
import { quickLayout, quickPage } from "../panel";
import { pageAfter, type QuickPage } from "../panelModel";
import { barStatus } from "../status";
import { wifiTile } from "../statusModel";
import { BluetoothPage } from "./BluetoothPage";
import { away } from "./QuickPage";
import { WifiPage } from "./WifiPage";

/**
 * Stato's quick panel, sized by QUICK_SIZE: the radios that apply (Wi-Fi, Bluetooth), each split as in Windows between its switch and
 * the chevron opening its page, the volume with its outputs, the bar's own monitor brightness where Crest can set it, Energy saver,
 * Airplane mode and, while a cable carries the internet, Ethernet, and a footer with what went wrong and Windows' Settings. Built
 * from Overview's pieces, whose reads run only while the panel is open, and keep running under a page.
 */
export default function QuickPanel() {
  const [quick, reload] = useQuick();
  const job = useSwitchJob(reload);
  const { network, power } = barStatus.use();
  const { outputs, listOpen, device, toggle, pick } = useOutputs();
  const { bright, read, setBright, busy, hold } = useBrightness();
  const page = quickPage.use();
  const wired = network?.kind === "wired";
  // Until the radios are read the row keeps what the last open found (the default the first time), so the panel does not jump.
  const radios = quick === null ? quickLayout.get().radios : quick.wifi !== null || quick.bluetooth !== null;
  const rows = Math.min(MIXER_MAX_ROWS, outputs.length);
  const list = listOpen ? rows * MIXER_ROW + 14 : 0;
  // The brightness row the same way until its first answer, drawn empty meanwhile.
  const brightness = read ? bright !== null : quickLayout.get().brightness;
  useLayoutEffect(() => {
    quickLayout.set({ radios, brightness, list });
  }, [radios, brightness, list]);
  useLayoutEffect(
    () => () => {
      quickLayout.set({ ...quickLayout.get(), list: 0 });
      quickPage.set(null);
    },
    [],
  );
  // A page whose radio is gone (adapter removed) goes back to the main page.
  useEffect(() => {
    if (page && pageAfter(page.page, quick) === null) quickPage.set(null);
  }, [page?.page, quick?.wifi, quick?.bluetooth]);

  const open = (p: QuickPage) => quickPage.set({ page: p, rows: 1, extra: 0 });
  const wifi = wifiTile(quick?.wifi === true, network);

  return (
    <AnimatePresence initial={false} mode="popLayout">
      <motion.div
        key={page?.page ?? "main"}
        className="h-full"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: content.enter }}
        exit={{ opacity: 0, transition: content.exit }}
      >
        {page?.page === "wifi" ? (
          <WifiPage on={quick?.wifi === true} job={job} />
        ) : page?.page === "bluetooth" ? (
          <BluetoothPage on={quick?.bluetooth === true} job={job} />
        ) : (
          <div className="flex h-full flex-col gap-2.5 p-3">
            {radios && (
              <div className="flex h-14 shrink-0 gap-2">
                {quick?.wifi != null && (
                  <SplitTile kind="wifi" on={quick.wifi} job={job} name={t("WLAN")} line={wifi.ssid ?? t(wifi.key)} onOpen={() => open("wifi")} />
                )}
                {quick?.bluetooth != null && (
                  <SplitTile kind="bluetooth" on={quick.bluetooth} job={job} name={t("Bluetooth")} line={quick.bluetooth ? t("An") : t("Aus")} onOpen={() => open("bluetooth")} />
                )}
              </div>
            )}
            <div className="flex shrink-0">
              <VolumeTile device={device} open={listOpen} onDevices={toggle} />
            </div>
            {listOpen && <OutputList outputs={outputs} rows={rows} onPick={pick} />}
            {brightness && (bright === null ? <div className="h-10 shrink-0" /> : <BrightnessTile level={bright} busy={busy} hold={hold} onLevel={setBright} />)}
            <div className="flex h-10 shrink-0 gap-2">
              <Chip icon={<SaverGlyph size={16} />} name={t("Energiesparmodus")} state={power ? (power.saver ? t("An") : t("Aus")) : null} onClick={() => away(() => taskbar.settings("saver"))} />
              <Chip icon={<AirplaneGlyph size={16} />} name={t("Flugzeugmodus")} state={null} onClick={() => away(() => taskbar.settings("airplane"))} />
              {/* Shown only while the cable carries the internet, so it needs no "Connected": three chips leave no room for it beside the name. */}
              {wired && <Chip icon={<NetGlyph glyph="wired" size={16} />} name={t("Ethernet")} state={null} onClick={() => away(() => taskbar.settings("ethernet"))} />}
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
        )}
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * A radio's tile split as in Windows: the left part, its disc, name and line, switches the radio; the chevron, past a thin line,
 * opens the radio's page.
 */
function SplitTile({ kind, on, job, name, line, onOpen }: { kind: "wifi" | "bluetooth"; on: boolean; job: SwitchJob; name: string; line: string; onOpen: () => void }) {
  const show = kind === "wifi" ? t("WLAN-Netzwerke anzeigen") : t("Bluetooth-Geräte anzeigen");
  return (
    <div className="flex min-w-0 flex-1 basis-0 items-center overflow-hidden rounded-[12px] bg-fill-1 material:rounded-full">
      <button
        aria-pressed={on}
        aria-label={name}
        disabled={job.busy}
        onClick={() => job.run(systemControls.setRadio(kind, !on))}
        className="pressable flex h-full min-w-0 flex-1 items-center gap-2 ps-2.5 hover:bg-fill-2 disabled:opacity-60"
      >
        <RadioDisc kind={kind} on={on}>
          <RadioGlyph kind={kind} size={16} />
        </RadioDisc>
        <span className="flex min-w-0 flex-1 flex-col text-start">
          <span className="truncate text-footnote font-medium text-label">{name}</span>
          <span className="truncate text-caption text-label-3">{line}</span>
        </span>
      </button>
      <span aria-hidden className="my-2.5 w-px self-stretch bg-separator" />
      <button
        aria-label={show}
        title={show}
        onClick={onOpen}
        className="pressable flex h-full w-8 shrink-0 items-center justify-center text-label-2 hover:bg-fill-2 hover:text-label"
      >
        <CaretRight size={14} weight="regular" className="rtl:-scale-x-100" />
      </button>
    </div>
  );
}

/** One of the buttons under the sliders: an icon, a name and its state where it has one; a click opens its page in Settings. */
function Chip({ icon, name, state, onClick }: { icon: ReactNode; name: string; state: string | null; onClick: () => void }) {
  return (
    <button onClick={onClick} className="pressable flex min-w-0 flex-1 basis-0 items-center gap-2 rounded-[12px] bg-fill-1 px-2.5 hover:bg-fill-2 material:rounded-full">
      <span className="flex shrink-0 text-label-2">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-start text-footnote font-medium text-label">{name}</span>
      {state && <span className="shrink-0 text-caption text-label-3">{state}</span>}
    </button>
  );
}
