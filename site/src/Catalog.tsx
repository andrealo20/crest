import { DEMO_FULL } from "./demo";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { CATALOG, type Entry } from "./features";
import { TOOLS } from "./data";
import { ArrowUpRight } from "./icons";
import { Rise } from "./Sections";
import { useWide } from "./wide";
import { SHADE_TINTS, Waves } from "./Waves";

const shots = import.meta.glob("./shots/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

/** What the panel shows for one entry: its picture, or failing that its tool's icon on the group's colour, then the words. */
function Card({ e, hue }: { e: Entry; hue: string }) {
  const src = e.shot ? shots[`./shots/${e.shot}.png`] : e.img;
  const Icon = TOOLS[e.tool ?? ""]?.icon;
  return (
    <>
      <div className="cat-pic" style={{ background: src ? "#000" : hue }}>
        {src ? (
          <img src={src} width={e.w} height={e.h} alt={e.alt ?? ""} loading="lazy" decoding="async" />
        ) : Icon ? (
          <Icon size={160} weight="bold" aria-hidden="true" />
        ) : (
          <span className="cat-word" aria-hidden="true">{e.name}</span>
        )}
      </div>
      <h3>{e.name}</h3>
      <p className="cat-notes">
        {[e.fresh && `New in ${e.fresh}`, e.win && "Windows only", e.noStore && "Not in the Microsoft Store version for now"].filter(Boolean).join(". ")}
      </p>
      <p>{e.text}</p>
      {e.demo && (
        <a className="textlink" href={DEMO_FULL}>
          Try it in the browser <ArrowUpRight size={18} weight="bold" aria-hidden="true" />
        </a>
      )}
    </>
  );
}

/**
 * Every feature, grouped: the names on the left, the chosen one large on the right. On a phone the chosen one opens under its name.
 * Every entry is a real button, so the list works from the keyboard in reading order.
 */
export function Catalog() {
  const wide = useWide();
  const reduce = useReducedMotion();
  const [pick, setPick] = useState("A taskbar of its own");
  const all = CATALOG.flatMap((g) => g.entries.map((e) => ({ e, hue: g.hue })));
  const chosen = all.find((x) => x.e.name === pick) ?? all[0];
  const panel = (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={chosen.e.name}
        className="cat-card"
        initial={reduce ? false : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduce ? undefined : { opacity: 0, y: -10 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      >
        <Card e={chosen.e} hue={chosen.hue} />
      </motion.div>
    </AnimatePresence>
  );
  return (
    <section id="features" className="sec catalog has-waves" style={{ background: chosen.hue }} aria-labelledby="features-title">
      <Waves tints={SHADE_TINTS} />
      <div className="cat-head">
        <Rise><h2 id="features-title">Everything it does</h2></Rise>
        <Rise i={1}>
          <p className="lead">Each tool and part of the bar can be turned on or off and put in the order you like. Pick a name to see it.</p>
        </Rise>
      </div>
      <div className="cat-body">
        <div className="cat-list">
          {CATALOG.map((g) => (
            <div key={g.name} className="cat-group" style={{ ["--hue" as string]: g.hue }}>
              <h3 className="cat-group-name">{g.name}</h3>
              <ul>
                {g.entries.map((e) => {
                  const on = e.name === chosen.e.name;
                  return (
                    <li key={e.name}>
                      <button type="button" className="cat-name" aria-pressed={on} aria-controls={wide ? "cat-panel" : undefined} onClick={() => setPick(e.name)}>
                        {e.name}
                        {e.fresh && <span className="cat-fresh">New</span>}
                      </button>
                      {!wide && on && <div className="cat-inline" aria-live="polite">{panel}</div>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        {wide && (
          <div id="cat-panel" className="cat-panel" aria-live="polite">
            {panel}
          </div>
        )}
      </div>
    </section>
  );
}
