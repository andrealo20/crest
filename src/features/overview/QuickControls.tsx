import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowClockwise, Bluetooth, Lock, Microphone, MicrophoneSlash, Moon, Power, WifiHigh, MoonStars, type Icon } from "@phosphor-icons/react";
import { springs } from "../../design/motion";
import { systemControls, type PowerAction, type QuickState } from "../../platform/services";
import { HUE_PALETTE } from "../themes/themes";
import type { Hue } from "../themes/hues";
import { t } from "../../i18n";

/*
 * Overview's quick controls, like the quick settings: Wi-Fi, Bluetooth, the dark theme and the microphone mute as switches, then
 * lock, sleep, restart and shut down. The last three take a second click within a few seconds. A radio or a microphone the PC lacks is left out.
 */

/** The row (h-11) and the gap above it (gap-2.5), for Overview's size. */
export const CONTROLS_ROW = 54;
const ARM_MS = 3000;

/** The controls' state, read while Overview shows (a key or the quick settings may change them); null until read or where none exist. */
export function useQuick(): [QuickState | null, () => void] {
  const [state, setState] = useState<QuickState | null>(null);
  const load = useRef(() => void systemControls.quick().then(setState));
  useEffect(() => {
    load.current();
    const id = setInterval(load.current, 4000);
    // The microphone shortcut changes the mute from outside the page.
    const off = systemControls.onMic(load.current);
    return () => {
      clearInterval(id);
      off();
    };
  }, []);
  return [state, load.current];
}

export function QuickControls({ state, reload }: { state: QuickState; reload: () => void }) {
  const toggle = (job: Promise<void>) => void job.catch(() => {}).finally(reload);
  return (
    <div className="flex h-11 shrink-0 items-center gap-1.5 rounded-[12px] bg-fill-1 px-1.5">
      {state.wifi !== null && <Switch icon={WifiHigh} hue="blue" label={t("WLAN")} on={state.wifi} onToggle={() => toggle(systemControls.setRadio("wifi", !state.wifi))} />}
      {state.bluetooth !== null && <Switch icon={Bluetooth} hue="indigo" label={t("Bluetooth")} on={state.bluetooth} onToggle={() => toggle(systemControls.setRadio("bluetooth", !state.bluetooth))} />}
      <Switch icon={MoonStars} hue="violet" label={t("Dunkles Design")} on={state.dark} onToggle={() => toggle(systemControls.setDark(!state.dark))} />
      {/* Lit while muted, like the mute button of a call. */}
      {state.micMuted !== null && <Switch icon={state.micMuted ? MicrophoneSlash : Microphone} hue="red" label={t("Mikrofon stummschalten")} on={state.micMuted} onToggle={() => toggle(systemControls.setMicMuted(!state.micMuted))} />}
      {/* Switches on one end, the power actions on the other. */}
      <span className="flex-1" />
      <PowerButton icon={Lock} label={t("Sperren")} action="lock" />
      <PowerButton icon={Moon} label={t("Energie sparen")} action="sleep" confirm />
      <PowerButton icon={ArrowClockwise} label={t("Neu starten")} action="restart" confirm />
      <PowerButton icon={Power} label={t("Herunterfahren")} action="shutdown" confirm />
    </div>
  );
}

function Switch({ icon: I, hue, label, on, onToggle }: { icon: Icon; hue: Hue; label: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={onToggle}
      className={`pressable flex size-8 shrink-0 items-center justify-center rounded-full transition-colors duration-200 ${on ? "text-white" : "bg-fill-2 text-label-2 hover:text-label"}`}
      style={on ? { background: HUE_PALETTE[hue][1] } : undefined}
    >
      <I size={15} weight={on ? "fill" : "bold"} />
    </button>
  );
}

/** Lock runs at once; the others arm on the first click (a red ring) and run on the second, or disarm after ARM_MS. */
function PowerButton({ icon: I, label, action, confirm }: { icon: Icon; label: string; action: PowerAction; confirm?: boolean }) {
  const [armed, setArmed] = useState(false);
  const disarm = useRef(0);
  useEffect(() => () => window.clearTimeout(disarm.current), []);
  const onClick = () => {
    if (confirm && !armed) {
      setArmed(true);
      disarm.current = window.setTimeout(() => setArmed(false), ARM_MS);
      return;
    }
    window.clearTimeout(disarm.current);
    setArmed(false);
    void systemControls.power(action).catch(() => {});
  };
  const tip = armed ? t("Zum Bestätigen erneut klicken") : label;
  return (
    <button
      aria-label={tip}
      title={tip}
      onClick={onClick}
      className={`pressable relative flex size-8 shrink-0 items-center justify-center rounded-full transition-colors duration-200 ${armed ? "bg-red/20 text-red" : "text-label-2 hover:bg-fill-2 hover:text-label"}`}
    >
      <I size={15} weight="bold" />
      <AnimatePresence>
        {armed && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full border-2 border-red"
            initial={{ opacity: 0, transform: "scale(0.7)" }}
            animate={{ opacity: 1, transform: "scale(1)", transition: springs.snappy }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
          />
        )}
      </AnimatePresence>
    </button>
  );
}
