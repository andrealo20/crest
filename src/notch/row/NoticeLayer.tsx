import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlarmIcon, BatteryHigh, BatteryLow, BatteryWarning, CheckCircle, Headphones, Plug, WifiHigh, WifiSlash, type Icon } from "@phosphor-icons/react";
import { content, pulse } from "../../design/motion";
import { useNowPlaying } from "../../platform/media";
import type { UsageId } from "../../platform/services";
import { settings } from "../../settings/store";
import { ringing, timer, timerActions } from "../../features/timer/store";
import { usage } from "../../features/usage/store";
import { statusAlert } from "../../features/status/store";
import { windowLabel } from "../../features/usage/UsageView";
import { dueTasks } from "../../features/todos/store";
import { reminderNotice } from "../../features/todos/ReminderNotice";
import { waterDue } from "../../features/water/store";
import { waterNotice } from "../../features/water/WaterNotice";
import { brandName } from "../../ui/brands";
import { formatIn } from "../../lib/format";
import { t } from "../../i18n";
import { QUOTA, TRACK, armTrack, detectRise, newQuotaTracker, observeTrack, topNotice, type QuotaRise, type TrackGate } from "./notices";
import type { StatusAlert } from "./status";
import { ROW } from "./layout";
import { trackCaption } from "./parts";
import { fontEpoch, measureText } from "./measure";
import { Marquee } from "./Marquee";
import { useNoticeHover } from "./NoticeButton";
import { Ring } from "./parts/Rings";
import { popping } from "../../features/notices/store";
import { noticePop } from "../../features/notices/NoticePop";

const ICON = 17, GAP = 6, QUOTA_RING = 14, NAME_MAX = 76;
/** The widest content any closed surface allows (the notch's insets are the larger ones). */
const MAX = ROW.maxSurface - 2 * ROW.insetNotch;
const STATUS_ICON: Record<StatusAlert["icon"], Icon> = { plug: Plug, battery: BatteryHigh, wifi: WifiHigh, "wifi-off": WifiSlash, headphones: Headphones };
const TONE = { normal: "var(--color-label)", warning: "var(--color-orange)", critical: "var(--color-red)" } as const;

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
 * Covers the closed row with the most important notice: a finished timer (until dismissed by a click), a status alert
 * (charger, network, headphones), a live notice from Windows or crest-notify (features/notices), a quota that crossed a level,
 * a new track while the title part is off, a due to-do or the water reminder.
 * Reports its content width while one shows, null otherwise; the shape takes that width. Mounted with the row, and on the idle line
 * or in focus mode while a finished timer, a status alert or a due to-do opens it into the notch (`urgentOnly`).
 */
export function NoticeLayer({ onWidth, urgentOnly }: { onWidth: (content: number | null) => void; urgentOnly: boolean }) {
  fontEpoch.use();
  const timerHover = useNoticeHover();
  const { closed, productivity } = settings.use();
  const finished = timer.use().finished;
  const ring = ringing.use();
  const rise = useQuotaRise();
  const track = useTrackCaption(!closed.parts.title);
  const status = statusAlert.use();
  const pop = popping.use();
  const due = dueTasks.use();
  const drink = waterDue.use();
  // On the idle line and in focus mode only what cannot wait: the finished timer, a status alert (its store already skips focus mode) and a due reminder.
  const kind = topNotice({
    timer: finished,
    status: !!status,
    notice: !urgentOnly && !!pop,
    quota: !urgentOnly && !!rise && closed.quotaAlerts,
    track: !urgentOnly && !!track,
    reminder: due.length > 0,
    water: !urgentOnly && drink,
  });

  let width = 0, key = "", body: ReactNode = null;
  if (kind === "timer") {
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
    const textW = Math.min(measureText(status.text), MAX - ICON - GAP);
    width = ICON + GAP + textW;
    // One key per kind: a newer alert of the same kind swaps its text in place instead of cross-fading.
    key = `status:${status.kind}`;
    body = (
      <span className="flex h-full items-center" style={{ gap: GAP, color: TONE[status.tone] }}>
        <I size={ICON} weight="fill" className="shrink-0" />
        <span className="truncate text-footnote font-medium" style={{ width: textW }}>{status.text}</span>
      </span>
    );
  } else if (kind === "notice" && pop) {
    ({ width, key, body } = noticePop(pop, MAX));
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
  } else if (kind === "reminder") ({ width, key, body } = reminderNotice(due));
  else if (kind === "water") ({ width, key, body } = waterNotice(productivity.water.goalMl));
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
