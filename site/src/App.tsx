import { useEffect, useRef, useState } from "react";
import { CHAPTERS, HUE, LOGO, TOOLS, TOOL_BAR } from "./data";
import { useDemo } from "./demo";
import { Stage, Wash } from "./Stage";
import { ChapterCard } from "./Chapter";
import { Faq, Footer, Install, Make, Nav, Privacy, REPO, Rise } from "./Sections";

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
    // Back at the headline, the page has its first colour again.
    const top = new IntersectionObserver(([e]) => e.isIntersecting && setActive(null), { threshold: 1 });
    const h1 = root.current?.querySelector("h1");
    if (h1) top.observe(h1);
    return () => (io.disconnect(), top.disconnect());
  }, []);

  // A closed notch shows no tool, so no tool button is pressed.
  const shown = demo.open ? demo.tool : "";

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
                  Crest is a free, open source Dynamic Island for Windows and macOS. The notch on this page is the real app, running here on sample data. Open it and try every tool.
                </p>
              </Rise>
              <Rise i={1} className="actions">
                <a className="btn" href="#install">Get Crest</a>
                <a className="textlink" href="#overview">Try each tool, one by one</a>
              </Rise>
            </div>

            <aside className="stage-col" aria-label="Live demo" ref={stageCol}>
              <a className="skip skip-demo" href="#chapters">Skip the demo and go to the chapters</a>
              <Stage frame={demo.frame} tool={demo.tool} open={demo.open} size={demo.size} edge={demo.state.edge} pet={demo.state.pet !== null} onLoad={demo.onLoad} onOpen={() => demo.send({ cmd: "open" })} />
            </aside>

            <div className="intro">
              <Rise i={2}>
                <div className="toolbar" role="group" aria-label="Jump the demo to a tool">
                  {TOOL_BAR.map((id) => {
                    const t = TOOLS[id];
                    const Icon = t.icon;
                    return (
                      <button key={id} className="tb" aria-label={t.label} aria-pressed={shown === id} title={t.label} onClick={() => jump(id)}>
                        <Icon size={22} weight="bold" style={{ color: HUE[t.hue] }} aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              </Rise>
            </div>

            <div className="chapters" id="chapters">
              {CHAPTERS.map((c) => (
                <ChapterCard key={c.id} chapter={c} active={active === c.id} tool={shown} state={demo.state} patch={demo.patch} send={demo.send} setTool={demo.setTool} onUse={showStage} />
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
      </div>
  );
}
