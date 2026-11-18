import { useId, useRef, useSyncExternalStore, type MouseEventHandler, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { fade } from "../../../design/motion";
import { ROW } from "../../../notch/row/layout";
import { Marquee } from "../../../notch/row/Marquee";
import { fontEpoch, measureText } from "../../../notch/row/measure";
import { partInfo } from "../../../notch/row/partInfo";
import type { PartId } from "../../../notch/row/parts";
import { DISCORD_WIDTH, DiscordPart } from "../../../notch/row/parts/DiscordPart";
import { DownloadsPart, downloadsCaption, downloadsWidth } from "../../../notch/row/parts/DownloadsPart";
import { GithubPart, githubWidth } from "../../../notch/row/parts/GithubPart";
import { LeetcodePart, leetcodeWidth } from "../../../notch/row/parts/LeetcodePart";
import { NextEventPart, nextEventWidth } from "../../../notch/row/parts/NextEventPart";
import { READING_GAP, ReadingView, readingWidth } from "../../../notch/row/parts/Readings";
import { RING, RING_GAP, Ring } from "../../../notch/row/parts/Rings";
import { ScriptParts, scriptPartsWidth } from "../../../notch/row/parts/ScriptPart";
import { TimerPart, timerWidth } from "../../../notch/row/parts/TimerPart";
import { WeatherPart, weatherWidth } from "../../../notch/row/parts/WeatherPart";
import { settings } from "../../../settings/store";
import { Equalizer } from "../../now-playing/Equalizer";
import { LiveLyric } from "../../now-playing/LiveLyric";
import { timer } from "../../timer/store";
import { EMPTY_FEED, barFeed, type BarFeed } from "../barStores";
import type { TaskbarSettings } from "../model";
import { widgetScale } from "../widgets";
import { BarClock, barClockWidth } from "./BarClock";
import { Item, type ItemProps } from "./Item";

/** What a widget's body is drawn from: its slices of the feed, whether the bar rests or the pointer is on it, and the settings it follows. */
interface WidgetContext {
  feed: BarFeed;
  paused: boolean;
  hovered: boolean;
  clock: TaskbarSettings["clock"];
  h12: boolean;
  titleLoop: boolean;
  timerRunning: boolean;
  timerDuration: number;
}

interface Body {
  node: ReactNode;
  width: number;
}

/** Side by side, as the closed row's carousel shows them when they all fit. */
const inRow = (gap: number, widths: number[], nodes: ReactNode[]): Body => ({
  node: <span className="flex items-center" style={{ gap }}>{nodes}</span>,
  width: widths.reduce((sum, w, i) => sum + (i ? gap : 0) + w, 0),
});

/** The part as the closed row draws it, and its width there; null while it has nothing to show. */
function part(id: PartId, { feed: f, paused, hovered, clock, h12, titleLoop, timerRunning, timerDuration }: WidgetContext): Body | null {
  switch (id) {
    case "clock":
      return { node: <BarClock seconds={clock.seconds} h12={h12} date={clock.date} paused={paused} />, width: barClockWidth(clock.seconds, h12, clock.date) };
    case "equalizer":
      return { node: <Equalizer playing={f.playing && !paused} />, width: 16 };
    case "weather":
      return f.weather && { node: <WeatherPart now={f.weather} />, width: weatherWidth() };
    case "title": {
      if (!f.title) return null;
      // Always titleMax, as the notch counts it (layout.ts naturalWidth): a new line or song never moves the buttons beside it.
      const { text, lyric } = f.title, textWidth = measureText(text), width = ROW.titleMax;
      return {
        node: lyric ? (
          <LiveLyric text={text} textWidth={textWidth} width={width} paused={hovered || paused} />
        ) : (
          // A shorter caption sits centred in the room, as LiveLyric centres a shorter line: widgetBody's cell centres it.
          <Marquee key={text} text={text} textWidth={textWidth} width={Math.min(textWidth, width)} paused={hovered || paused || !f.playing} endless={titleLoop} />
        ),
        width,
      };
    }
    case "rings":
      return f.rings.length ? inRow(RING_GAP, f.rings.map(() => RING), f.rings.map((r) => <Ring key={r.id} id={r.id} value={r.value} label={r.label} />)) : null;
    case "readings":
      return f.readings.length ? inRow(READING_GAP, f.readings.map((r) => readingWidth(r.id)), f.readings.map((r) => <ReadingView key={r.id} reading={r} />)) : null;
    case "timer":
      return timerRunning ? { node: <TimerPart paused={paused} />, width: timerWidth(timerDuration) } : null;
    case "calendar":
      return f.next && { node: <NextEventPart text={f.next.text} color={f.next.color} />, width: nextEventWidth(f.next.text) };
    case "downloads": {
      if (!f.downloads.length) return null;
      const caption = downloadsCaption(f.downloads);
      return { node: <DownloadsPart list={f.downloads} caption={caption} />, width: downloadsWidth(caption) };
    }
    case "discord":
      return f.call && { node: <DiscordPart call={f.call} paused={paused} />, width: DISCORD_WIDTH };
    case "github":
      return f.github && { node: <GithubPart count={f.github.count} level={f.github.level} />, width: githubWidth(f.github.count) };
    case "leetcode":
      return f.leetcode && { node: <LeetcodePart count={f.leetcode.count} level={f.leetcode.level} />, width: leetcodeWidth(f.leetcode.count) };
    case "script": {
      // No button inside the widget's own: a click anywhere on the widget opens the tool.
      const parts = f.script.map((p) => ({ ...p, open: null }));
      return parts.length ? { node: <ScriptParts parts={parts} />, width: scriptPartsWidth(parts) } : null;
    }
  }
}

/**
 * A widget's body at scale 1: its part, or while it has nothing to show the part's icon, dimmed. Keyed by which of the two it is,
 * so under an AnimatePresence the swap fades one over the other, and the width changes at once.
 */
export function widgetBody(id: PartId, ctx: WidgetContext): Body {
  const body = part(id, ctx), I = partInfo[id].icon;
  return {
    node: (
      <motion.span
        key={body ? "part" : "icon"}
        className="col-start-1 row-start-1 flex min-w-0 items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: fade }}
        exit={{ opacity: 0, transition: fade }}
      >
        {body ? body.node : <I size={16} weight="bold" className="text-label-3" />}
      </motion.span>
    ),
    width: body ? body.width : 16,
  };
}

/** The slices of the feed each widget draws. */
const SLICES: Record<PartId, (keyof BarFeed)[]> = {
  clock: [],
  timer: [],
  equalizer: ["playing"],
  title: ["title", "playing"],
  weather: ["weather"],
  rings: ["rings"],
  readings: ["readings"],
  calendar: ["next"],
  downloads: ["downloads"],
  discord: ["call"],
  github: ["github"],
  leetcode: ["leetcode"],
  script: ["script"],
};

/**
 * The feed with only `keys` filled in, the same object while their JSON stays the same: the bridge replaces the whole feed with
 * each message, and the readings that change every few seconds must not re-render every widget.
 */
function useSlices(keys: (keyof BarFeed)[]): BarFeed {
  const last = useRef<{ json: string; feed: BarFeed }>(null);
  return useSyncExternalStore(barFeed.subscribe, () => {
    const now = barFeed.get(), own = Object.fromEntries(keys.map((k) => [k, now[k]])) as Partial<BarFeed>, json = JSON.stringify(own);
    if (last.current?.json !== json) last.current = { json, feed: { ...EMPTY_FEED, ...own } };
    return last.current.feed;
  });
}

/**
 * A widget on Crest's bar: a bar button holding the part, sized with the bar's icons by CSS zoom, which keeps the text sharp and
 * the room real. Its content is the button's description, so a screen reader says the value after the name.
 */
export function WidgetItem({ id, item, paused, onClick, onContextMenu }: {
  id: PartId;
  item: Pick<ItemProps, "name" | "label" | "failed" | "lifted" | "size" | "markAt" | "onEnter" | "onLeave">;
  paused: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
  onContextMenu: MouseEventHandler<HTMLButtonElement>;
}) {
  fontEpoch.use();
  const { taskbar, units, music } = settings.use();
  const { endsAt, duration } = timer.use();
  const feed = useSlices(SLICES[id]);
  const desc = useId();
  const k = widgetScale(taskbar.height, taskbar.iconSize);
  const { node, width } = widgetBody(id, {
    feed,
    paused,
    hovered: item.lifted,
    clock: taskbar.clock,
    h12: units.clock === "12",
    titleLoop: music.titleLoop,
    timerRunning: endsAt !== null,
    timerDuration: duration,
  });
  return (
    // An even width keeps a centred zone, and the buttons after it, on whole pixels, as the apps' even widths already do.
    <Item {...item} width={Math.round((width * k) / 2) * 2 + 16} describedBy={desc} onClick={onClick} onContextMenu={onContextMenu}>
      {/* As tall as the closed row the parts are drawn for; one grid cell, so a part and its icon fade over each other centred; clipped, so a wider part fading out never covers its neighbours. */}
      <span id={desc} className="grid h-[30px] overflow-clip" style={{ zoom: k, width }}>
        <AnimatePresence initial={false}>{node}</AnimatePresence>
      </span>
    </Item>
  );
}
