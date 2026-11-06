import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowCounterClockwise, FlipHorizontal, Gauge, Pause, PencilSimple, Play, TextAa } from "@phosphor-icons/react";
import { fade, springs } from "../../design/motion";
import { HeaderActions, HeaderButton, activeTool } from "../../notch/header";
import { holdOpen } from "../../notch/useNotchState";
import { keyboardFocus } from "../../platform/native";
import { windowShell } from "../../platform/services";
import { Slider } from "../../ui/controls";
import { t } from "../../i18n";
import { SIZE, WPM, advance, clamp, formatClock, progress, pxPerSecond, remainingSeconds, stepWpm } from "./model";
import { prompter, setPrompter } from "./store";

type Phase = "paused" | "countdown" | "playing";

/** Where the script stood when the view was last left, so a notch that closed by accident reopens in the same place. */
let resume: { text: string; at: number } | null = null;

const LINE = 1.4; // line height, as a multiple of the text size
const COUNTDOWN = 3;
const NUDGE_LINES = 2; // one press of an arrow key
const PAGE = 0.8; // one press of Page Up or Page Down, as a share of the visible height
const RAIL_INSET = 8; // px between the position rail and the stage's top and bottom
const THUMB = 8; // px
/** Past lines fade out at the top, coming ones at the bottom; a mask, so nothing is blurred. */
const FADE = "linear-gradient(to bottom, transparent 0%, #000 16%, #000 82%, transparent 100%)";

/** The script as one paragraph per line; its own component so the per-second redraws never touch it. */
const Script = memo(function Script({ text }: { text: string }) {
  return text.split(/\r?\n/).map((line, i) => (
    <p key={i} dir="auto" className="m-0 whitespace-pre-wrap [overflow-wrap:break-word]">
      {line || " "}
    </p>
  ));
});

/**
 * Reading mode. The script sits in one block that is moved with `transform: translateY` (never scrolled, so nothing is
 * laid out again), and a requestAnimationFrame loop runs only while it is moving: it is cancelled on pause, when the
 * tool or the window leaves the screen, and when the view unmounts (which is what closing the notch does).
 */
export function Reader({ words, focus, onEdit }: { words: number; focus: boolean; onEdit: () => void }) {
  const { text, wpm, size, mirror } = prompter.use();
  const onScreen = activeTool.use() === "teleprompter";
  const [hidden, setHidden] = useState(false);
  const [phase, setPhase] = useState<Phase>("paused");
  const [count, setCount] = useState(COUNTDOWN);
  const [ended, setEnded] = useState(false);
  const [left, setLeft] = useState(0);

  const stage = useRef<HTMLDivElement>(null);
  const block = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  /** `text`: the script's height (how far it moves), `track`: how far the position marker moves. */
  const geo = useRef({ text: 0, track: 0 });
  const pos = useRef(0);
  /** How far into the script, 0 to 1. Kept apart from `pos` so a change of size or width keeps the same word on the line. */
  const at = useRef(resume?.text === text ? resume.at : 0);
  const live = useRef({ wpm, words });
  const shown = useRef({ left: -1, percent: -1 });

  const speed = () => pxPerSecond(live.current.wpm, live.current.words, geo.current.text);

  /** Draws the position: the block, the marker and the time left, the last only when the whole second changes. */
  const apply = useCallback(() => {
    const max = geo.current.text;
    const f = progress(pos.current, max);
    if (block.current) block.current.style.transform = `translateY(${-pos.current}px)`;
    if (thumb.current) thumb.current.style.transform = `translateY(${f * geo.current.track}px)`;
    const percent = Math.round(f * 100);
    if (percent !== shown.current.percent) {
      shown.current.percent = percent;
      rail.current?.setAttribute("aria-valuenow", String(percent));
    }
    const secs = Math.ceil(remainingSeconds(pos.current, max, pxPerSecond(live.current.wpm, live.current.words, max)));
    if (secs !== shown.current.left) {
      shown.current.left = secs;
      setLeft(secs);
    }
  }, []);

  const setPos = useCallback(
    (px: number) => {
      pos.current = clamp(px, geo.current.text);
      at.current = progress(pos.current, geo.current.text);
      apply();
    },
    [apply],
  );

  /** A move by the user: the end is no longer reached. */
  const move = (px: number) => {
    setEnded(false);
    setPos(pos.current + px);
  };
  const seek = (f: number) => {
    setEnded(false);
    setPos(f * geo.current.text);
  };

  useLayoutEffect(() => {
    live.current = { wpm, words };
    apply();
  }, [wpm, words, apply]);

  // The script's height changes with the text size and the panel's width, the stage's with the panel's height.
  useLayoutEffect(() => {
    const measure = () => {
      if (!stage.current || !block.current) return;
      const text = block.current.offsetHeight;
      geo.current = { text, track: Math.max(0, stage.current.clientHeight - 2 * RAIL_INSET - THUMB) };
      pos.current = at.current * text;
      apply();
    };
    const ro = new ResizeObserver(measure);
    ro.observe(stage.current!);
    ro.observe(block.current!);
    measure();
    return () => ro.disconnect();
  }, [apply]);

  useEffect(() => windowShell.onHidden(setHidden), []);
  useEffect(() => {
    if (focus) {
      keyboardFocus(true);
      stage.current?.focus({ preventScroll: true });
    }
  }, [focus]);
  useEffect(
    () => () => {
      resume = { text: prompter.get().text, at: at.current };
    },
    [],
  );

  // Off the screen (another tool, a hidden window) it stops where it is.
  const active = onScreen && !hidden;
  useEffect(() => {
    if (!active) setPhase("paused");
  }, [active]);

  // While it counts down or plays, the notch stays open although the pointer is elsewhere (the reader looks at the camera, not at the notch).
  const going = phase !== "paused";
  useEffect(() => {
    if (!going) return;
    holdOpen(true);
    return () => holdOpen(false);
  }, [going]);

  useEffect(() => {
    if (phase !== "countdown") return;
    const id = window.setTimeout(() => (count > 1 ? setCount(count - 1) : setPhase("playing")), 1000);
    return () => window.clearTimeout(id);
  }, [phase, count]);

  useEffect(() => {
    if (phase !== "playing") return;
    let id = 0;
    let last = performance.now();
    const frame = (now: number) => {
      setPos(advance(pos.current, (now - last) / 1000, speed(), geo.current.text));
      last = now;
      if (pos.current >= geo.current.text) {
        setEnded(true);
        setPhase("paused");
        return;
      }
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [phase, setPos]);

  const toggle = () => {
    if (phase !== "paused") return setPhase("paused");
    if (speed() <= 0) return;
    if (at.current >= 1) setPos(0);
    setEnded(false);
    // From the top it counts down; from the middle it goes on straight away.
    if (pos.current < 1) {
      setCount(COUNTDOWN);
      setPhase("countdown");
    } else setPhase("playing");
  };

  const lineH = size * LINE;
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    // A button or field keeps its own Space.
    const own = (e.target as Element).closest("button, input, textarea, select");
    const view = stage.current?.clientHeight ?? 0;
    switch (e.key) {
      case " ":
        if (own) return;
        if (!e.repeat) toggle();
        break;
      case "ArrowUp":
        move(-NUDGE_LINES * lineH);
        break;
      case "ArrowDown":
        move(NUDGE_LINES * lineH);
        break;
      case "PageUp":
        move(-PAGE * view);
        break;
      case "PageDown":
        move(PAGE * view);
        break;
      case "Home":
        seek(0);
        break;
      case "End":
        seek(1);
        break;
      case "+":
      case "=":
        setPrompter({ wpm: stepWpm(wpm, 1) });
        break;
      case "-":
      case "_":
        setPrompter({ wpm: stepWpm(wpm, -1) });
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    seek((e.clientY - r.top - THUMB / 2) / Math.max(1, r.height - THUMB));
  };

  const status = phase === "playing" ? t("Läuft") : phase === "countdown" ? "" : ended ? t("Ende erreicht") : t("Pausiert");
  const playLabel = phase === "paused" ? t("Abspielen") : t("Pause");

  return (
    <div
      className="flex h-full flex-col px-4 pt-1 pb-2"
      onPointerDown={() => keyboardFocus(true)}
      // A click on the bare panel hands the keys back to the stage.
      onClick={(e) => !(e.target as Element).closest("button, [role=slider]") && stage.current?.focus({ preventScroll: true })}
      onKeyDown={onKeyDown}
    >
      <HeaderActions>
        <HeaderButton label={t("Spiegeln")} active={mirror} onClick={() => setPrompter({ mirror: !mirror })}>
          <FlipHorizontal size={14} weight="bold" />
        </HeaderButton>
        <HeaderButton
          label={t("Von vorn")}
          onClick={() => {
            setPhase("paused");
            seek(0);
          }}
        >
          <ArrowCounterClockwise size={14} weight="bold" />
        </HeaderButton>
        <HeaderButton label={t("Bearbeiten")} onClick={onEdit}>
          <PencilSimple size={14} weight="bold" />
        </HeaderButton>
      </HeaderActions>

      <div
        ref={stage}
        tabIndex={0}
        role="group"
        aria-label={t("Prompter")}
        aria-keyshortcuts="Space ArrowUp ArrowDown PageUp PageDown Home End + -"
        // The wheel moves the script here instead of switching tools (Notch.tsx).
        data-wheel
        onWheel={(e) => move(e.deltaMode === 1 ? e.deltaY * lineH : e.deltaY)}
        className="relative min-h-0 flex-1 overflow-hidden rounded-[12px] bg-fill-1 outline-none focus-visible:ring-2 focus-visible:ring-link/60"
      >
        {/* Mirrored as a whole for a glass teleprompter: text, reading line and countdown. */}
        <div className="absolute inset-0" style={{ transform: mirror ? "scaleX(-1)" : undefined }}>
          <div aria-hidden className="absolute inset-x-0 top-1/3 rounded-[8px] bg-fill-2" style={{ height: lineH }}>
            <span className="absolute inset-y-1 start-1 w-0.5 rounded-full bg-accent" />
          </div>
          <div className="absolute inset-0" style={{ maskImage: FADE, WebkitMaskImage: FADE }}>
            <div ref={block} className="absolute inset-x-0 top-1/3 px-6 text-label will-change-transform" style={{ fontSize: size, lineHeight: LINE }}>
              <Script text={text} />
            </div>
          </div>
          <AnimatePresence>
            {phase === "countdown" && (
              <motion.div
                key="countdown"
                aria-hidden
                className="pointer-events-none absolute inset-0 flex items-center justify-center bg-notch/70"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={fade}
              >
                <AnimatePresence mode="wait">
                  <motion.span
                    key={count}
                    className="tabular text-[72px] leading-none font-semibold text-label"
                    initial={{ opacity: 0, transform: "scale(0.8)" }}
                    animate={{ opacity: 1, transform: "scale(1)", transition: springs.snappy }}
                    exit={{ opacity: 0, transition: { duration: 0.1 } }}
                  >
                    {count}
                  </motion.span>
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* The position: click or drag to jump. */}
        <div
          ref={rail}
          role="slider"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label={t("Position")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={0}
          className="absolute end-1 w-4 cursor-pointer touch-none outline-none focus-visible:ring-2 focus-visible:ring-link/60"
          style={{ top: RAIL_INSET, bottom: RAIL_INSET }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            scrub(e);
          }}
          onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && scrub(e)}
        >
          <span aria-hidden className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-fill-2" />
          <span ref={thumb} aria-hidden className="absolute top-0 left-1/2 -ml-1 size-2 rounded-full bg-label-2" />
        </div>
      </div>

      <div className="mt-1.5 flex shrink-0 items-center gap-3">
        <button
          aria-label={playLabel}
          title={t("Leertaste: Start oder Pause · Pfeile: springen · + und -: Tempo")}
          onClick={toggle}
          className="pressable pressable-fill flex size-8 shrink-0 items-center justify-center rounded-full bg-fill-2 text-label"
        >
          {phase === "paused" ? <Play size={14} weight="fill" /> : <Pause size={14} weight="fill" />}
        </button>
        <span className="tabular w-14 shrink-0 text-caption text-label-3">{t("noch {time}", { time: formatClock(left) })}</span>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Gauge size={14} aria-hidden className="shrink-0 text-label-3" />
          <Slider value={wpm} min={WPM.min} max={WPM.max} step={WPM.step} label={t("Tempo")} onChange={(v) => setPrompter({ wpm: v })} />
          <span className="tabular w-12 shrink-0 text-end text-caption text-label-2">{t("{n} WPM", { n: wpm })}</span>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <TextAa size={14} aria-hidden className="shrink-0 text-label-3" />
          <Slider value={size} min={SIZE.min} max={SIZE.max} step={SIZE.step} label={t("Schriftgröße")} onChange={(v) => setPrompter({ size: v })} />
        </div>
        {/* Said quietly, only when it changes. */}
        <span role="status" aria-live="polite" className="sr-only">
          {status}
        </span>
      </div>
    </div>
  );
}
