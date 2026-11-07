import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { MicrophoneStage } from "@phosphor-icons/react";
import { content } from "../../design/motion";
import { media, type NowPlaying } from "../../platform/media";
import { settings } from "../../settings/store";
import { linesOf, useLyricIndex, useLyrics, useOfflineTranslation, useRomanized } from "./lyrics";
import type { LyricWord } from "./lrc";
import { t } from "../../i18n";

/**
 * Height the panel adds to the notch (separator included): room for the sung line with the one before and after it in
 * full, more when a romanisation or translation sits under each line.
 */
export const lyricsPanel = (subLines: boolean) => (subLines ? 236 : 176);
/** After the wheel moves the list, it stays where the user put it this long. */
const HOLD_SCROLL_MS = 3000;

/**
 * Synced lyrics under the controls: the sung line bright and centred, the others dim, scrolling along by itself. With
 * word timing the sung line lights up word by word; translation and romanisation sit small under each line when on.
 * A click on a line jumps there when the player allows seeking.
 */
export function LyricsPanel({ np }: { np: NowPlaying }) {
  const music = settings.use().music;
  const state = useLyrics(np, true);
  // Translation first: a romanisation arriving later must not restart it.
  const lines = useRomanized(useOfflineTranslation(np, linesOf(state), music.lyricTranslation && music.offlineTranslation === true), music.lyricRoman);
  const index = useLyricIndex(lines, np);
  const list = useRef<HTMLDivElement>(null);
  const userScrolledAt = useRef(0);

  useEffect(() => {
    const el = list.current;
    if (!el || performance.now() - userScrolledAt.current < HOLD_SCROLL_MS) return;
    const row = el.querySelectorAll("button")[Math.max(0, index)] as HTMLElement | undefined;
    if (row) el.scrollTo({ top: row.offsetTop - (el.clientHeight - row.offsetHeight) / 2, behavior: "smooth" });
  }, [index, lines]);

  const message =
    state?.kind === "loading" ? t("Songtext wird gesucht …")
    : state?.kind === "instrumental" ? t("Instrumental")
    : state?.kind === "offline" ? t("Die Songtext-Quellen sind gerade nicht erreichbar")
    : state?.kind === "skipped" ? t("Songtexte nur für Songs bis 20 Minuten mit bekannter Länge")
    : state?.kind === "nosource" ? t("Keine Songtext-Quelle ist an")
    : !lines ? t("Kein synchronisierter Songtext für diesen Song")
    : null;

  return (
    <motion.div
      className="flex min-h-0 flex-1 flex-col"
      initial={{ opacity: 0, filter: "blur(4px)" }}
      animate={{ opacity: 1, filter: "blur(0px)", transition: { ...content.enter, delay: 0.06 } }}
      exit={{ opacity: 0, filter: "blur(4px)", transition: content.exit }}
    >
      <div className="mx-0.5 mt-2 mb-1 h-px shrink-0 bg-separator" />
      {message ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-footnote text-label-3">
          <MicrophoneStage size={14} weight="bold" />
          {message}
        </div>
      ) : (
        // A size container, so the spacers can be half its height: the first and last lines can then sit in the middle too.
        <div className="relative min-h-0 flex-1 [container-type:size]">
          <div
            ref={list}
            className="absolute inset-0 overflow-y-auto [scrollbar-width:none]"
            // Only the outer edges fade, so the lines before and after the sung one stay fully visible.
            style={{ maskImage: "linear-gradient(180deg, transparent, #000 14%, #000 86%, transparent)" }}
            onWheel={() => (userScrolledAt.current = performance.now())}
          >
            <div aria-hidden className="h-[calc(50cqh-14px)]" />
            {lines!.map((line, i) => (
              <button
                key={i}
                disabled={!np.canSeek}
                onClick={() => media.seek(line.time)}
                className={`block w-full px-2 py-[3px] text-center text-body font-semibold leading-snug transition-colors duration-300 enabled:cursor-pointer ${
                  // The lines just before and after the sung one stay readable; the rest step back.
                  i === index ? "text-label" : Math.abs(i - index) === 1 ? "text-label-3 enabled:hover:text-label-2" : "text-label-4 enabled:hover:text-label-2"
                }`}
              >
                {i === index && line.words && music.lyricWords ? <SungWords words={line.words} np={np} /> : line.text || "•••"}
                {music.lyricRoman && line.roman && <span className="block text-footnote font-medium opacity-70">{line.roman}</span>}
                {music.lyricTranslation && line.translation && <span className="block text-footnote font-medium opacity-70">{line.translation}</span>}
              </button>
            ))}
            <div aria-hidden className="h-[calc(50cqh-14px)]" />
          </div>
        </div>
      )}
    </motion.div>
  );
}

/** The sung line, word by word: words already sung bright, the rest dim. Only this line re-renders per word. */
function SungWords({ words, np }: { words: LyricWord[]; np: NowPlaying }) {
  const word = useLyricIndex(words, np);
  return words.map((w, j) => (
    <span key={j} className={`transition-colors duration-200 ${j <= word ? "text-label" : "text-label-3"}`}>
      {w.text}
    </span>
  ));
}
