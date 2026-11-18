import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Check, Headphones, SpeakerHifi, SpeakerHigh, SpeakerLow, SpeakerNone, SpeakerSimpleHigh, SpeakerSimpleSlash, Sun, SunDim } from "@phosphor-icons/react";
import { isMac } from "../../platform/native";
import { content, springs } from "../../design/motion";
import { systemControls, type AudioOutput, type VolumeState } from "../../platform/services";
import { MIXER_ROW, sendSystemVolume } from "../now-playing/Mixer";
import { outputIcon } from "./outputs";
import { useHue } from "../themes/hues";
import { t } from "../../i18n";
import { sliderKey } from "../../ui/sliderKey";

/*
 * Overview's volume, output and brightness rows, shared with the bar's quick panel. Each view keeps its own layout and size;
 * the hooks hold the state and the reads, which run only while a view that uses them shows.
 */

/** Playback devices: read when the view shows and each time the list opens, so one plugged in meanwhile shows up. `device` is the default output's name, null with nothing to choose from. */
export function useOutputs(): { outputs: AudioOutput[]; choice: boolean; listOpen: boolean; device: string | null; toggle: () => void; pick: (id: string) => void } {
  const [outputs, setOutputs] = useState<AudioOutput[]>([]);
  const [outputsOpen, setOutputsOpen] = useState(false);
  const loadOutputs = () => void systemControls.outputs().then(setOutputs).catch(() => setOutputs([]));
  useEffect(() => {
    if (!isMac) loadOutputs();
  }, []);
  const choice = outputs.length > 1;
  const listOpen = outputsOpen && choice;
  const pick = (id: string) => {
    setOutputsOpen(false);
    setOutputs((list) => list.map((o) => ({ ...o, default: o.id === id })));
    void systemControls.setOutput(id).catch(() => {}).finally(loadOutputs);
  };
  const toggle = () => {
    if (!outputsOpen) loadOutputs();
    setOutputsOpen(!outputsOpen);
  };
  return { outputs, choice, listOpen, device: choice ? (outputs.find((o) => o.default)?.name ?? "") : null, toggle, pick };
}

/** The calling window's monitor brightness: the row shows only where Crest can set it, read every few seconds (keys, other apps). */
export function useBrightness(): { bright: number | null; setBright: (n: number) => void; busy: { current: boolean }; hold: { current: number } } {
  const [bright, setBright] = useState<number | null>(null);
  const brightBusy = useRef(false);
  // Until when a reading would undo the slider: writes still going out, or just landed.
  const brightHold = useRef(0);
  const brightMisses = useRef(0);
  useEffect(() => {
    const quiet = () => brightBusy.current || Date.now() < brightHold.current;
    let period = 3000;
    let id = 0;
    // A read still out when the view goes must neither set its state nor start a poll that nothing would stop.
    let alive = true;
    const load = () =>
      !quiet() &&
      void systemControls.brightness().then((v) => {
        if (!alive || quiet()) return;
        // DDC/CI misses a read now and then: the row goes only after three in a row.
        brightMisses.current = v === null ? brightMisses.current + 1 : 0;
        if (v !== null || brightMisses.current >= 3) setBright(v);
        // With nothing to set, look again only now and then (another monitor may take the notch).
        const every = brightMisses.current >= 3 ? 30_000 : 3000;
        if (every !== period) {
          period = every;
          window.clearInterval(id);
          id = window.setInterval(load, every);
        }
      });
    load();
    id = window.setInterval(load, period);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);
  return { bright, setBright, busy: brightBusy, hold: brightHold };
}

const OUTPUT_ICONS = { headphones: Headphones, "speaker-hifi": SpeakerHifi, speaker: SpeakerSimpleHigh };

export function OutputIcon({ name, className }: { name: string; className?: string }) {
  const Icon = OUTPUT_ICONS[outputIcon(name)];
  return <Icon size={15} weight="fill" className={className} />;
}

/** The active playback devices; picking one makes it the Windows default. */
export function OutputList({ outputs, rows, onPick }: { outputs: AudioOutput[]; rows: number; onPick: (id: string) => void }) {
  return (
    <motion.div
      className="flex shrink-0 flex-col"
      initial={{ opacity: 0, filter: "blur(4px)" }}
      animate={{ opacity: 1, filter: "blur(0px)", transition: { ...content.enter, delay: 0.06 } }}
    >
      <div className="mx-0.5 mb-[3px] h-px bg-separator" />
      <div
        role="listbox"
        aria-label={t("Ausgabegerät")}
        className="-mx-1 overflow-y-auto px-1 [scrollbar-width:none]"
        style={{ maxHeight: rows * MIXER_ROW }}
      >
        {outputs.map((o) => (
          <button
            key={o.id}
            role="option"
            aria-selected={o.default}
            onClick={() => onPick(o.id)}
            className="pressable flex w-full items-center gap-2.5 rounded-[10px] px-2 text-start hover:bg-fill-1"
            style={{ height: MIXER_ROW }}
          >
            <OutputIcon name={o.name} className={`shrink-0 ${o.default ? "text-label" : "text-label-3"}`} />
            <span className={`min-w-0 flex-1 truncate text-footnote ${o.default ? "font-medium text-label" : "text-label-2"}`}>{o.name}</span>
            {o.default && <Check size={13} weight="bold" className="shrink-0 text-label" />}
          </button>
        ))}
      </div>
    </motion.div>
  );
}

/** A tile (h-10) and the gap above it (gap-2.5). */
export const BRIGHTNESS_ROW = 50;

/** The calling window's monitor brightness, 0..100. A drag sends one write at a time and then the latest level: DDC/CI answers slowly. */
/** `busy`: a drag is under way. `hold`: until when `useBrightness`'s poll must not overwrite the level (writes in flight, plus a second). */
export function BrightnessTile({ level, busy, hold, onLevel }: { level: number; busy: { current: boolean }; hold: { current: number }; onLevel: (percent: number) => void }) {
  const sunHue = useHue("amber");
  const track = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  const next = useRef<number | null>(null);
  const push = (percent: number) => {
    next.current = percent;
    hold.current = Infinity;
    if (sending.current) return;
    sending.current = true;
    const run = () => {
      const value = next.current;
      next.current = null;
      if (value === null) {
        sending.current = false;
        hold.current = Date.now() + 1000;
        return;
      }
      void systemControls.setBrightness(value).catch(() => {}).finally(run);
    };
    run();
  };
  const set = (percent: number) => {
    const p = Math.round(Math.min(100, Math.max(0, percent)));
    onLevel(p);
    push(p);
  };
  const at = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * 100;
  };
  const Icon = level < 50 ? SunDim : Sun;

  return (
    <div className="flex h-10 items-center gap-2 rounded-[12px] bg-fill-1 pe-3 ps-1.5">
      <span className="flex size-7 shrink-0 items-center justify-center text-label-2" style={sunHue ? { color: sunHue } : undefined}>
        <Icon size={15} weight="fill" />
      </span>
      <div
        ref={track}
        // Filled from the left in every language, like the volume.
        dir="ltr"
        role="slider"
        tabIndex={0}
        aria-label={t("Helligkeit")}
        aria-valuenow={level}
        aria-valuetext={`${level} %`}
        aria-valuemin={0}
        aria-valuemax={100}
        className="relative h-6 min-w-0 flex-1 cursor-pointer touch-none overflow-hidden rounded-full bg-fill-2 outline-none focus-visible:ring-1 focus-visible:ring-label-3"
        onPointerDown={(e) => {
          busy.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          set(at(e.clientX));
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && set(at(e.clientX))}
        onPointerUp={() => (busy.current = false)}
        onPointerCancel={() => (busy.current = false)}
        onWheel={(e) => set(level + (e.deltaY < 0 ? 2 : -2))}
        onKeyDown={(e) => {
          const to = sliderKey(e.key, level, 5, 0, 100);
          if (to === undefined) return;
          e.preventDefault();
          set(to);
        }}
      >
        <motion.div
          className="absolute inset-0 origin-left rounded-full bg-label"
          initial={false}
          animate={{ transform: `scaleX(${level / 100})` }}
          transition={busy.current ? { duration: 0 } : springs.snappy}
        />
      </div>
      <span className="tabular w-8 shrink-0 text-end text-caption font-semibold text-label-2">{level}</span>
    </div>
  );
}

/** Thick volume slider like Control Center: drag anywhere, icon = mute. `device` is the default output's name, null with nothing to choose from. */
export function VolumeTile({ device, open, onDevices }: { device: string | null; open: boolean; onDevices: () => void }) {
  const speakerHue = useHue("sky");
  const outputHue = useHue("teal");
  const [vol, setVol] = useState<VolumeState | null>(null);
  const dragging = useRef(false);
  const track = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = () => !dragging.current && void systemControls.volume().then(setVol).catch(() => {});
    load();
    // Keyboard volume keys or taskbar → follow them. Each read opens the audio endpoint, so not every second.
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  const level = vol ? (vol.muted ? 0 : vol.level) : 0;
  const change = (raw: number) => {
    const l = Math.round(Math.min(1, Math.max(0, raw)) * 100) / 100;
    if (vol && !vol.muted && vol.level === l) return;
    setVol({ level: l, muted: false });
    sendSystemVolume("", { level: l });
  };
  const set = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    change((clientX - r.left) / r.width);
  };
  const Icon = vol?.muted || level === 0 ? SpeakerSimpleSlash : level < 0.34 ? SpeakerNone : level < 0.67 ? SpeakerLow : SpeakerHigh;

  return (
    <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[12px] bg-fill-1 pe-3 ps-1.5">
      <button
        aria-label={vol?.muted ? t("Stummschaltung aufheben") : t("Stumm")}
        disabled={!vol}
        onClick={() => vol && void systemControls.setVolume({ muted: !vol.muted }).then(setVol).catch(() => {})}
        className={`pressable flex size-7 shrink-0 items-center justify-center rounded-full ${vol?.muted ? "text-red" : "text-label-2 hover:text-label"}`}
        style={!vol?.muted && speakerHue ? { color: speakerHue } : undefined}
      >
        <Icon size={15} weight="fill" />
      </button>
      <div
        ref={track}
        // Filled from the left in every language: the pointer math reads from the left.
        dir="ltr"
        role="slider"
        tabIndex={0}
        aria-label={t("Lautstärke")}
        aria-valuenow={Math.round(level * 100)}
        aria-valuetext={`${Math.round(level * 100)} %`}
        aria-valuemin={0}
        aria-valuemax={100}
        className="relative h-6 min-w-0 flex-1 cursor-pointer touch-none overflow-hidden rounded-full bg-fill-2 outline-none focus-visible:ring-1 focus-visible:ring-label-3"
        onPointerDown={(e) => {
          if (!vol) return;
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          set(e.clientX);
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && set(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        onWheel={(e) => vol && change(level + (e.deltaY < 0 ? 0.02 : -0.02))}
        onKeyDown={(e) => {
          const to = sliderKey(e.key, level, 0.05, 0, 1);
          if (!vol || to === undefined) return;
          e.preventDefault();
          change(to);
        }}
      >
        <motion.div
          className="absolute inset-0 origin-left rounded-full bg-label"
          initial={false}
          animate={{ transform: `scaleX(${level})` }}
          transition={dragging.current ? { duration: 0 } : springs.snappy}
        />
      </div>
      <span className="tabular w-8 shrink-0 text-end text-caption font-semibold text-label-2">{vol ? Math.round(level * 100) : "-"}</span>
      {device !== null && (
        <button
          aria-label={t("Ausgabegerät")}
          aria-expanded={open}
          title={device || t("Ausgabegerät")}
          onClick={onDevices}
          className={`pressable -me-1.5 flex size-7 shrink-0 items-center justify-center rounded-full transition-colors duration-150 ${
            open ? "bg-fill-2 text-label" : "text-label-2 hover:text-label"
          }`}
          style={!open && outputHue ? { color: outputHue } : undefined}
        >
          <OutputIcon name={device} />
        </button>
      )}
    </div>
  );
}
