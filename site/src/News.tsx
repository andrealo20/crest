import { useReducedMotion } from "motion/react";
import { ArrowUpRight } from "./icons";
import { FILM, HAS_FILM, HIGHLIGHTS } from "./release";
import { Rise } from "./Sections";

/** The release's film, muted and looping, with its poster; nothing at all until both files are in public/media. */
export function Film() {
  const still = useReducedMotion();
  if (!HAS_FILM) return null;
  return (
    <Rise className="film">
      <figure>
        <video src={FILM.src} poster={FILM.poster} width={1920} height={1080} muted loop playsInline controls autoPlay={!still} preload={still ? "none" : "metadata"} aria-label={FILM.caption} />
        <figcaption>{FILM.caption}</figcaption>
      </figure>
    </Rise>
  );
}

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
      <Film />
      <Highlights />
    </section>
  );
}
