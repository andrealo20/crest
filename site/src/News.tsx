import { ArrowUpRight } from "./icons";
import { HIGHLIGHTS } from "./release";
import { Rise } from "./Sections";

/** The latest release, one row per highlight: the title in its colour, what it does, and where the demo shows it. */
export function Highlights({ base = "/try/" }: { base?: string }) {
  return (
    <ul className="highlights">
      {HIGHLIGHTS.map((h, i) => (
        <li key={h.title} style={{ ["--hue" as string]: h.hue }}>
          <Rise i={i % 2} className="highlight">
            <h3>{h.title}</h3>
            <div className="highlight-body">
              <p>{h.text}</p>
              {h.demo !== false && (
                <a className="textlink" href={`${base}#${h.chapter}`}>
                  Try it in the demo <ArrowUpRight size={16} weight="bold" aria-hidden="true" />
                </a>
              )}
            </div>
          </Rise>
        </li>
      ))}
    </ul>
  );
}

export function News({ release }: { release: string }) {
  return (
    <section id="new" className="sec news" aria-labelledby="new-title">
      <div className="news-head">
        <Rise><h2 id="new-title">New in Crest {release}</h2></Rise>
        <Rise i={1} className="news-more">
          <a className="textlink" href="/whats-new/">Every change, version by version <ArrowUpRight size={18} weight="bold" aria-hidden="true" /></a>
        </Rise>
      </div>
      <Highlights />
    </section>
  );
}
