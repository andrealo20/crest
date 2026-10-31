import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform } from "motion/react";
import { content, fade, springs } from "../../design/motion";
import { useNowPlaying } from "../../platform/media";
import { settings } from "../../settings/store";
import { LiveArtwork } from "../../features/now-playing/LiveActivity";
import { Equalizer, RELEASE_CAPTURE_MS } from "../../features/now-playing/Equalizer";
import { timer } from "../../features/timer/store";
import { useDiscordCall } from "../../features/discord/store";
import { useGamingLive } from "../../features/system/gaming";
import { usage } from "../../features/usage/store";
import { Dots, dotsWidth, usePrivacyDots } from "../../features/privacy/PrivacyDots";
import { ROW, naturalWidth, planVisible, type PlacedPart, type RowItem } from "./layout";
import { trackCaption } from "./parts";
import { useRowVisible } from "./visibility";
import { fontEpoch, measureText } from "./measure";
import { Carousel } from "./Carousel";
import { Marquee } from "./Marquee";
import { RING, RING_GAP, Ring, ringProviders, ringValue } from "./parts/Rings";
import { READING_GAP, ReadingView, readingWidth, useReadings } from "./parts/Readings";
import { Clock, clockWidth } from "./parts/Clock";
import { TimerPart, timerWidth } from "./parts/TimerPart";
import { DISCORD_WIDTH, DiscordPart } from "./parts/DiscordPart";

/** True while `on`, and for `ms` after it turns off: GSMTC reports a short pause on seek and track change. */
export function useHeld(on: boolean, ms: number): boolean {
  const [held, setHeld] = useState(on);
  useEffect(() => {
    if (on) return setHeld(true);
    const id = window.setTimeout(() => setHeld(false), ms);
    return () => window.clearTimeout(id);
  }, [on, ms]);
  return on || held;
}

/**
 * The closed notch's content: the chosen parts side by side, centred, in the order from the settings, with the cover first
 * and the privacy dots last. Widths are fixed or measured, never read back from layout, so changing digits never move a
 * neighbour. Reports its content width; the shape is that plus its insets. Mounted only while the row is on screen
 * (closed or peeking, not the line, not focus, not hidden for fullscreen), so its audio, timers and polling stop with it.
 */
export function CompactRow({ style, covered, onWidth }: { style: "notch" | "capsule"; covered: boolean; onWidth: (content: number) => void }) {
  useRowVisible();
  fontEpoch.use();
  const s = settings.use(), closed = s.closed;
  const np = useNowPlaying();
  const playing = useHeld(!!np?.isPlaying, RELEASE_CAPTURE_MS);
  const running = timer.use().endsAt !== null;
  const call = useDiscordCall();
  const rings = ringProviders(usage.use().providers);
  const readings = useReadings(closed, useGamingLive());
  const dots = usePrivacyDots();
  const [hovered, setHovered] = useState(false);
  // The title stays while paused, like the cover; it only scrolls while playing.
  const caption = np ? trackCaption(np.title ?? "", np.artist ?? "") : "";

  const parts: { item: RowItem; draw: (p: PlacedPart) => ReactNode }[] = [];
  const fixed = (id: string, width: number, draw: () => ReactNode) => parts.push({ item: { id, kind: "fixed", width }, draw });
  if (np) fixed("cover", 20, () => <LiveArtwork artwork={np.artwork} />);
  for (const id of closed.order) {
    if (!closed.parts[id] && id !== "readings") continue;
    if (id === "timer" && running) fixed(id, timerWidth(timer.get().duration), () => <TimerPart paused={covered} />);
    else if (id === "discord" && call) fixed(id, DISCORD_WIDTH, () => <DiscordPart call={call} paused={covered} />);
    else if (id === "equalizer" && np && playing) fixed(id, 16, () => <Equalizer playing={np.isPlaying && !covered} />);
    else if (id === "clock") fixed(id, clockWidth(closed.clockSeconds, s.units.clock === "12"), () => <Clock seconds={closed.clockSeconds} h12={s.units.clock === "12"} paused={covered} />);
    else if (id === "title" && caption) {
      const text = measureText(caption);
      parts.push({ item: { id, kind: "title", text }, draw: (p) => <Marquee key={caption} text={caption} textWidth={text} width={p.width} paused={hovered || covered || !np?.isPlaying} /> });
    } else if (id === "rings" && rings.length) {
      parts.push({
        item: { id, kind: "carousel", items: rings.map(() => RING), gap: RING_GAP },
        draw: (p) => <Carousel items={rings.map((r) => <Ring key={r.id} id={r.id} value={ringValue(r)} />)} gap={RING_GAP} window={p.window!} width={p.width} paused={hovered || covered} />,
      });
    } else if (id === "readings" && readings.length) {
      // useReadings already leaves the part out when it is off and gaming is not forcing it on.
      parts.push({
        item: { id, kind: "carousel", items: readings.map((r) => readingWidth(r.id)), gap: READING_GAP },
        draw: (p) => <Carousel items={readings.map((r) => <ReadingView key={r.id} reading={r} />)} gap={READING_GAP} window={p.window!} width={p.width} paused={hovered || covered} />,
      });
    }
  }
  if (dots.length) fixed("privacy", dotsWidth(dots.length), () => <Dots dots={dots} />);

  const items = parts.map((p) => p.item);
  const dpi = window.devicePixelRatio || 1;
  // An even number of device pixels, so the centred row starts on a whole one.
  const width = Math.min(ROW.maxSurface - 2 * (style === "notch" ? ROW.insetNotch : ROW.insetCapsule), (Math.ceil((naturalWidth(items) * dpi) / 2 - 1e-9) * 2) / dpi);
  const plan = planVisible(items, width, dpi);
  useLayoutEffect(() => onWidth(width), [width, onWidth]);

  // Choosing other parts fades the whole row over; parts coming and going while it stays the same grow and shrink.
  const chosen = `${closed.order.filter((id) => closed.parts[id]).join()}|${Object.values(closed.readings).join()}|${closed.clockSeconds}`;
  return (
    <motion.div
      className="absolute top-0 left-1/2 h-[30px]"
      style={{ width, marginLeft: -width / 2 }}
      initial={{ opacity: 0, filter: "blur(4px)" }}
      // Under a notice the row only fades out: it stays mounted, so its polling goes on, but its cycles, clock and equalizers rest.
      animate={covered ? { opacity: 0, filter: "blur(4px)", transition: content.exit } : { opacity: 1, filter: "blur(0px)", transition: content.enter }}
      exit={{ opacity: 0, filter: "blur(4px)", transition: content.exit }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <AnimatePresence initial={false}>
        {/* Parts sit at offsets from the centre, which stays put while the row's width changes. */}
        <motion.div key={chosen} className="absolute inset-y-0 left-1/2 w-0" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: fade }} exit={{ opacity: 0, transition: fade }}>
          <AnimatePresence initial={false}>
            {plan.parts.map((p) => (
              <Slot key={p.id} x={p.left - width / 2} width={p.width}>
                {parts.find((x) => x.item.id === p.id)!.draw(p)}
              </Slot>
            ))}
          </AnimatePresence>
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

/** A part's room. It grows in from 0.82 with the opacity going as the square of its progress, and shrinks out the same way. */
function Slot({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const scale = useMotionValue(1);
  const opacity = useTransform(scale, (v) => Math.max(0, (v - 0.82) / 0.18) ** 2);
  return (
    <motion.div
      className="absolute inset-y-0 flex items-center justify-center"
      style={{ scale, opacity }}
      initial={{ scale: 0.82, x, width }}
      animate={{ scale: 1, x, width }}
      exit={{ scale: 0.82 }}
      transition={{ ...springs.morph, scale: springs.snappy }}
    >
      {children}
    </motion.div>
  );
}
