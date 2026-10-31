import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlarmIcon, CheckCircle, FilmStrip, Pause, Play, Stop } from "@phosphor-icons/react";
import { pauseRecording, recording, saved, stopRecording, type Saved } from "../../features/capture/store";
import { elapsedAt, formatElapsed } from "../../features/capture/clock";
import { openFile } from "../../platform/services";
import { content, pulse } from "../../design/motion";
import { useNowPlaying } from "../../platform/media";
import type { UsageId } from "../../platform/services";
import { settings } from "../../settings/store";
import { ringing, timer, timerActions, useSecondTick } from "../../features/timer/store";
import { usage } from "../../features/usage/store";
import { windowLabel } from "../../features/usage/UsageView";
import { brandName } from "../../ui/brands";
import { formatIn } from "../../lib/format";
import { t } from "../../i18n";
import { QUOTA, SAVED, TRACK, armTrack, detectRise, newQuotaTracker, observeTrack, topNotice, type QuotaRise, type TrackGate } from "./notices";
import { ROW } from "./layout";
import { trackCaption } from "./parts";
import { fontEpoch, measureText } from "./measure";
import { Marquee } from "./Marquee";
import { Ring } from "./parts/Rings";

const ICON = 17, GAP = 6, QUOTA_RING = 14, NAME_MAX = 76, REC_DOT = 8, REC_BUTTON = 20, THUMB_W = 28;
/** The widest content any closed surface allows (the notch's insets are the larger ones). */
const MAX = ROW.maxSurface - 2 * ROW.insetNotch;

/** The capture saved in the last SAVED.showMs (also one taken while the notch was open, for what is left of its time). */
function useSaved(): Saved | null {
  const last = saved.use();
  const [shown, setShown] = useState<Saved | null>(null);
  useEffect(() => {
    const left = last ? SAVED.showMs - (Date.now() - last.at) : 0;
    if (!last || left <= 0) return setShown(null);
    setShown(last);
    const id = window.setTimeout(() => setShown(null), left);
    return () => window.clearTimeout(id);
  }, [last]);
  return shown;
}

function NoticeButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      className="pointer-events-auto flex shrink-0 items-center justify-center rounded-full text-label-2 hover:text-label"
      style={{ width: REC_BUTTON, height: REC_BUTTON }}
      // Only acts: the click must not also open the notch.
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

/** The last quota level rise, for QUOTA.showMs. The tracker seeds on the first answer seen, so mounting at 95% does not alert. */
function useQuotaRise(): QuotaRise | null {
  const { providers, updatedAt } = usage.use();
  const tracker = useRef(newQuotaTracker());
  const [rise, setRise] = useState<QuotaRise | null>(null);
  useEffect(() => {
    if (updatedAt === null) return;
    const r = detectRise(tracker.current, providers);
    if (r) setRise(r);
  }, [providers, updatedAt]);
  // A new rise is a new object, so it starts its own 5 s.
  useEffect(() => {
    if (!rise) return;
    const id = window.setTimeout(() => setRise(null), QUOTA.showMs);
    return () => window.clearTimeout(id);
  }, [rise]);
  return rise;
}

/** "title · artist" for TRACK.showMs when a changed track starts playing within TRACK.armMs, only while `on` (the title part is off). */
function useTrackCaption(on: boolean): string | null {
  const np = useNowPlaying();
  const key = np ? `${np.title}\n${np.artist}` : "";
  const playing = !!np?.isPlaying;
  const gate = useRef<TrackGate>({ until: null }), lastKey = useRef(key);
  const [shown, setShown] = useState<{ text: string } | null>(null);
  useEffect(() => {
    const now = performance.now();
    if (key !== lastKey.current) {
      lastKey.current = key;
      armTrack(gate.current, now, on && !!np);
    }
    if (np && observeTrack(gate.current, playing, now)) setShown({ text: trackCaption(np.title ?? "", np.artist ?? "") });
    // np is read only when the key or playing changed; its position updates must not re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, playing, on]);
  useEffect(() => {
    if (!shown) return;
    const id = window.setTimeout(() => setShown(null), TRACK.showMs);
    return () => window.clearTimeout(id);
  }, [shown]);
  return on && shown ? shown.text : null;
}

/**
 * Covers the closed row with the most important notice: a running recording (time, pause and stop, until it ends),
 * a finished timer (until dismissed by a click), a screenshot or recording just saved, a quota that
 * crossed a level, or a new track while the title part is off. Reports its content width while one shows, null otherwise;
 * the shape takes that width. Mounted with the row, and on the idle line while a finished timer opens it into the notch.
 */
export function NoticeLayer({ onWidth }: { onWidth: (content: number | null) => void }) {
  fontEpoch.use();
  const closed = settings.use().closed;
  const finished = timer.use().finished;
  const ring = ringing.use();
  const rise = useQuotaRise();
  const track = useTrackCaption(!closed.parts.title);
  const rec = recording.use();
  const recRunning = rec.phase === "recording";
  useSecondTick(recRunning, rec.at);
  const shot = useSaved();
  const kind = topNotice({ recording: rec.phase !== "idle", timer: finished, saved: !!shot, quota: !!rise && closed.quotaAlerts, track: !!track });

  let width = 0, key = "", body: ReactNode = null;
  if (kind === "recording") {
    const label = formatElapsed(elapsedAt(rec, Date.now()));
    // Measured with zeros so the width only changes when a digit is added, not every second.
    width = REC_DOT + GAP + measureText(label.replace(/\d/g, "0")) + GAP + 2 * REC_BUTTON;
    key = "recording";
    body = (
      <span className="flex h-full items-center" style={{ gap: GAP }}>
        <motion.span
          className="shrink-0 rounded-full bg-red"
          style={{ width: REC_DOT, height: REC_DOT }}
          animate={{ opacity: recRunning ? [1, 0.35] : 0.45 }}
          transition={recRunning ? pulse : content.exit}
        />
        <span className="tabular grow whitespace-nowrap text-footnote font-medium text-label">{label}</span>
        <span className="flex">
          <NoticeButton label={recRunning ? t("Pause") : t("Fortsetzen")} onClick={() => pauseRecording(recRunning)}>
            {recRunning ? <Pause size={13} weight="fill" /> : <Play size={13} weight="fill" />}
          </NoticeButton>
          <NoticeButton label={t("Aufnahme beenden")} onClick={stopRecording}>
            <Stop size={13} weight="fill" />
          </NoticeButton>
        </span>
      </span>
    );
  } else if (kind === "saved" && shot) {
    const label = shot.kind === "shot" ? t("Bildschirmfoto gespeichert") : t("Aufnahme gespeichert");
    width = (shot.thumb ? THUMB_W : ICON) + GAP + measureText(label);
    key = `saved:${shot.at}`;
    body = (
      <button
        aria-label={t("Öffnen")}
        className="pointer-events-auto flex h-full items-center text-label"
        style={{ gap: GAP }}
        // Opens the file; the click must not also open the notch.
        onClick={(e) => {
          e.stopPropagation();
          void openFile(shot.path);
        }}
      >
        {shot.thumb ? (
          <img src={shot.thumb} alt="" draggable={false} className="h-[18px] rounded-[4px] object-cover" style={{ width: THUMB_W }} />
        ) : (
          <FilmStrip size={ICON} weight="fill" />
        )}
        <span className="whitespace-nowrap text-footnote font-medium">{label}</span>
      </button>
    );
  } else if (kind === "timer") {
    const label = t("Abgelaufen");
    width = ICON + GAP + measureText(label);
    key = "timer";
    body = (
      <button
        aria-label={t("Schließen")}
        className="pointer-events-auto flex h-full items-center"
        style={{ gap: GAP, color: "var(--color-green)" }}
        // Only dismisses: the click must not also open the notch.
        onClick={(e) => {
          e.stopPropagation();
          timerActions.dismiss();
        }}
      >
        {ring ? (
          <motion.span className="flex" animate={{ opacity: [1, 0.35] }} transition={pulse}>
            <AlarmIcon size={ICON} weight="fill" />
          </motion.span>
        ) : (
          <CheckCircle size={ICON} weight="fill" />
        )}
        <span className="whitespace-nowrap text-footnote font-medium">{label}</span>
      </button>
    );
  } else if (kind === "quota" && rise) {
    const used = Math.round(Math.min(100, Math.max(0, rise.used)));
    const name = brandName[rise.provider as UsageId] ?? rise.provider;
    const text = [t("{w} {p}% genutzt", { w: windowLabel(rise.kind), p: used }), rise.resetsAt !== null ? formatIn(rise.resetsAt - Date.now()) : ""].filter(Boolean).join(" · ");
    const nameW = Math.min(NAME_MAX, measureText(name)), textW = measureText(text), room = MAX - QUOTA_RING - nameW - 2 * GAP;
    width = QUOTA_RING + nameW + 2 * GAP + Math.min(textW, room);
    key = `quota:${rise.provider}:${rise.kind}:${used}`;
    body = (
      <span className="flex h-full items-center" style={{ gap: GAP }}>
        <Ring id={rise.provider as UsageId} value={used} size={QUOTA_RING} />
        <span className="truncate text-footnote font-medium text-label" style={{ width: nameW }}>{name}</span>
        <Marquee text={text} textWidth={textW} width={Math.min(textW, room)} paused={false} once />
      </span>
    );
  } else if (kind === "track" && track) {
    const textW = measureText(track);
    width = Math.min(textW, MAX);
    key = `track:${track}`;
    body = <Marquee text={track} textWidth={textW} width={width} paused={false} once />;
  }
  const dpi = window.devicePixelRatio || 1;
  // An even number of device pixels, as the row, so the centred notice starts on a whole one.
  width = Math.min(MAX, (Math.ceil((width * dpi) / 2 - 1e-9) * 2) / dpi);
  useLayoutEffect(() => onWidth(kind ? width : null), [kind, width, onWidth]);
  useEffect(() => () => onWidth(null), [onWidth]);

  return (
    <motion.div className="pointer-events-none absolute inset-0" exit={{ opacity: 0, filter: "blur(4px)", transition: content.exit }}>
      <AnimatePresence>
        {kind && (
          <motion.div
            key={key}
            className="absolute top-0 left-1/2 flex h-[30px] items-center justify-center"
            style={{ width, marginLeft: -width / 2 }}
            initial={{ opacity: 0, filter: "blur(4px)" }}
            animate={{ opacity: 1, filter: "blur(0px)", transition: content.enter }}
            exit={{ opacity: 0, filter: "blur(4px)", transition: content.exit }}
          >
            {body}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
