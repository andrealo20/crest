import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { HUE, LOGO, TOOLS, TOOL_BAR } from "./data";
import { ArrowUpRight, DownloadSimple, GithubLogo } from "./icons";
import { SHADE_TINTS, Waves } from "./Waves";
import { News } from "./News";
import { Catalog } from "./Catalog";
import { DEMO_FULL, DEMO_ORIGIN } from "./demo";
import { num, useStats } from "./live";
import { useWide } from "./wide";
import { RELEASE } from "./release";
import { Faq, Footer, Install, Make, Mark, Nav, Privacy, REPO, Rise } from "./Sections";
import { springs } from "../../src/design/motion";

// The demo's own panels, captured at 2x from the build (the closed row at 3x), so they stay sharp at any size the page shows them.
const files = import.meta.glob("./shots/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
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

  // A phone is narrower than most panels: the frame keeps the room a panel needs and is drawn smaller, as the full-screen demo fits a phone.
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

/** Once the first screen's bar has scrolled away, a black bar with the logo and the two buttons stays at the top of the page. */
function StickyBar() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const nav = document.querySelector(".hero .nav");
    if (!nav) return;
    const io = new IntersectionObserver(([e]) => setShow(!e.isIntersecting));
    io.observe(nav);
    return () => io.disconnect();
  }, []);
  return (
    <motion.div className="sticky-bar" initial={false} animate={{ y: show ? 0 : -96, opacity: show ? 1 : 0 }} transition={show ? springs.open : springs.close} inert={!show} aria-hidden={!show}>
      <a className="sticky-brand" href="/" aria-label="Crest, home">
        <Mark size={30} animate={false} />
        <span>Crest</span>
      </a>
      <div className="sticky-actions">
        <a className="btn btn-small btn-light btn-shine" href={DEMO_FULL}>Try it</a>
        <a className="btn btn-small sticky-get btn-bounce" href="#install"><DownloadSimple size={18} weight="bold" aria-hidden="true" /> Get Crest</a>
      </div>
    </motion.div>
  );
}

/** The size the framed desktop is drawn at: wide enough for the demo to put Crest's bar on it (src/dev/demo.ts wants 1000). */
const DESK = { w: 1440, h: 900 };

/**
 * The whole desktop, notch and bar, in a screen under the headline. On a computer it is the real app in the demo build, drawn at
 * desktop size and scaled to the column; on a phone, where the demo has no bar, a picture of the same desktop.
 */
function Desk({ live }: { live: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [w, setW] = useState(0);
  // The arrows to the notch stay until the visitor has opened it once
  const [tried, setTried] = useState(false);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const host = new URL(DEMO_ORIGIN, location.href).origin;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.origin !== host) return;
      const d = e.data as { crest?: string; event?: string; open?: boolean };
      if (d?.crest === "demo" && d.event === "open" && d.open) setTried(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return (
    <figure className="desk">
      <div className="desk-screen" ref={box}>
        {live && (
          <AnimatePresence>
            {!tried && (
              <motion.div className="desk-hint" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, delay: tried ? 0 : 1.2 }}>
                <motion.svg className="desk-arrow desk-arrow-left" viewBox="0 0 120 80" animate={reduce ? undefined : { x: [0, 6, 0], y: [0, -6, 0] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}>
                  <path d="M6 74 C 30 70, 70 50, 104 12" />
                  <path d="M86 14 L 106 10 L 102 30" />
                </motion.svg>
                <p>Click the notch to try it</p>
                <motion.svg className="desk-arrow desk-arrow-right" viewBox="0 0 120 80" animate={reduce ? undefined : { x: [0, -6, 0], y: [0, -6, 0] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}>
                  <path d="M114 74 C 90 70, 50 50, 16 12" />
                  <path d="M34 14 L 14 10 L 18 30" />
                </motion.svg>
              </motion.div>
            )}
          </AnimatePresence>
        )}
        {live ? (
          w > 0 && (
            <iframe
              ref={frame}
              src={`${DEMO_ORIGIN}?demo&framed&wall=/img/wallpaper.webp`}
              title="Crest on a Windows desktop, the real app: point at the notch, open Start, try the widgets"
              width={DESK.w}
              height={DESK.h}
              style={{ transform: `scale(${w / DESK.w})` }}
              allow="clipboard-write"
            />
          )
        ) : (
          <img src="/img/desktop.webp" width={960} height={600} alt="Crest on a Windows desktop: the notch open on Hardware at the top, and Crest's taskbar along the bottom with its widgets, Start, the apps, the tray, the battery charging and the clock" />
        )}
      </div>
      <figcaption>
        {live ? "The real app, running in this page: point at the notch, open Start, try the widgets." : "Crest's notch and taskbar on Windows. On a computer this screen is the real app."}{" "}
        <a className="textlink" href={DEMO_FULL}>
          {live ? "Open it full screen" : "Try the notch in your browser"} <ArrowUpRight size={16} weight="bold" aria-hidden="true" />
        </a>
      </figcaption>
    </figure>
  );
}

/** The download total of the GitHub releases, read when the site is built (downloads.ts), linked to them; nothing without it. */
function Downloads() {
  const d = __SITE_DOWNLOADS__;
  if (!d?.total) return null;
  return (
    <a className="hero-live" href={`${REPO}/releases`}>
      <GithubLogo size={16} weight="fill" aria-hidden="true" />
      <span>
        <strong>{num(d.total)}</strong> downloads
      </span>
    </a>
  );
}

/** How many computers run Crest today, from the daily count, linked to /stats/; nothing until there is a count to show. */
function Live() {
  const s = useStats();
  if (!s?.today.total) return null;
  return (
    <a className="hero-live" href="/stats/">
      <span className="hero-live-dot" aria-hidden="true" />
      <span>
        <strong>{num(s.today.total)}</strong> computers run Crest today<span className="hero-live-then">, {num(s.yesterday)} yesterday</span>
      </span>
    </a>
  );
}

/** First screen: the headline, what Crest is, and under them the desktop it makes. On a phone the real notch hangs from the top. */
function Hero() {
  const reduce = useReducedMotion();
  const wide = useWide();
  return (
    <section className="hero" aria-labelledby="hero-title">
      <Waves />
      {!wide && (
        <div className="hero-notch">
          <LiveNotch />
        </div>
      )}
      <Nav />
      <div className="hero-copy">
        <h1 id="hero-title" className="hero-title">Your desktop, rebuilt.</h1>
        <motion.div className="hero-side" initial={reduce ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}>
          <div className="hero-words">
            <p className="lead">
              Crest puts a notch at the edge of your screen with 36 tools, from your music to your PC's hardware, and on Windows a taskbar of its own, with widgets, live previews and Liquid Glass. Free and open source, for Windows and macOS.
            </p>
            <p className="hero-meta">
              Windows 11 and 10, macOS 12 or later as a preview.{" "}
              <a href="/whats-new/">New in {RELEASE}: Search or open, Pomelo's Files tool, Translate</a>
            </p>
            <div className="hero-figs">
              <Downloads />
              <Live />
            </div>
          </div>
          <div className="actions">
            <a className="btn btn-light btn-shine" href={DEMO_FULL}>Try it in your browser</a>
            <a className="btn btn-bounce" href="#install"><DownloadSimple size={18} weight="bold" aria-hidden="true" /> Get Crest {RELEASE}</a>
          </div>
        </motion.div>
      </div>
      <Desk live={wide} />
    </section>
  );
}

/** Windows' own taskbar, done again: the desktop large, then what the bar does, beside the folder picture. */
const BAR_FACTS: [string, string][] = [
  ["Your apps in the middle", "Windows' Start, pinned apps and open windows, with live previews of each window, jump lists and badges, on every monitor."],
  ["Widgets around them", "Weather, clocks, hardware, the timer, Now Playing, batteries, disk space, currencies, Screen Time and more, each in the version you pick, dragged anywhere along the bar."],
  ["Folders", "Hold a pinned app over another for half a second and both go into a folder that opens over the bar."],
  ["Four shapes", "Docked along the whole edge, floating, a capsule as wide as its buttons, or tiles, at the height and icon size you like."],
  ["Liquid Glass +", "A strong lens along the bar's edge over a live copy of the screen, on Windows 11 24H2 and later."],
  ["Status", "Network, volume and battery as one button, with a quick panel for Wi-Fi, Bluetooth and brightness."],
];

function Bar() {
  return (
    <section id="bar" className="sec bar-sec has-waves" aria-labelledby="bar-title">
      <Waves tints={SHADE_TINTS} />
      <div className="bar-head">
        <Rise><h2 id="bar-title">A taskbar of its own</h2></Rise>
        <Rise i={1}>
          <p className="lead">On Windows, Crest can take the place of the taskbar. Turn it off, or quit Crest, and Windows' own comes back. Off by default, and not in the Microsoft Store version for now.</p>
        </Rise>
      </div>
      <Rise className="bar-strip">
        <img src="/img/bar.webp" width={1440} height={64} alt="Crest's taskbar: CPU, memory and GPU, the weather and the AI quota rings on the left, Start and the apps in the middle, the timer, the tray, Wi-Fi, volume and the battery charging at 64 percent, and the clock on the right" loading="lazy" decoding="async" />
      </Rise>
      <div className="bar-body">
        <Rise className="bar-folder">
          <img src="/img/folder-1.3.2.webp" width={640} height={184} alt="A folder called Creative open over the bar, with four apps" loading="lazy" decoding="async" />
        </Rise>
        <dl className="bar-facts">
          {BAR_FACTS.map(([k, v], i) => (
            <Rise key={k} i={i % 2}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </Rise>
          ))}
        </dl>
      </div>
      <Rise>
        <a className="textlink" href={DEMO_FULL}>Try the bar in your browser, on a computer <ArrowUpRight size={18} weight="bold" aria-hidden="true" /></a>
      </Rise>
    </section>
  );
}

/** The close: the title's promise once more, and the two ways in. */
function Closing() {
  return (
    <section className="sec closing" aria-labelledby="closing-title">
      <Waves />
      <Rise><h2 id="closing-title">Rebuild yours in a minute.</h2></Rise>
      <Rise i={1} className="actions">
        <a className="btn btn-bounce" href="#install"><DownloadSimple size={18} weight="bold" aria-hidden="true" /> Get Crest {RELEASE}</a>
        <a className="btn btn-ghost" href={DEMO_FULL}>Try it first</a>
      </Rise>
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
  const ids = [...TOOL_BAR, "calc", "clocks", "colour", "habits", "teleprompter", "agents", "leetcode", "screentime", "wallpapers", "translate", "files"];
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
        <h2 id="band-title">{ids.length} tools. One notch.</h2>
      </Rise>
      <motion.ul className="band-row" style={{ x: a }}>{row(ids.slice(0, half))}</motion.ul>
      <motion.ul className="band-row" style={{ x: b }}>{row(ids.slice(half))}</motion.ul>
    </section>
  );
}

/** The looks, as the demo draws them: themes on a band that slides with the scroll, then timer looks and closed looks. */
const THEME_SHOTS: [string, string][] = [["dark", "Dark"], ["light", "Light"], ["dracula", "Dracula"], ["nord", "Nord"], ["catppuccin-latte", "Catppuccin Latte"], ["gruvbox-dark", "Gruvbox Dark"]];
const LOOK_SHOTS: [string, string][] = [["pixel", "Pixel"], ["flip", "Flip"], ["nixie", "Nixie"], ["lcd", "LCD"], ["analog", "Analog"], ["ring", "Ring"]];
const STYLE_SHOTS: [string, string, number, number][] = [["notch", "Notch", 554, 42], ["capsule", "Capsule", 528, 47], ["line", "Line", 158, 9]];

/** How many choices there are, counted from the app's own lists (themes.ts, looks.ts, parts.ts, panelSize.ts, i18n). */
const COUNTS: { n: string; what: string; hue: string }[] = [
  { n: "15", what: "themes, plus an editor for your own and a switch between a day and a night theme", hue: HUE.purple },
  { n: "12", what: "timer looks in 13 colours, and the clock in any of them", hue: HUE.orange },
  { n: "3", what: "closed looks, the notch, the capsule and the line, on any of 4 screen edges", hue: HUE.lime },
  { n: "8", what: "panel scales, from 80 to 200 percent", hue: HUE.sky },
  { n: "12", what: "parts and 7 readings to choose for the closed row, in the order you like", hue: HUE.teal },
  { n: "36", what: "tools to turn on, turn off and reorder, each with a shortcut of its own", hue: HUE.yellow },
  { n: "11", what: "languages, Arabic read right to left", hue: HUE.pink },
  { n: "8", what: "cartoon pets for a nest beside the notch", hue: HUE.rose },
];

function Custom() {
  const band = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: band, offset: ["start end", "end start"] });
  const x = useTransform(scrollYProgress, [0, 1], reduce ? ["0%", "0%"] : ["6%", "-46%"]);
  return (
    <section id="look" className="custom" aria-labelledby="custom-title">
      <div className="custom-head">
        <Rise><h2 id="custom-title">Make it yours</h2></Rise>
        <Rise i={1}><p className="lead">Two styles for the whole app, fifteen themes, Liquid Glass on Windows and dozens of choices in Settings, from the colours to the shape of the notch, all saved on your PC. Every picture here is the app with one of them changed.</p></Rise>
      </div>

      <div className="custom-material">
        <Rise className="custom-material-pic">
          <img src="/img/settings-material.webp" width={800} height={524} alt="The settings window in the Material style, open on Themes: the Crest and Material styles and the fifteen themes" loading="lazy" decoding="async" />
        </Rise>
        <div className="custom-material-words">
          <Rise><h3>Crest or Material</h3></Rise>
          <Rise i={1}>
            <p className="body">Crest is the black look the notch was born with. Material takes its colours from your theme and rounds every shape, in the notch, the bar and the settings window, and can keep a dark theme's background pure black.</p>
          </Rise>
        </div>
      </div>

      <div className="custom-themes" ref={band}>
        <Rise><h3>Fifteen themes</h3></Rise>
        <motion.ul className="theme-row" style={{ x }}>
          {THEME_SHOTS.map(([id, name]) => (
            <li key={id}>
              <img src={files[`./shots/theme-${id}.png`]} width={520} height={356} alt={`Overview in the ${name} theme`} loading="lazy" decoding="async" />
              <p>{name}</p>
            </li>
          ))}
        </motion.ul>
      </div>

      <div className="custom-split">
        <div className="custom-looks">
          <Rise><h3>Twelve timer looks</h3></Rise>
          <Rise i={1}>
          <ul className="look-grid">
            {LOOK_SHOTS.map(([id, name]) => (
              <li key={id}>
                  <img src={files[`./shots/look-${id}.png`]} width={520} height={192} alt={`The Timer in its ${name} look`} loading="lazy" decoding="async" />
                  <p>{name}</p>
                </li>
            ))}
          </ul>
          </Rise>
        </div>
        <div className="custom-styles">
          <Rise><h3>Notch, capsule or line</h3></Rise>
          <Rise i={1}>
          <ul>
            {STYLE_SHOTS.map(([id, name, w, h]) => (
              <li key={id}>
                  <img src={files[`./shots/style-${id}.png`]} width={w} height={h} alt={`The closed ${name.toLowerCase()}`} loading="lazy" decoding="async" />
                  <p>{name}</p>
                </li>
            ))}
          </ul>
          </Rise>
        </div>
      </div>

      <Rise>
      <ul className="counts">
        {COUNTS.map((c) => (
          <li key={c.what}>
              <span className="count-n" style={{ color: c.hue }}>{c.n}</span>
              <span className="count-what">{c.what}</span>
            </li>
        ))}
      </ul>
      </Rise>
      <Rise>
        <a className="textlink" href={DEMO_FULL}>Change the theme, the look and the language in the demo <ArrowUpRight size={18} weight="bold" aria-hidden="true" /></a>
      </Rise>
    </section>
  );
}

/** Shut, the notch keeps working: the real closed row, large. */
function Closed() {
  const img = files["./shots/closed.png"];
  return (
    <section className="sec closed-sec has-waves" aria-labelledby="closed-title">
      <Waves tints={SHADE_TINTS} />
      <Rise><h2 id="closed-title">Closed, it keeps count</h2></Rise>
      <Rise i={1}>
        <p className="lead">A running timer, the song or its lyric line, AI quota rings, CPU, RAM and GPU, the network, power, battery, temperature, the clock and today's GitHub count. Notices drop over the row and leave by themselves.</p>
      </Rise>
      <Rise i={2} className="closed-strip">
        <img src={img} width={732} height={42} alt="The closed notch with the cover, a running timer, AI quota rings, CPU, memory and GPU, the equalizer, the clock and the weather" />
      </Rise>
      <Rise i={3}>
        <a className="textlink" href={DEMO_FULL}>Change its look and edge in the demo <ArrowUpRight size={18} weight="bold" aria-hidden="true" /></a>
      </Rise>
    </section>
  );
}

export default function Home() {
  return (
    <div id="top" style={{ ["--y" as string]: LOGO.yellow }}>
      <a className="skip" href="#band-title">Skip to the content</a>
      <StickyBar />
      <main>
        <Hero />
        <ToolBand />
        <Catalog />
        <Closed />
        <Bar />
        <Custom />
        <News release={RELEASE} />
        <Make />
        <Privacy />
        <Install />
        <Faq />
        <Closing />
      </main>
      <Footer />
    </div>
  );
}
