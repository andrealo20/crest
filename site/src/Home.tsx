import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from "motion/react";
import { HUE, LOGO, TOOLS, TOOL_BAR } from "./data";
import { ArrowUpRight } from "./icons";
import { News } from "./News";
import { Notch, type Shot } from "./Notch";
import { RELEASE } from "./release";
import { Faq, Footer, Install, Make, Nav, Privacy, Rise } from "./Sections";
import { Wash } from "./Stage";

// The README's own panels (docs/media/features), listed one by one because the glob decides what the build copies.
const files = import.meta.glob("../../docs/media/features/{now-playing,overview,timer,todos,clipboard,converter,ask,hardware,weather,closed-notch}.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const shot = (name: string, w: number, h: number, alt: string): Shot => ({ src: files[`../../docs/media/features/${name}.png`], w, h, alt });

const MUSIC = shot("now-playing", 524, 376, "Crest open on Now Playing, with the cover, the progress bar, the controls and synced lyrics");

/** The scroll story: each step opens the notch on one tool and turns the page its colour. */
const STEPS: { tool: string; chapter: string; title: string; text: string; shot: Shot }[] = [
  { tool: "media", chapter: "music", title: "Your music, with the words", text: "Any player with a Windows media session, a live equalizer, a mixer for every app and synced lyrics that light up word by word.", shot: MUSIC },
  { tool: "overview", chapter: "overview", title: "The day at a glance", text: "The time, the weather, the song, focus, keep awake, volume and the brightness of this screen, in one panel.", shot: shot("overview", 524, 260, "Overview with the time, the weather and quick controls") },
  { tool: "timer", chapter: "focus", title: "Focus, then a break", text: "A focus timer with break presets, rain or noise behind it and a countdown that stays in the closed notch.", shot: shot("timer", 524, 200, "The Timer counting down a focus session") },
  { tool: "todos", chapter: "focus", title: "To-dos that ring", text: "Projects, due times and a reminder when one is due. Notes, a water log and a scratchpad sit next to them.", shot: shot("todos", 604, 284, "To-dos with projects and due times") },
  { tool: "clipboard", chapter: "clipboard", title: "Everything you copied", text: "Text, links, images and files, kept in memory only, with password managers left out on purpose.", shot: shot("clipboard", 604, 243, "The clipboard history") },
  { tool: "convert", chapter: "clipboard", title: "Units and 160 currencies", text: "Length, weight, temperature and the rates of the central banks, which Calc understands too.", shot: shot("converter", 520, 289, "The Converter turning pounds into euros") },
  { tool: "ask", chapter: "ai", title: "Ask, with your key or none", text: "Claude, ChatGPT, OpenRouter, or a model on your own PC through LM Studio or Ollama.", shot: shot("ask", 564, 447, "Ask, a chat inside the notch") },
  { tool: "system", chapter: "system", title: "What your PC is doing", text: "CPU, GPU, memory, network, power, temperatures and the busiest processes, with history while the notch is shut.", shot: shot("hardware", 724, 387, "Hardware with graphs for every part of the PC") },
];

/** Width the open notch may take: the column it sits in, less the margins. */
function useFit(ref: React.RefObject<HTMLElement | null>, max: number) {
  const [w, setW] = useState(max);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.min(max, el.clientWidth - 32)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, max]);
  return w;
}

/** First screen: the closed notch at the top edge opens by itself, then answers a click, like the app. */
function Hero() {
  const reduce = useReducedMotion();
  const box = useRef<HTMLElement>(null);
  const fit = useFit(box, 470);
  // Room the open panel needs above the headline on a wide screen (home.css).
  const notchH = Math.round((MUSIC.h - 10) * Math.min(1.25, fit / MUSIC.w));
  const [open, setOpen] = useState(false);
  const touched = useRef(false);
  useEffect(() => {
    if (reduce) return void setOpen(true);
    const a = window.setTimeout(() => !touched.current && setOpen(true), 1100);
    return () => window.clearTimeout(a);
  }, [reduce]);

  const words = ["A", "notch", "for", "your", "screen."];
  return (
    <section className="hero" ref={box} aria-labelledby="hero-title" style={{ ["--notch-h" as string]: `${notchH}px` }}>
      <div className="hero-notch">
        <Notch shot={MUSIC} open={open} maxW={fit} label={open ? "Close the notch" : "Open the notch"} onToggle={() => { touched.current = true; setOpen(!open); }} />
      </div>
      <Nav />
      <div className="hero-copy">
        <h1 id="hero-title" className="hero-title">
          {words.map((w, i) => (
            <span key={w} className="word">
              <motion.span initial={reduce ? false : { y: "105%" }} animate={{ y: 0 }} transition={{ type: "spring", visualDuration: 0.7, bounce: 0.12, delay: 0.15 + i * 0.07 }}>
                {w}
              </motion.span>
            </span>
          ))}
        </h1>
        <motion.div className="hero-side" initial={reduce ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}>
          <p className="lead">
            Crest is a free, open source Dynamic Island for Windows and macOS. Music, timers, to-dos, the clipboard and thirty more tools, one click from the top of your screen.
          </p>
          <div className="actions">
            <a className="btn btn-yellow" href="/try/">Try it in your browser</a>
            <a className="btn btn-ghost" href="#install">Get Crest {RELEASE}</a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/** Every tool, in two rows that slide in opposite directions as the page scrolls. */
function ToolBand() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const a = useTransform(scrollYProgress, [0, 1], reduce ? ["0%", "0%"] : ["4%", "-38%"]);
  const b = useTransform(scrollYProgress, [0, 1], reduce ? ["-20%", "-20%"] : ["-40%", "2%"]);
  const ids = [...TOOL_BAR, "calc", "clocks", "colour", "habits", "teleprompter", "agents"];
  const half = Math.ceil(ids.length / 2);
  const row = (list: string[]) =>
    [...list, ...list].map((id, i) => {
      const t = TOOLS[id];
      const Icon = t.icon;
      return (
        <li key={`${id}${i}`} className="band-chip" style={{ background: HUE[t.hue] }} aria-hidden={i >= list.length || undefined}>
          <Icon size={30} weight="bold" aria-hidden="true" />
          {t.label}
        </li>
      );
    });
  return (
    <section ref={ref} className="band" aria-labelledby="band-title">
      <Rise className="band-head">
        <h2 id="band-title">Thirty tools. One notch.</h2>
      </Rise>
      <motion.ul className="band-row" style={{ x: a }}>{row(ids.slice(0, half))}</motion.ul>
      <motion.ul className="band-row" style={{ x: b }}>{row(ids.slice(half))}</motion.ul>
    </section>
  );
}

/** The pinned story: the page holds still while scrolling opens the notch on one tool after another. */
function Story() {
  const ref = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const fit = useFit(stage, 640);
  const [step, setStep] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  useMotionValueEvent(scrollYProgress, "change", (p) => setStep(Math.min(STEPS.length - 1, Math.max(0, Math.floor(p * STEPS.length)))));
  const bar = useTransform(scrollYProgress, [0, 1], [0, 1]);
  const s = STEPS[step];
  const hue = HUE[TOOLS[s.tool].hue];
  const Icon = TOOLS[s.tool].icon;

  return (
    <section ref={ref} className="story" style={{ height: `${STEPS.length * 85}svh` }} aria-labelledby="story-title">
      <div className="story-pin" style={{ color: "#000" }}>
        <Wash color={hue} />
        <h2 id="story-title" className="sr-only">What Crest opens into</h2>
        <div className="story-stage" ref={stage}>
          <Notch shot={s.shot} open maxW={fit} />
        </div>
        <AnimatePresence initial={false}>
          <motion.div key={s.tool} className="story-icon" aria-hidden="true" initial={{ opacity: 0, scale: 0.6, rotate: -18 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} exit={{ opacity: 0, scale: 1.2, rotate: 12 }} transition={{ type: "spring", visualDuration: 0.5, bounce: 0.3 }}>
            <Icon size={320} weight="bold" aria-hidden="true" />
          </motion.div>
        </AnimatePresence>
        <div className="story-copy" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={s.tool} initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}>
              <h3>{s.title}</h3>
              <p className="lead">{s.text}</p>
            </motion.div>
          </AnimatePresence>
          <a className="textlink" href={`/try/#${s.chapter}`}>
            Try {TOOLS[s.tool].label} in the browser <ArrowUpRight size={18} weight="bold" aria-hidden="true" />
          </a>
        </div>
        <motion.div className="story-bar" style={{ scaleX: bar }} aria-hidden="true" />
      </div>
    </section>
  );
}

/** Shut, the notch keeps working: the real closed row, large. */
function Closed() {
  const img = files["../../docs/media/features/closed-notch.png"];
  return (
    <section className="sec closed-sec" aria-labelledby="closed-title">
      <Rise><h2 id="closed-title">Closed, it keeps count</h2></Rise>
      <Rise i={1}>
        <p className="lead">A running timer, the song or its lyric line, AI quota rings, CPU, RAM and GPU, the network, power, battery, temperature, the clock and today's GitHub count. Notices drop over the row and leave by themselves.</p>
      </Rise>
      <Rise i={2} className="closed-strip">
        <img src={img} width={1222} height={56} alt="The closed notch with a running timer, the AI quota ring, CPU, RAM and GPU load, the network, power, battery, temperature, the clock and today's GitHub contributions" />
      </Rise>
      <Rise i={3}>
        <a className="textlink" href="/try/#closed">Change its look and edge in the demo <ArrowUpRight size={18} weight="bold" aria-hidden="true" /></a>
      </Rise>
    </section>
  );
}

export default function Home() {
  return (
    <div id="top" style={{ ["--y" as string]: LOGO.yellow }}>
      <a className="skip" href="#band-title">Skip to the content</a>
      <main>
        <Hero />
        <ToolBand />
        <Story />
        <Closed />
        <News release={RELEASE} />
        <Make />
        <Privacy />
        <Install />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
