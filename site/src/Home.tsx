import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from "motion/react";
import { HUE, LOGO, TOOLS, TOOL_BAR } from "./data";
import { ArrowUpRight } from "./icons";
import { News } from "./News";
import { Notch, type Shot } from "./Notch";
import { DEMO_ORIGIN } from "./demo";
import { RELEASE } from "./release";
import { Faq, Footer, Install, Make, Nav, Privacy, Rise } from "./Sections";
import { Wash } from "./Stage";

// The demo's own panels, captured at 2x from the build (the closed row at 3x), so they stay sharp at any size the page shows them.
const files = import.meta.glob("./shots/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const shot = (name: string, w: number, h: number, alt: string): Shot => ({ src: files[`./shots/${name}.png`], w, h, alt });

/** The scroll story: each step opens the notch on one tool and turns the page its colour. */
const STEPS: { tool: string; chapter: string; title: string; text: string; shot: Shot }[] = [
  { tool: "media", chapter: "music", title: "Your music, with the words", text: "Any player with a Windows media session, a live equalizer, a mixer for every app and synced lyrics that light up word by word.", shot: shot("media", 520, 232, "Crest open on Now Playing, with the cover, the progress bar and the controls") },
  { tool: "overview", chapter: "overview", title: "The day at a glance", text: "The time, the weather, the song, focus, keep awake, volume and the brightness of this screen, in one panel.", shot: shot("overview", 520, 356, "Overview with the time, the weather and quick controls") },
  { tool: "timer", chapter: "focus", title: "Focus, then a break", text: "A focus timer with break presets, rain or noise behind it and a countdown that stays in the closed notch.", shot: shot("timer", 520, 192, "The Timer counting down a focus session") },
  { tool: "todos", chapter: "focus", title: "To-dos that ring", text: "Projects, due times and a reminder when one is due. Notes, a water log and a scratchpad sit next to them.", shot: shot("todos", 600, 276, "To-dos with projects and due times") },
  { tool: "clipboard", chapter: "clipboard", title: "Everything you copied", text: "Text, links, images and files, kept in memory only, with password managers left out on purpose.", shot: shot("clipboard", 600, 236, "The clipboard history") },
  { tool: "convert", chapter: "clipboard", title: "Units and 160 currencies", text: "Length, weight, temperature and the rates of the central banks, which Calc understands too.", shot: shot("convert", 520, 210, "The Converter turning pounds into euros") },
  { tool: "ask", chapter: "ai", title: "Ask, with your key or none", text: "Claude, ChatGPT, OpenRouter, or a model on your own PC through LM Studio or Ollama.", shot: shot("ask", 560, 440, "Ask, a chat inside the notch") },
  { tool: "system", chapter: "system", title: "What your PC is doing", text: "CPU, GPU, memory, network, power, temperatures and the busiest processes, with history while the notch is shut.", shot: shot("system", 720, 380, "Hardware with graphs for every part of the PC") },
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

/**
 * The real notch: Crest's own interface, the build of the demo, on a transparent page. It opens on hover and closes when the
 * mouse leaves, as on the PC (a tap on a phone, and a tap outside closes it). Closed, the frame is only as tall as the notch and
 * no wider than the room between the logo and the buttons, so the page around it stays clickable; it grows while the notch is open.
 */
function LiveNotch() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [vw, setVw] = useState(() => window.innerWidth);
  const [big, setBig] = useState(false);
  const host = new URL(DEMO_ORIGIN, location.href).origin;

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.origin !== host) return;
      const d = e.data as { crest?: string; event?: string; open?: boolean; w?: number; h?: number };
      if (d?.crest !== "demo") return;
      if (d.event === "open") setOpen(!!d.open);
      else if (d.event === "size" && d.w && d.h) setSize({ w: d.w, h: d.h });
    };
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener("message", onMessage);
    window.addEventListener("resize", onResize);
    return () => (window.removeEventListener("message", onMessage), window.removeEventListener("resize", onResize));
  }, [host]);
  // Room at once when it opens; back to the notch's size only once the close spring is over.
  useEffect(() => {
    if (open) return setBig(true);
    const id = window.setTimeout(() => setBig(false), 450);
    return () => window.clearTimeout(id);
  }, [open]);
  // A tap or click outside the frame closes it, as a click outside the notch does on the PC.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => e.target !== frame.current && frame.current?.contentWindow?.postMessage({ crest: "demo", cmd: "close" }, host);
    window.addEventListener("pointerdown", down);
    return () => window.removeEventListener("pointerdown", down);
  }, [open, host]);

  // A phone is narrower than most panels: the frame keeps the room a panel needs and is drawn smaller, the way /try/ fits its stage.
  const narrow = vw < 760;
  const scale = !narrow ? 1 : big ? Math.min(1, (vw - 12) / ((size?.w ?? 520) + 28)) : 0.85;
  const style: React.CSSProperties | undefined = narrow
    ? { width: big ? 780 : Math.round(vw / scale), height: big ? 600 : (size?.h ?? 36) + 6, transform: `scale(${scale})`, transformOrigin: "top center" }
    : size && !big
      ? { height: size.h + 6 }
      : undefined;
  return (
    <iframe
      ref={frame}
      className={`live-notch${big ? " is-open" : ""}`}
      src={`${DEMO_ORIGIN}?demo&bare&hover`}
      title="Crest, the real app: point at the notch to open it"
      style={style}
      allow="clipboard-write"
    />
  );
}

/** First screen: the real notch hangs from the top edge, above a large headline. */
function Hero() {
  const reduce = useReducedMotion();
  const words = ["A", "notch", "for", "your", "screen."];
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-notch">
        <LiveNotch />
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
            Crest is a free, open source Dynamic Island for Windows and macOS. The notch at the top of this page is the real app: point at it, or tap it on a phone, and use every tool.
          </p>
          <div className="actions">
            <a className="btn" href="/try/">Try it in your browser</a>
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
  // The panel keeps clear of the tool's large icon below it (home.css): about half the screen's height at most.
  const [maxH, setMaxH] = useState(() => window.innerHeight * 0.5);
  useEffect(() => {
    const onResize = () => setMaxH(window.innerHeight * 0.5);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
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
          <Notch shot={s.shot} open maxW={fit} maxH={maxH} />
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
  const img = files["./shots/closed.png"];
  return (
    <section className="sec closed-sec" aria-labelledby="closed-title">
      <Rise><h2 id="closed-title">Closed, it keeps count</h2></Rise>
      <Rise i={1}>
        <p className="lead">A running timer, the song or its lyric line, AI quota rings, CPU, RAM and GPU, the network, power, battery, temperature, the clock and today's GitHub count. Notices drop over the row and leave by themselves.</p>
      </Rise>
      <Rise i={2} className="closed-strip">
        <img src={img} width={732} height={42} alt="The closed notch with the cover, a running timer, AI quota rings, CPU, the equalizer, the clock, the next event and the weather" />
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
