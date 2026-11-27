import { useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { ArrowUpRight } from "./icons";
import { FILM, HAS_FILM, HIGHLIGHTS } from "./release";
import { Rise } from "./Sections";

/**
 * The release's film, muted and looping, with its poster; nothing at all until both files are in public/media. It loads only once
 * played (autoplay would fetch the whole file on every visit), and plays while in view unless motion is reduced.
 */
export function Film() {
  const still = useReducedMotion();
  const ref = useRef<HTMLVideoElement>(null);
  const seen = useInView(ref, { amount: 0.5 });
  useEffect(() => {
    const v = ref.current;
    if (!v || still) return;
    if (seen) v.play().catch(() => {});
    else v.pause();
  }, [seen, still]);
  if (!HAS_FILM) return null;
  return (
    <Rise className="film">
      <figure>
        <video ref={ref} src={FILM.src} poster={FILM.poster} width={FILM.width} height={FILM.height} muted loop playsInline controls preload="none" />
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
              {h.link ? (
                <a className="textlink" href={h.link.href}>
                  {h.link.label} <ArrowUpRight size={16} weight="bold" aria-hidden="true" />
                </a>
              ) : h.demo !== false && (
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
