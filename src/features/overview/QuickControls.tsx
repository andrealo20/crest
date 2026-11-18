import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowClockwise, Bed, Lock, Microphone, MicrophoneSlash, Power, MoonStars, type Icon } from "@phosphor-icons/react";
import { springs } from "../../design/motion";
import { systemControls, type PowerAction, type QuickState } from "../../platform/services";
import { HUE_PALETTE } from "../themes/themes";
import type { Hue } from "../themes/hues";
import { t } from "../../i18n";
import { BluetoothGlyph, NetGlyph } from "../../ui/glyphs";

/*
 * Overview's quick controls, like the quick settings: Wi-Fi, Bluetooth, the dark theme and the microphone mute as switches, then
 * lock, sleep, restart and shut down. The last three take a second click within a few seconds. A radio or a microphone the PC lacks is left out.
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
    // The microphone shortcut changes the mute from outside the page.
    const off = systemControls.onMic(load.current);
    return () => {
      clearInterval(id);
      off();
    };
  }, []);
  return [state, load.current];
}

/** A switch's command under way and what went wrong with the last one, shared by the switches of one view. */
export type SwitchJob = { busy: boolean; note: string | null; run: (job: Promise<void>) => void; fail: (e: unknown) => void };

export function useSwitchJob(reload: () => void): SwitchJob {
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
  const run = (job: Promise<void>) => {
    setBusy(true);
    void job.catch(fail).finally(() => {
      setBusy(false);
      reload();
    });
  };
  return { busy, note, run, fail };
}

export function QuickControls({ state, reload }: { state: QuickState; reload: () => void }) {
  const job = useSwitchJob(reload);
  return (
    <div className="flex h-11 shrink-0 items-center gap-1.5 rounded-[12px] bg-fill-1 px-1.5">
      {state.wifi !== null && <RadioSwitch kind="wifi" on={state.wifi} job={job} />}
      {state.bluetooth !== null && <RadioSwitch kind="bluetooth" on={state.bluetooth} job={job} />}
      <Switch icon={MoonStars} hue="violet" label={t("Dunkles Design")} on={state.dark} busy={job.busy} onToggle={() => job.run(systemControls.setDark(!state.dark))} />
      {/* Lit while muted, like the mute button of a call. */}
      {state.micMuted !== null && <Switch icon={state.micMuted ? MicrophoneSlash : Microphone} hue="red" label={t("Mikrofon stummschalten")} on={state.micMuted} busy={job.busy} onToggle={() => job.run(systemControls.setMicMuted(!state.micMuted))} />}
      {/* Switches on one end, the power actions on the other; between them, what went wrong. */}
      <span role="status" className="min-w-0 flex-1 truncate ps-1 text-caption text-label-3">
        {job.note}
      </span>
      <PowerButton icon={Lock} label={t("Sperren")} action="lock" onError={job.fail} />
      <PowerButton icon={Bed} label={t("Energie sparen")} action="sleep" confirm onError={job.fail} />
      <PowerButton icon={ArrowClockwise} label={t("Neu starten")} action="restart" confirm onError={job.fail} />
      <PowerButton icon={Power} label={t("Herunterfahren")} action="shutdown" confirm onError={job.fail} />
    </div>
  );
}

/** The Wi-Fi or the Bluetooth switch, in Overview's row and in the bar's quick panel. */
export function RadioSwitch({ kind, on, job }: { kind: "wifi" | "bluetooth"; on: boolean; job: SwitchJob }) {
  const wifi = kind === "wifi";
  return (
    <Switch
      glyph={<RadioGlyph kind={kind} size={16} />}
      hue={wifi ? "blue" : "indigo"}
      label={wifi ? t("WLAN") : t("Bluetooth")}
      on={on}
      busy={job.busy}
      onToggle={() => job.run(systemControls.setRadio(kind, !on))}
    />
  );
}

/** A radio's glyph, the same shape on and off: the full fan for Wi-Fi, the rune for Bluetooth. */
export function RadioGlyph({ kind, size }: { kind: "wifi" | "bluetooth"; size: number }) {
  return kind === "wifi" ? <NetGlyph glyph="wifi-3" size={size} /> : <BluetoothGlyph size={size} />;
}

/** A radio's disc as Switch draws it, for a glyph that is not a button of its own: only its colour says on. */
export function RadioDisc({ kind, on, children }: { kind: "wifi" | "bluetooth"; on: boolean; children: ReactNode }) {
  return (
    <span
      className={`flex size-8 shrink-0 items-center justify-center rounded-full transition-colors duration-200 ${on ? "text-white" : "bg-fill-2 text-label-2"}`}
      style={on ? { background: HUE_PALETTE[kind === "wifi" ? "blue" : "indigo"][1] } : undefined}
    >
      {children}
    </span>
  );
}

/** A round switch: its Phosphor icon (filled when on), or a glyph of Crest's own drawn as it is. */
function Switch({ icon: I, glyph, hue, label, on, busy, onToggle }: { icon?: Icon; glyph?: ReactNode; hue: Hue; label: string; on: boolean; busy: boolean; onToggle: () => void }) {
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
      {glyph ?? (I && <I size={15} weight={on ? "fill" : "bold"} />)}
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
