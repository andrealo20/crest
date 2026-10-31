// Translated from BrimDeck (Apache-2.0, github.com/MoFeng2223/BrimDeck), src/BrimDeck/MainWindow.CompactColumn.cs.
import { useLayoutEffect, type ReactNode } from "react";
import { motion } from "motion/react";
import { content } from "../../design/motion";
import { useNowPlaying } from "../../platform/media";
import { settings } from "../../settings/store";
import { LiveArtwork } from "../../features/now-playing/LiveActivity";
import { Equalizer, RELEASE_CAPTURE_MS } from "../../features/now-playing/Equalizer";
import { timer } from "../../features/timer/store";
import { useDiscordCall } from "../../features/discord/store";
import { useGamingLive } from "../../features/system/gaming";
import { usage } from "../../features/usage/store";
import { Dots, dotsWidth, usePrivacyDots } from "../../features/privacy/PrivacyDots";
import { COLUMN, COLUMN_ROOM, columnWidth, fitLines, ringLines, stack } from "../column";
import { useHeld } from "./CompactRow";
import { useRowVisible } from "./visibility";
import { fontEpoch } from "./measure";
import { RING, Ring, ringProviders, ringValue } from "./parts/Rings";
import { ReadingView, readingWidth, useReadings } from "./parts/Readings";
import { Clock, clockWidth } from "./parts/Clock";
import { TimerPart, timerWidth } from "./parts/TimerPart";
import { DISCORD_WIDTH, DiscordPart } from "./parts/DiscordPart";

interface Line { id: string; w: number; h: number; draw: () => ReactNode }

/**
 * The closed notch's content on a side edge: the row's parts one below the other, each centred on its own line, in the row's order with
 * the cover first and the privacy dots last. The song title is left out: a scrolling title does not fit across a column. Lines that do
 * not fit in the longest notch are dropped from the end. Reports its length and width; the shape is that plus its insets and pads.
 */
export function CompactColumn({ onSize }: { onSize: (size: { length: number; width: number }) => void }) {
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
  const h12 = s.units.clock === "12";

  const fixed: Line[] = [];
  const readingLines: Line[] = [];
  let ringsAt = -1;
  if (np) fixed.push({ id: "cover", w: 20, h: 20, draw: () => <LiveArtwork artwork={np.artwork} /> });
  for (const id of closed.order) {
    if (!closed.parts[id] && id !== "readings") continue;
    if (id === "timer" && running) fixed.push({ id, w: timerWidth(timer.get().duration), h: 20, draw: () => <TimerPart paused={false} /> });
    else if (id === "discord" && call) fixed.push({ id, w: DISCORD_WIDTH, h: 20, draw: () => <DiscordPart call={call} paused={false} /> });
    else if (id === "equalizer" && np && playing) fixed.push({ id, w: 16, h: 16, draw: () => <Equalizer playing={np.isPlaying} /> });
    else if (id === "clock") fixed.push({ id, w: clockWidth(closed.clockSeconds, h12), h: 16, draw: () => <Clock seconds={closed.clockSeconds} h12={h12} paused={false} /> });
    else if (id === "rings" && rings.length) ringsAt = fixed.length;
    else if (id === "readings" && readings.length) {
      // Readings stand where the part is in the order; marked by a placeholder replaced below.
      fixed.push({ id: "readings", w: 0, h: 0, draw: () => null });
      for (const r of readings) readingLines.push({ id: `reading-${r.id}`, w: readingWidth(r.id), h: 16, draw: () => <ReadingView reading={r} /> });
    }
  }
  if (dots.length) fixed.push({ id: "privacy", w: dotsWidth(dots.length), h: 8, draw: () => <Dots dots={dots} /> });

  const width = columnWidth([...fixed.map((l) => l.w), rings.length ? RING : 0], readingLines.map((l) => l.w));
  const { perLine, lines: ringRows } = ringLines(rings.length, RING, COLUMN.ringGap, width);
  const ringLinesList: Line[] = Array.from({ length: ringRows }, (_, row) => {
    const slice = rings.slice(row * perLine, (row + 1) * perLine);
    return {
      id: `rings-${row}`,
      w: slice.length * RING + (slice.length - 1) * COLUMN.ringGap,
      h: RING,
      draw: () => (
        <span className="flex items-center" style={{ gap: COLUMN.ringGap }}>
          {slice.map((r) => <Ring key={r.id} id={r.id} value={ringValue(r)} />)}
        </span>
      ),
    };
  });
  const all: Line[] = [];
  fixed.forEach((l, i) => {
    if (i === ringsAt) all.push(...ringLinesList);
    if (l.id === "readings") all.push(...readingLines);
    else all.push(l);
  });
  if (ringsAt === fixed.length) all.push(...ringLinesList);

  const shown = all.slice(0, fitLines(all.map((l) => l.h), COLUMN.gap, COLUMN_ROOM));
  const { tops, length } = stack(shown.map((l) => l.h), COLUMN.gap);
  useLayoutEffect(() => onSize({ length, width }), [length, width, onSize]);

  return (
    <motion.div
      className="absolute top-1/2 left-1/2"
      style={{ width, height: length, marginLeft: -width / 2, marginTop: -length / 2 }}
      initial={{ opacity: 0, filter: "blur(4px)" }}
      animate={{ opacity: 1, filter: "blur(0px)", transition: content.enter }}
      exit={{ opacity: 0, filter: "blur(4px)", transition: content.exit }}
    >
      {shown.map((l, i) => (
        <div key={l.id} className="absolute inset-x-0 flex items-center justify-center" style={{ top: tops[i], height: l.h }}>
          {l.draw()}
        </div>
      ))}
    </motion.div>
  );
}
