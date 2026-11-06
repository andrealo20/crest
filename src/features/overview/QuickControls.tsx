import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowClockwise, Bed, Bluetooth, Lock, Power, WifiHigh, MoonStars, type Icon } from "@phosphor-icons/react";
import { springs } from "../../design/motion";
import { systemControls, type PowerAction, type QuickState } from "../../platform/services";
import { HUE_PALETTE } from "../themes/themes";
import type { Hue } from "../themes/hues";
import { t } from "../../i18n";

/*
 * Overview's quick controls, like the quick settings: Wi-Fi, Bluetooth and the dark theme as switches, then lock, sleep,
 * restart and shut down. The last three take a second click within a few seconds. A radio the PC lacks is left out.
 */

/** The row (h-11) and the gap above it (gap-2.5), for Overview's size. */
export const CONTROLS_ROW = 54;
const ARM_MS = 3000;
const NOTE_MS = 4000;

/** What a rejected command says, by the codes of services.ts and quick.rs. */
function failure(e: unknown): string {
  const code = String(e);
  if (code === "denied") return t("Vom System nicht erlaubt");
  if (code === "settings") return t("In den Windows-Einstellungen ändern");
  return t("Das hat nicht geklappt");
}

/** The controls' state, read while Overview shows (a key or the quick settings may change them); null until read or where none exist. */
export function useQuick(): [QuickState | null, () => void] {
  const [state, setState] = useState<QuickState | null>(null);
  const load = useRef(() => void systemControls.quick().then(setState));
  useEffect(() => {
    load.current();
    const id = setInterval(load.current, 4000);
    return () => clearInterval(id);
  }, []);
  return [state, load.current];
}

export function QuickControls({ state, reload }: { state: QuickState; reload: () => void }) {
  // A switch is off limits while its command runs (a radio can take a second or two), so a second click cannot repeat it.
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(noteTimer.current), []);
  const fail = (e: unknown) => {
    setNote(failure(e));
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(null), NOTE_MS);
  };
  const toggle = (job: Promise<void>) => {
    setBusy(true);
    void job.catch(fail).finally(() => {
      setBusy(false);
      reload();
    });
  };
  return (
    <div className="flex h-11 shrink-0 items-center gap-1.5 rounded-[12px] bg-fill-1 px-1.5">
      {state.wifi !== null && <Switch icon={WifiHigh} hue="blue" label={t("WLAN")} on={state.wifi} busy={busy} onToggle={() => toggle(systemControls.setRadio("wifi", !state.wifi))} />}
      {state.bluetooth !== null && <Switch icon={Bluetooth} hue="indigo" label={t("Bluetooth")} on={state.bluetooth} busy={busy} onToggle={() => toggle(systemControls.setRadio("bluetooth", !state.bluetooth))} />}
      <Switch icon={MoonStars} hue="violet" label={t("Dunkles Design")} on={state.dark} busy={busy} onToggle={() => toggle(systemControls.setDark(!state.dark))} />
      {/* Switches on one end, the power actions on the other; between them, what went wrong. */}
      <span role="status" className="min-w-0 flex-1 truncate ps-1 text-caption text-label-3">
        {note}
      </span>
      <PowerButton icon={Lock} label={t("Sperren")} action="lock" onError={fail} />
      <PowerButton icon={Bed} label={t("Energie sparen")} action="sleep" confirm onError={fail} />
      <PowerButton icon={ArrowClockwise} label={t("Neu starten")} action="restart" confirm onError={fail} />
      <PowerButton icon={Power} label={t("Herunterfahren")} action="shutdown" confirm onError={fail} />
    </div>
  );
}

function Switch({ icon: I, hue, label, on, busy, onToggle }: { icon: Icon; hue: Hue; label: string; on: boolean; busy: boolean; onToggle: () => void }) {
  return (
    <button
      aria-label={label}
      aria-pressed={on}
      title={label}
      disabled={busy}
      onClick={onToggle}
      className={`pressable flex size-8 shrink-0 items-center justify-center rounded-full transition-colors duration-200 disabled:opacity-60 ${on ? "text-white" : "bg-fill-2 text-label-2 hover:text-label"}`}
      style={on ? { background: HUE_PALETTE[hue][1] } : undefined}
    >
      <I size={15} weight={on ? "fill" : "bold"} />
    </button>
  );
}

/** Lock runs at once; the others arm on the first click (a red ring) and run on the second, or disarm after ARM_MS. */
function PowerButton({ icon: I, label, action, confirm, onError }: { icon: Icon; label: string; action: PowerAction; confirm?: boolean; onError: (e: unknown) => void }) {
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
    void systemControls.power(action).catch(onError);
  };
  // Keeps the action's name: two armed buttons must not read alike.
  const tip = armed ? `${label}: ${t("Zum Bestätigen erneut klicken")}` : label;
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
