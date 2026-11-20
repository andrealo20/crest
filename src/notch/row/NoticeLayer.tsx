import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlarmIcon, BatteryLow, BatteryWarning, CheckCircle, FilmStrip, Pause, Play, Stop, Waveform, ArrowSquareOut, ImageSquare } from "@phosphor-icons/react";
import { STATUS_ICON } from "./statusIcons";
import { pauseRecording, recording, saved, stopRecording, type Saved } from "../../features/capture/store";
import { elapsedAt, formatElapsed } from "../../features/capture/clock";
import { openFile } from "../../platform/services";
import { openOn } from "../nav";
import { card as cardIn, content, fade, pulse, springs } from "../../design/motion";
import { hueVar } from "../../features/themes/hues";
import { useNowPlaying } from "../../platform/media";
import type { UsageId } from "../../platform/services";
import { settings } from "../../settings/store";
import { ringing, timer, timerActions, useSecondTick } from "../../features/timer/store";
import { usage } from "../../features/usage/store";
import { statusAlert } from "../../features/status/store";
import { windowLabel } from "../../features/usage/UsageView";
import { dueTasks } from "../../features/todos/store";
import { reminderNotice } from "../../features/todos/ReminderNotice";
import { waterDue } from "../../features/water/store";
import { waterNotice } from "../../features/water/WaterNotice";
import { breakShown } from "../../features/breaks/store";
import { breaksNotice } from "../../features/breaks/BreakNotice";
import { calendarDue } from "../../features/calendar/store";
import { calendarNotice } from "../../features/calendar/CalendarNotice";
import { useWhatsNew } from "../../features/whatsnew/store";
import { whatsNewNotice } from "../../features/whatsnew/WhatsNewNotice";
import { brandName } from "../../ui/brands";
import { formatIn } from "../../lib/format";
import { t } from "../../i18n";
import { QUOTA, SAVED, TRACK, armTrack, detectRise, newQuotaTracker, observeTrack, topNotice, type QuotaRise, type TrackGate } from "./notices";
import { trackCaption } from "./parts";
import { fontEpoch, measureTabular, measureText } from "./measure";
import { Marquee } from "./Marquee";
import { NOTICE_BUTTON as REC_BUTTON, NoticeButton, useNoticeHover } from "./NoticeButton";
import { Ring } from "./parts/Rings";
import { asks, popping } from "../../features/notices/store";
import { askNotice } from "../../features/notices/AskNotice";
import { noticePop } from "../../features/notices/NoticePop";
import { presentingNow, usePresenting } from "../../features/privacy/store";
import { detectReset, newResetTracker, resetAlertAllowed } from "../../features/usage/reset";
import { finishedDownload } from "../../features/downloads/store";
import { downloadNotice } from "../../features/downloads/DownloadNotice";
import { noticeCard } from "./NoticeCard";

const ICON = 17, GAP = 6, QUOTA_RING = 14, NAME_MAX = 76, REC_DOT = 8, THUMB_W = 56, THUMB_H = 32, LEVEL_BAR = 56, ROW_H = 30;
const TONE = { normal: "var(--color-label)", warning: "var(--color-orange)", critical: "var(--color-red)" } as const;
/** A status icon that changes in place (louder, muted, Caps Lock off) leaves and comes in with a little scale and blur. */
const ICON_SWAP = {
  from: { opacity: 0, transform: "scale(0.6)", filter: "blur(2px)" },
  to: { opacity: 1, transform: "scale(1)", filter: "blur(0px)" },
  // The presets themselves, not a copy made at import, so a change of Style reaches them (motion.ts setMotionDesign).
  transition: { default: springs.snappy, opacity: fade, filter: fade },
};

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

/**
 * The last quota level rise, or a limit that reset (when the setting is on, outside quiet hours and presentation mode), for QUOTA.showMs.
 * The trackers seed on the first answer seen, so mounting at 95% does not alert.
 */
function useQuotaRise(): QuotaRise | null {
  const { providers, updatedAt } = usage.use();
  const tracker = useRef(newQuotaTracker()), resets = useRef(newResetTracker());
  const [rise, setRise] = useState<QuotaRise | null>(null);
  useEffect(() => {
    if (updatedAt === null) return;
    // Both always run, so each record stays current; a rise outranks a reset.
    const r = detectRise(tracker.current, providers), z = detectReset(resets.current, providers, Date.now());
    const s = settings.get();
    const next = r ?? (z && resetAlertAllowed(s.aiUsage.notifyReset, presentingNow(), s.notices.quiet, new Date()) ? z : null);
    if (next) setRise(next);
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
 * a finished timer (until dismissed by a click), a screenshot or recording just saved, a status alert
 * (charger, network, headphones, the volume and brightness HUD), a live notice from Windows or crest-notify (features/notices), a quota that crossed a level,
 * a new track while the title part is off, an event about to start, a due to-do, the water reminder or a new version.
 * Reports its content size while one shows, null otherwise; the shape takes that width, and a card's height. Mounted with the row, and on the idle line
 * while a finished timer, a recording, a status alert, an app's notice or a due to-do opens it into the notch, and in dimmed focus mode while one
 * of those waits (`urgentOnly`: the others wait).
 * Drawn `scale` times its designed size like the row; `max` is the widest it gets at that size.
 */
export function NoticeLayer({ max, scale, onSize, urgentOnly, mono = false }: { max: number; scale: number; onSize: (content: { width: number; height: number; exact: boolean } | null) => void; urgentOnly: boolean; mono?: boolean }) {
  fontEpoch.use();
  const timerHover = useNoticeHover();
  const { closed, productivity } = settings.use();
  const finished = timer.use().finished;
  const ring = ringing.use();
  const rise = useQuotaRise();
  const track = useTrackCaption(!closed.parts.title);
  const status = statusAlert.use();
  const pop = popping.use();
  const ask = asks.use()[0];
  const due = dueTasks.use();
  const drink = waterDue.use();
  const brk = breakShown.use();
  const meeting = calendarDue.use();
  const news = useWhatsNew();
  const rec = recording.use();
  const recRunning = rec.phase === "recording";
  useSecondTick(recRunning, rec.at);
  const shot = useSaved();
  const download = finishedDownload.use();
  // The thumbnail can show anything that was on screen, and a file name can be private: not while presenting.
  const presenting = usePresenting();
  // On the idle line and in focus mode only what cannot wait: a recording, the finished timer, a status alert (its store skips focus mode), an app's notice and a due reminder.
  const kind = topNotice({
    recording: rec.phase !== "idle",
    timer: finished,
    // A question shows on the idle line too: a coding agent waits on it.
    ask: !!ask,
    saved: !urgentOnly && !!shot && !presenting,
    download: !urgentOnly && !!download && !presenting,
    status: !!status,
    notice: !!pop,
    quota: !urgentOnly && !!rise && (closed.quotaAlerts || !!rise.reset),
    track: !urgentOnly && !!track,
    calendar: !urgentOnly && !!meeting,
    reminder: due.length > 0,
    breaks: !urgentOnly && !!brk,
    water: !urgentOnly && drink,
    whatsnew: !urgentOnly && !!news,
  });

  // Notices on one line keep the row's 30; a card (NoticeCard.tsx) is taller and the notch grows to it.
  let width = 0, height = ROW_H, key = "", body: ReactNode = null;
  if (kind === "recording") {
    const label = formatElapsed(elapsedAt(rec, Date.now()));
    // Measured with zeros so the width only changes when a digit is added, not every second.
    width = REC_DOT + GAP + measureTabular(label.replace(/\d/g, "0")) + GAP + 2 * REC_BUTTON + 4;
    key = "recording";
    // A click or hover on the notice opens the tool that records (data-open, as the row's parts), its buttons excepted.
    body = (
      <span className="pointer-events-auto flex h-full items-center" style={{ gap: GAP }} data-open={rec.audio ? "recorder" : "capture"}>
        <motion.span
          className="shrink-0 rounded-full bg-red"
          style={{ width: REC_DOT, height: REC_DOT }}
          animate={{ opacity: recRunning ? [1, 0.35] : 0.45 }}
          transition={recRunning ? pulse : content.exit}
        />
        <span className="tabular grow whitespace-nowrap text-footnote font-medium text-label">{label}</span>
        <span className="flex" style={{ gap: 4 }}>
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
    const label = shot.cut ? t("Aufnahme vorzeitig beendet") : shot.kind === "shot" ? t("Bildschirmfoto gespeichert") : shot.kind === "audio" ? t("Tonaufnahme gespeichert") : t("Aufnahme gespeichert");
    const Icon = shot.kind === "audio" ? Waveform : shot.kind === "shot" ? ImageSquare : FilmStrip;
    ({ width, height, key, body } = noticeCard(
      {
        key: `saved:${shot.at}`,
        image: shot.thumb ? <img src={shot.thumb} alt="" draggable={false} className="shrink-0 rounded-[6px] object-cover" style={{ width: THUMB_W, height: THUMB_H }} /> : undefined,
        imageWidth: shot.thumb ? THUMB_W : undefined,
        icon: <Icon size={16} weight="fill" />,
        hue: shot.cut ? "orange" : "cyan",
        title: label,
        text: shot.path.split(/[\\/]/).pop(),
        // The card opens the tool that took it, its button the file itself.
        onOpen: () => openOn(shot.kind === "audio" ? "recorder" : "capture"),
        actionsWidth: REC_BUTTON,
        actions: (
          <NoticeButton label={t("Öffnen")} onClick={() => void openFile(shot.path)}>
            <ArrowSquareOut size={12} weight="bold" />
          </NoticeButton>
        ),
      },
      max,
    ));
  } else if (kind === "download" && download) {
    ({ width, height, key, body } = downloadNotice(download, max));
  } else if (kind === "timer") {
    const label = t("Abgelaufen");
    width = ICON + GAP + measureText(label);
    key = "timer";
    body = (
      <button
        aria-label={t("Schließen")}
        className="pointer-events-auto flex h-full items-center"
        style={{ gap: GAP, color: "var(--color-green)" }}
        // Only dismisses: neither the click nor hovering it may open the notch.
        onPointerEnter={timerHover.onPointerEnter}
        onPointerLeave={timerHover.onPointerLeave}
        onClick={(e) => {
          e.stopPropagation();
          timerHover.used();
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
  } else if (kind === "status" && status) {
    const I = status.icon === "battery" && status.tone !== "normal" ? (status.tone === "critical" ? BatteryWarning : BatteryLow) : STATUS_ICON[status.icon];
    // The volume and brightness HUD adds a level bar; its text keeps the width of "100 %", so the notch holds still while the level moves.
    const bar = status.level === undefined ? 0 : LEVEL_BAR + GAP;
    // Its digits are tabular, each as wide as an 8, which the canvas does not know.
    const tab = (text: string) => (bar ? measureTabular(text.replace(/\d/g, "8")) : measureText(text));
    const textW = Math.min(Math.max(tab(status.text), bar && tab(t("{p} %", { p: 100 }))), max - ICON - GAP - bar);
    width = ICON + GAP + bar + textW;
    // One key per kind: a newer alert of the same kind swaps its text in place instead of cross-fading.
    key = `status:${status.kind}`;
    // Only the icon in the alert's hue (volume blue, brightness yellow, Caps Lock on red); the bar and the text in its tone. Over clear glass (`mono`)
    // no hue keeps its contrast over every backdrop, so the icon takes the text's ink, as the tool bar's icons do.
    const ink = status.accent && !mono ? hueVar(status.accent) : TONE[status.tone];
    body = (
      <span className="flex h-full items-center" style={{ gap: GAP, color: TONE[status.tone] }}>
        <span className="relative shrink-0" style={{ width: ICON, height: ICON, color: ink }}>
          <AnimatePresence initial={false}>
            <motion.span key={`${status.icon}:${status.tone}`} className="absolute inset-0 flex" initial={ICON_SWAP.from} animate={ICON_SWAP.to} exit={ICON_SWAP.from} transition={ICON_SWAP.transition}>
              <I size={ICON} weight="fill" />
            </motion.span>
          </AnimatePresence>
        </span>
        {status.level !== undefined && (
          <span className="h-1 shrink-0 overflow-hidden rounded-full bg-fill-3" style={{ width: LEVEL_BAR }}>
            <motion.span
              className="block h-full origin-left rounded-full rtl:origin-right"
              // A held key moves it on a spring, from where it stands: no jump back to the start.
              initial={false}
              animate={{ scaleX: status.level / 100 }}
              transition={springs.snappy}
              // Muted keeps the level, greyed, as Windows shows it.
              style={{ background: status.icon === "speaker-x" ? "var(--color-label-3)" : "currentColor" }}
            />
          </span>
        )}
        <span dir="auto" className={`truncate text-footnote font-medium ${bar ? "tabular" : ""}`} style={{ width: textW }}>{status.text}</span>
      </span>
    );
  } else if (kind === "ask" && ask) {
    ({ width, height, key, body } = askNotice(ask, max));
  } else if (kind === "notice" && pop) {
    ({ width, height, key, body } = noticePop(pop, max));
  } else if (kind === "quota" && rise) {
    const used = Math.round(Math.min(100, Math.max(0, rise.used)));
    const name = brandName[rise.provider as UsageId] ?? rise.provider;
    const w = windowLabel(rise.kind);
    const text = rise.reset ? t("{w} zurückgesetzt", { w }) : [t("{w} {p}% genutzt", { w, p: used }), rise.resetsAt !== null ? formatIn(rise.resetsAt - Date.now()) : ""].filter(Boolean).join(" · ");
    const nameW = Math.min(NAME_MAX, measureText(name)), textW = measureText(text), room = max - QUOTA_RING - nameW - 2 * GAP;
    width = QUOTA_RING + nameW + 2 * GAP + Math.min(textW, room);
    key = `quota:${rise.provider}:${rise.kind}:${used}`;
    body = (
      <span className="pointer-events-auto flex h-full items-center" style={{ gap: GAP }} data-open="usage">
        <Ring id={rise.provider as UsageId} value={used} size={QUOTA_RING} />
        <span className="truncate text-footnote font-medium text-label" style={{ width: nameW }}>{name}</span>
        <Marquee text={text} textWidth={textW} width={Math.min(textW, room)} paused={false} once />
      </span>
    );
  } else if (kind === "track" && track) {
    const textW = measureText(track);
    width = Math.min(textW, max);
    key = `track:${track}`;
    body = (
      <span className="pointer-events-auto flex h-full items-center" data-open="media">
        <Marquee text={track} textWidth={textW} width={width} paused={false} once />
      </span>
    );
  } else if (kind === "calendar" && meeting) ({ width, height, key, body } = calendarNotice(meeting, max));
  else if (kind === "reminder") ({ width, height, key, body } = reminderNotice(due, max));
  else if (kind === "breaks" && brk) ({ width, height, key, body } = breaksNotice(brk, max));
  else if (kind === "water") ({ width, height, key, body } = waterNotice(productivity.water.goalMl, max));
  else if (kind === "whatsnew" && news) ({ width, height, key, body } = whatsNewNotice(news, max));
  const card = height > ROW_H;
  // A status alert keeps its own size whatever the notch's: drawn at its designed scale (`k` undoes the content scale it sits in),
  // and the shape is just wide and tall enough for it (Notch.tsx, `exact`).
  const exact = kind === "status";
  const k = exact ? 1 / scale : 1;
  const dpi = (window.devicePixelRatio || 1) * (exact ? 1 : scale);
  // An even number of device pixels, as the row, so the centred notice starts on a whole one.
  width = Math.min(max, (Math.ceil((width * dpi) / 2 - 1e-9) * 2) / dpi);
  useLayoutEffect(() => onSize(kind ? { width, height, exact } : null), [kind, width, height, exact, onSize]);
  useEffect(() => () => onSize(null), [onSize]);

  return (
    <motion.div className="pointer-events-none absolute inset-0" exit={{ opacity: 0, transition: content.exit }}>
      <AnimatePresence>
        {kind && (
          <motion.div
            key={key}
            className="absolute top-0 left-1/2 flex items-center justify-center"
            style={{ width, height, marginLeft: -width / 2, ...(exact && { transformOrigin: "50% 0" }) }}
            // A card waits for the notch to grow, then comes in from a little smaller with a soft overshoot; a status alert settles
            // in from a touch smaller and softer while the shape springs to its size.
            initial={card ? { opacity: 0, transform: "scale(0.94)" } : exact ? { opacity: 0, transform: `scale(${0.96 * k})`, filter: "blur(2px)" } : { opacity: 0 }}
            animate={card ? { opacity: 1, transform: "scale(1)", transition: cardIn } : exact ? { opacity: 1, transform: `scale(${k})`, filter: "blur(0px)", transition: content.enter } : { opacity: 1, transition: content.enter }}
            exit={{ opacity: 0, transition: content.exit }}
          >
            {body}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
