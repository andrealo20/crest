// The song title's versions with a cover or keys, and the Microphone widget, as the bar draws them.

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { artwork as artworkSwap, springs, tick } from "../../../design/motion";
import { t } from "../../../i18n";
import { Marquee } from "../../../notch/row/Marquee";
import { measureText } from "../../../notch/row/measure";
import { trackCaption, type PartId } from "../../../notch/row/parts";
import { media } from "../../../platform/media";
import { playedShare, type NowPlaying } from "../../../platform/media/types";
import { systemControls } from "../../../platform/services";
import { SpeakerGlyph } from "../../../ui/glyphs";
import { Microphone, MicrophoneSlash, MusicNoteSimple, Pause, Play, SkipBack, SkipForward } from "../../../ui/iconset";
import { useSmoothArtwork } from "../../now-playing/artwork";
import { useSecondTick } from "../../timer/store";
import { MIC, MIC_WIDTH, TRACK, TRACK_WIDTH, type FaceKey } from "../faceKeys";
import { variantOf, type WidgetVariants } from "../model";
import { SAMPLE_TRACK } from "../sampleFeed";
import { barStatus, startStatus } from "../status";
import { soundGlyph } from "../statusModel";
import type { Body, WidgetContext } from "./Widget";

/*
 * Every face here is as wide as faceKeys.ts says, whatever the song or the state, so nothing beside it moves; left to right in every
 * language, so a click lands on the key widgetKey finds there. The keys are drawn, not buttons: the widget is one button, and a key's
 * glyph is hidden from screen readers, which hear the song or the microphone in the button's description.
 */

/** A glyph that springs in over the one before it when `k` changes (play to pause, live to muted), both in one cell so nothing moves. */
function Swap({ k, children }: { k: string; children: ReactNode }) {
  return (
    <span className="grid place-items-center">
      <AnimatePresence initial={false}>
        <motion.span
          key={k}
          className="col-start-1 row-start-1 flex"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1, transition: springs.pop }}
          exit={{ opacity: 0, scale: 0.6, transition: springs.pop }}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Play or pause, filled; `nudge`: inside a ring or a disc, where the triangle looks centred 1 px to the right. */
function PlayPause({ playing, size, nudge }: { playing: boolean; size: number; nudge?: boolean }) {
  return (
    <Swap k={playing ? "pause" : "play"}>
      {playing ? <Pause size={size} weight="fill" /> : <Play size={size} weight="fill" className={nudge ? "translate-x-px" : undefined} />}
    </Swap>
  );
}

/** A key's column, its glyph hidden from screen readers. */
function Key({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden className="grid shrink-0 place-items-center text-label" style={{ width: TRACK.key }}>
      {children}
    </span>
  );
}

/** The cover, swapped once the new one is decoded with an opacity crossfade, or a note on the fill while the song has none. */
function Cover({ src }: { src: string | null }) {
  const shown = useSmoothArtwork(src);
  return (
    <span className="grid shrink-0 overflow-hidden rounded-[5px] bg-fill-2" style={{ width: TRACK.cover, height: TRACK.cover }}>
      <AnimatePresence initial={false}>
        <motion.span
          key={shown ?? "none"}
          className="col-start-1 row-start-1 grid place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: artworkSwap.enter }}
          exit={{ opacity: 0, transition: artworkSwap.exit }}
        >
          {shown ? <img src={shown} alt="" draggable={false} className="size-full object-cover" /> : <MusicNoteSimple size={12} weight="fill" className="text-label-3" />}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** The title over the artist in a column `width` wide, the title scrolling as the scrolling line does; without an artist the title alone. */
function Lines({ np, width, still, loop }: { np: NowPlaying; width: number; still: boolean; loop: boolean }) {
  const [title, artist] = np.title.trim() ? [np.title.trim(), np.artist.trim()] : [np.artist.trim(), ""];
  return (
    <span className="flex shrink-0 flex-col justify-center" style={{ width }}>
      <span className="flex h-[15px]">
        <Marquee key={title} text={title} textWidth={measureText(title)} width={width} paused={still} endless={loop} />
      </span>
      {artist && <span className="block truncate text-caption text-label-2">{artist}</span>}
    </span>
  );
}

/** The song in one of the versions past the scrolling line. `paused`: the bar rests, nothing ticks; `sample`: the Widgets page's still song. */
function TrackFace({ variant: v, np, paused, hovered, loop, sample }: {
  variant: Exclude<WidgetVariants["title"], "text">;
  np: NowPlaying;
  paused: boolean;
  hovered: boolean;
  loop: boolean;
  sample?: boolean;
}) {
  // Only the ring and the line show the time; they step once a second, and never while the bar rests, the song is paused or has no length (a stream).
  useSecondTick(!sample && !paused && np.isPlaying && np.duration > 0 && (v === "disc" || v === "track"));
  const share = playedShare(np, sample ? np.updatedAt : undefined);
  const still = hovered || paused || !np.isPlaying;
  if (v === "play")
    return (
      <span dir="ltr" className="flex items-center" style={{ gap: TRACK.gap }}>
        <span aria-hidden className="grid shrink-0 place-items-center rounded-full bg-fill-2 text-label material:bg-primary material:text-on-primary" style={{ width: TRACK.disc, height: TRACK.disc }}>
          <PlayPause playing={np.isPlaying} size={12} nudge />
        </span>
        <Lines np={np} width={TRACK.text.play} still={still} loop={loop} />
      </span>
    );
  if (v === "cover")
    return (
      <span dir="ltr" className="flex items-center">
        <span className="flex items-center" style={{ gap: TRACK.gap }}>
          <Cover src={np.artwork} />
          <Lines np={np} width={TRACK.text.cover} still={still} loop={loop} />
        </span>
        <Key>
          <SkipBack size={12} weight="fill" />
        </Key>
        <Key>
          <PlayPause playing={np.isPlaying} size={16} />
        </Key>
        <Key>
          <SkipForward size={12} weight="fill" />
        </Key>
      </span>
    );
  const caption = trackCaption(np.title, np.artist);
  if (v === "disc") {
    const full = share !== null && share >= 0.999;
    return (
      <span dir="ltr" role="img" aria-label={caption} className="relative grid shrink-0 place-items-center text-label" style={{ width: TRACK.key, height: TRACK.key }}>
        <svg aria-hidden width={TRACK.key} height={TRACK.key} viewBox="0 0 22 22" className="absolute inset-0">
          <circle cx="11" cy="11" r="10" fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth="2" className="material:stroke-fill-3 material:[stroke-opacity:1]" />
          {/* No arc while the length is unknown (a live stream); from 12 o'clock, clockwise. */}
          {share !== null && share > 0 && (
            <circle
              cx="11" cy="11" r="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap={full ? "butt" : "round"} className="material:stroke-primary"
              pathLength={100} strokeDasharray={full ? "100 0" : `${share * 100} 100`} transform="rotate(-90 11 11)"
            />
          )}
        </svg>
        <span aria-hidden className="flex">
          <PlayPause playing={np.isPlaying} size={10} nudge />
        </span>
      </span>
    );
  }
  return (
    <span dir="ltr" className="flex items-center text-label" style={{ gap: TRACK.gap }}>
      <span className="flex shrink-0 flex-col justify-center gap-1" style={{ width: TRACK.text.track }}>
        <span className="flex h-[15px]">
          <Marquee key={caption} text={caption} textWidth={measureText(caption)} width={TRACK.text.track} paused={still} endless={loop} />
        </span>
        <span className="relative block h-[3px] overflow-hidden rounded-full material:bg-fill-3!" style={{ background: "color-mix(in srgb, currentColor 25%, transparent)" }}>
          {/* The whole width moved left by what is still to play: a transform, stepping with the second. A new song starts from its own share. */}
          {share !== null && (
            <motion.span key={np.title} className="absolute inset-0 block rounded-full bg-current material:bg-primary" initial={false} animate={{ x: `${(share - 1) * 100}%`, transition: tick }} />
          )}
        </span>
      </span>
      <Key>
        <SkipForward size={14} weight="fill" />
      </Key>
    </span>
  );
}

/** The sample's microphone and sound on the Widgets page: live, at 40 %. */
const SAMPLE_STATUS = { microphone: false, sound: { level: 40, muted: false } };

/**
 * The default microphone, and with `both` the default output beside it, as Rust last told the bar: struck through while muted, in the
 * bar's own colour as Stato's muted speaker; dimmed while unknown (no microphone, or Rust has not said yet). Rust tells it only while
 * the notch says the widget is on the bar (store.ts barOn), and only on a change: nothing reads at intervals.
 */
function MicFace({ both, sample }: { both: boolean; sample?: boolean }) {
  useEffect(() => (sample ? undefined : startStatus()), [sample]);
  const live = barStatus.use();
  const s = sample ? SAMPLE_STATUS : live;
  const muted = s.microphone ?? null, speaker = soundGlyph(s.sound);
  const cell = both ? MIC.key : MIC_WIDTH.mic;
  return (
    <span dir="ltr" className="flex items-center">
      <span role={muted === null ? undefined : "img"} aria-label={muted === null ? undefined : muted ? t("Mikrofon ist stumm") : t("Mikrofon ist an")} className="grid shrink-0 place-items-center" style={{ width: cell }}>
        <Swap k={muted === null ? "unknown" : muted ? "muted" : "live"}>
          {muted ? <MicrophoneSlash size={16} className="text-label" /> : <Microphone size={16} className={muted === null ? "text-label-3" : "text-label"} />}
        </Swap>
      </span>
      {both && (
        <span
          role={speaker && s.sound ? "img" : undefined}
          aria-label={speaker && s.sound ? (speaker === "muted" ? t("Stummgeschaltet") : t("Lautstärke {p} %", { p: s.sound.level })) : undefined}
          className={`grid shrink-0 place-items-center ${speaker ? "text-label" : "text-label-3"}`}
          style={{ width: MIC.key }}
        >
          <Swap k={speaker ?? "unknown"}>
            <SpeakerGlyph glyph={speaker ?? "high"} size={16} />
          </Swap>
        </span>
      )}
    </span>
  );
}

/** The song the bar's own window follows, for the song title's versions; null for every other widget. */
export function useTrack(id: PartId): NowPlaying | null {
  return useSyncExternalStore(media.subscribe, () => (id === "title" ? media.get() : null));
}

/** The song title in one of its versions past the scrolling line; null while no song plays, and the bar draws its icon. */
export function trackPart(variant: Exclude<WidgetVariants["title"], "text">, ctx: WidgetContext): Body | null {
  const np = ctx.sample ? SAMPLE_TRACK : ctx.track;
  return np && (np.title.trim() || np.artist.trim())
    ? { node: <TrackFace variant={variant} np={np} paused={ctx.paused} hovered={ctx.hovered} loop={ctx.titleLoop} sample={ctx.sample} />, width: TRACK_WIDTH[variant] }
    : null;
}

/** The microphone, with the sound beside it in its other version; never null: unknown, it shows dimmed and a click says why. */
export function micPart(ctx: WidgetContext): Body | null {
  const both = variantOf(ctx.variants, "mic") === "both";
  return { node: <MicFace both={both} sample={ctx.sample} />, width: MIC_WIDTH[both ? "both" : "mic"] };
}

/** Does what a face's key does; `fail` puts what went wrong in the widget's label. No state is guessed ahead: Rust tells it back at once. */
export function runFaceKey(key: Exclude<FaceKey, "weather" | "wallPrevious" | "wallNext">, fail: (text: string) => void): void {
  switch (key) {
    case "toggle":
      return media.toggle();
    case "previous":
      return media.previous();
    case "next":
      return media.next();
    case "mic":
      // Unknown counts as live, so the first click mutes; without a microphone Rust refuses, and the label says so.
      return void systemControls.setMicMuted(!barStatus.get().microphone).catch(() => fail(t("Mikrofon nicht verfügbar")));
    case "sound": {
      const now = barStatus.get().sound;
      if (now) void systemControls.setVolume({ muted: !now.muted }).catch(() => {});
    }
  }
}
