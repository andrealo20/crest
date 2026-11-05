import { useEffect, useRef, useState } from "react";
import { MotionConfig } from "motion/react";
import { CHAPTERS, HUE, LOGO, TOOLS, TOOL_BAR } from "./data";
import { useDemo } from "./demo";
import { Stage, Wash } from "./Stage";
import { ChapterCard } from "./Chapter";
import { Faq, Footer, Install, Make, Mark, Nav, Privacy, REPO, Rise } from "./Sections";

export default function App() {
  const demo = useDemo();
  const [active, setActive] = useState<string | null>(null);
  const first = useRef(true);
  const root = useRef<HTMLDivElement>(null);
  const stageCol = useRef<HTMLElement>(null);
  // A control the visitor used: the scroll it may cause must not send the stage somewhere else.
  const lastUse = useRef(0);

  // The chapter that crosses the middle of the screen drives the stage: its colour, and its first tool.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive((e.target as HTMLElement).dataset.chapter ?? null);
      },
      { rootMargin: "-42% 0px -50% 0px" },
    );
    root.current?.querySelectorAll("[data-chapter]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const chapter = CHAPTERS.find((c) => c.id === active);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!chapter || performance.now() - lastUse.current < 1800) return;
    if (chapter.start === "close") demo.send({ cmd: "close" });
    else {
      demo.setTool(chapter.start);
      demo.send({ cmd: "navigate", tool: chapter.start });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const color = chapter ? HUE[chapter.hue] : LOGO.yellow;

  // On a narrow screen the stage is not beside the chapters: bring it into view when a control is used.
  const showStage = () => {
    lastUse.current = performance.now();
    if (window.innerWidth >= 1000) return;
    const r = stageCol.current?.getBoundingClientRect();
    if (!r || (r.top >= 0 && r.bottom <= window.innerHeight)) return;
    stageCol.current?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  const jump = (id: string) => {
    showStage();
    demo.setTool(id);
    demo.send({ cmd: "navigate", tool: id });
  };

  return (
    <MotionConfig reducedMotion="user">
      <div id="top" ref={root}>
        <a className="skip" href="#overview">Skip to the demo controls</a>
        <main>
        <section className="bench" aria-label="Try Crest" style={{ background: color }}>
          <Wash color={color} />
          <Nav />
          <div className="bench-grid">
            <h1>A notch for your screen. Try it.</h1>

            <div className="lede">
              <Rise>
                <p className="lead">
                  Crest is a free, open source Dynamic Island for Windows and macOS. The notch beside this text is the real app, running here on sample data. Open it and try every tool.
                </p>
              </Rise>
              <Rise i={1} className="actions">
                <a className="btn" href="#install">Get Crest</a>
                <a className="textlink" href="#overview">Try each tool, one by one</a>
              </Rise>
            </div>

            <div className="intro">
              <Rise i={2}>
                <div className="toolbar" role="group" aria-label="Jump the demo to a tool">
                  {TOOL_BAR.map((id) => {
                    const t = TOOLS[id];
                    const Icon = t.icon;
                    return (
                      <button key={id} className="tb" aria-label={t.label} aria-pressed={demo.tool === id} title={t.label} onClick={() => jump(id)}>
                        <Icon size={22} weight="bold" style={{ color: HUE[t.hue] }} aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              </Rise>
            </div>

            <aside className="stage-col" aria-label="Live demo" ref={stageCol}>
              <Stage frame={demo.frame} tool={demo.tool} open={demo.open} onLoad={demo.onLoad} />
            </aside>

            <div className="chapters">
              {CHAPTERS.map((c) => (
                <ChapterCard key={c.id} chapter={c} active={active === c.id} tool={demo.tool} send={demo.send} setTool={demo.setTool} onUse={showStage} />
              ))}
              <p className="more">
                Every feature in detail, with setup steps for each integration, is in the <a href={`${REPO}/blob/main/docs/features.md`}>feature guide</a>.
              </p>
            </div>
          </div>
        </section>
          <Make />
          <Privacy />
          <Install />
          <Faq />
        </main>
        <Footer />
        <noscript>
          <p className="noscript"><Mark size={20} animate={false} /> The live demo needs JavaScript. Crest itself is on GitHub: {REPO}</p>
        </noscript>
      </div>
    </MotionConfig>
  );
}
