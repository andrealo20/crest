import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BellSimpleSlash, CaretRight, Microphone, MicrophoneSlash, Monitor, Moon, SlidersHorizontal, User } from "../../../ui/iconset";
import { content } from "../../../design/motion";
import { t } from "../../../i18n";
import { systemControls, taskbar } from "../../../platform/services";
import { AirplaneGlyph, NetGlyph, SaverGlyph } from "../../../ui/glyphs";
import { RadioDisc, RadioGlyph, useQuick, useSwitchJob, type SwitchJob } from "../../overview/QuickControls";
import { BrightnessTile, OutputList, VolumeTile, useBrightness, useOutputs } from "../../overview/QuickTiles";
import { MIXER_MAX_ROWS, MIXER_ROW } from "../../now-playing/Mixer";
import { quickLayout, quickPage } from "../panel";
import { pageAfter, quickChips, type QuickChip, type QuickPage } from "../panelModel";
import { barStatus } from "../status";
import { wifiTile } from "../statusModel";
import { BluetoothPage } from "./BluetoothPage";
import { MixerPage } from "./MixerPage";
import { away } from "./QuickPage";
import { WifiPage } from "./WifiPage";

/** Whether the last open found a microphone (QuickPanel's chips). */
let hadMic = true;

/**
 * Stato's quick panel, sized by QUICK_SIZE: the radios that apply (Wi-Fi, Bluetooth), each split as in Windows between its switch and
 * the chevron opening its page, the volume with its outputs, the bar's own monitor brightness where Crest can set it, a grid of chips
 * (Energy saver, Airplane mode, Ethernet while a cable carries the internet, the microphone's mute, Cast, Night light, Do not
 * disturb, Accessibility), and a footer with what went wrong and Windows' Settings. Night light and Do not disturb only open their
 * pages in Settings. Built
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
  // Do not disturb's state, read once as the panel opens.
  const [dnd, setDnd] = useState<boolean | null>(null);
  useEffect(() => void systemControls.focus().then((f) => setDnd(f.active), () => {}), []);
  // The microphone's chip as the last open found it until the first read, as the radios.
  if (quick) hadMic = quick.micMuted !== null;
  const chips = quickChips({ wired, mic: hadMic });
  useLayoutEffect(() => {
    quickLayout.set({ radios, brightness, list, chips: chips.length });
  }, [radios, brightness, list, chips.length]);
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
        ) : page?.page === "mixer" ? (
          <MixerPage />
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
            <div className="flex shrink-0 gap-2">
              <VolumeTile device={device} open={listOpen} onDevices={toggle} />
              <button
                aria-label={t("Lautstärkemixer")}
                title={t("Lautstärkemixer")}
                onClick={() => open("mixer")}
                className="pressable flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-fill-1 text-label-2 hover:bg-fill-2 hover:text-label material:rounded-full"
              >
                <SlidersHorizontal size={16} weight="regular" />
              </button>
            </div>
            {listOpen && <OutputList outputs={outputs} rows={rows} onPick={pick} />}
            {brightness && (bright === null ? <div className="h-10 shrink-0" /> : <BrightnessTile level={bright} busy={busy} hold={hold} onLevel={setBright} />)}
            <div className="grid shrink-0 auto-rows-[40px] grid-cols-3 gap-2">
              {chips.map((c) => {
                const muted = quick?.micMuted === true;
                const chip: Record<QuickChip, () => ReactNode> = {
                  saver: () => <Chip icon={<SaverGlyph size={16} />} name={t("Energiesparmodus")} state={power ? (power.saver ? t("An") : t("Aus")) : null} onClick={() => away(() => taskbar.settings("saver"))} />,
                  airplane: () => <Chip icon={<AirplaneGlyph size={16} />} name={t("Flugzeugmodus")} state={null} onClick={() => away(() => taskbar.settings("airplane"))} />,
                  // Shown only while the cable carries the internet, so it needs no "Connected".
                  ethernet: () => <Chip icon={<NetGlyph glyph="wired" size={16} />} name={t("Ethernet")} state={null} onClick={() => away(() => taskbar.settings("ethernet"))} />,
                  mic: () => (
                    <Chip
                      icon={muted ? <MicrophoneSlash size={16} weight="regular" /> : <Microphone size={16} weight="regular" />}
                      name={t("Mikrofon")}
                      state={muted ? t("Stummgeschaltet") : t("An")}
                      pressed={muted}
                      disabled={job.busy}
                      onClick={() => job.run(systemControls.setMicMuted(!muted))}
                    />
                  ),
                  cast: () => <Chip icon={<Monitor size={16} weight="regular" />} name={t("Übertragen")} state={null} onClick={() => away(() => taskbar.shell("cast"))} />,
                  night: () => <Chip icon={<Moon size={16} weight="regular" />} name={t("Nachtmodus")} state={null} onClick={() => away(() => taskbar.settings("night"))} />,
                  dnd: () => <Chip icon={<BellSimpleSlash size={16} weight="regular" />} name={t("Nicht stören")} state={dnd === null ? null : dnd ? t("An") : t("Aus")} onClick={() => away(() => taskbar.settings("dnd"))} />,
                  access: () => <Chip icon={<User size={16} weight="regular" />} name={t("Barrierefreiheit")} state={null} onClick={() => away(() => taskbar.settings("access"))} />,
                };
                return <span key={c} className="flex min-w-0">{chip[c]()}</span>;
              })}
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

/** One of the buttons under the sliders: an icon, a name and its state where it has one; a click opens its page in Settings, or with `pressed` switches it. */
function Chip({ icon, name, state, onClick, pressed, disabled }: { icon: ReactNode; name: string; state: string | null; onClick: () => void; pressed?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={pressed}
      disabled={disabled}
      title={name}
      className="pressable flex min-w-0 flex-1 basis-0 items-center gap-2 rounded-[12px] bg-fill-1 px-2.5 hover:bg-fill-2 disabled:opacity-60 material:rounded-full"
    >
      <span className="flex shrink-0 text-label-2">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-start text-footnote font-medium text-label">{name}</span>
      {state && <span className="shrink-0 text-caption text-label-3">{state}</span>}
    </button>
  );
}
