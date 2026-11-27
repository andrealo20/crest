import { useState } from "react";
import { num, useStats } from "../live";
import { mount, Page } from "../Page";
import { REPO, Rise } from "../Sections";
import { ArrowUpRight } from "../icons";
import { MAP_HEIGHT, WORLD } from "../worldMap";

const PLATFORMS: Record<string, string> = { windows: "Windows", macos: "macOS" };
const CHANNELS: Record<string, string> = { store: "Microsoft Store", github: "Installer from GitHub", portable: "Portable zip" };
const countries = new Intl.DisplayNames(["en"], { type: "region" });
const country = (code: string) => (code === "XX" ? "Unknown" : (countries.of(code) ?? code));
// Whole percents, with one decimal under 1% so a small country does not read 0%
const pct = (n: number, of: number) => {
  if (!of) return "";
  const p = (n / of) * 100;
  return `${p >= 1 ? Math.round(p) : p.toFixed(1)}%`;
};

/** Today's countries on a world map: each one counted in the site's yellow, deeper the more computers it has, the rest faint. */
function WorldMap({ counts }: { counts: Record<string, number> }) {
  const top = Math.max(1, ...Object.values(counts));
  return (
    <figure className="world">
      <svg viewBox={`0 0 360 ${MAP_HEIGHT}`} role="img" aria-label={`Countries that ran Crest today: ${Object.keys(counts).filter((k) => k !== "XX").map(country).join(", ") || "none yet"}`}>
        {WORLD.map(([code, d]) => {
          const n = counts[code];
          return (
            <path key={code} d={d} className={n ? "world-on" : "world-off"} style={n ? { fillOpacity: 0.35 + (0.65 * n) / top } : undefined}>
              {n ? <title>{`${country(code)}: ${num(n)}`}</title> : null}
            </path>
          );
        })}
      </svg>
    </figure>
  );
}

/** One measure, each row a name, its figure and a bar filled to its share of the biggest. */
function Shares({ title, rows, total, limit }: { title: string; rows: [string, number][]; total: number; limit?: number }) {
  const [all, setAll] = useState(false);
  const sorted = [...rows].sort((a, b) => b[1] - a[1]);
  const shown = all || !limit ? sorted : sorted.slice(0, limit);
  const top = Math.max(1, ...sorted.map((r) => r[1]));
  return (
    <div className="shares">
      <h3>{title}</h3>
      <ul>
        {shown.map(([name, n]) => (
          <li key={name}>
            <span className="share-name">{name}</span>
            <span className="share-n">{num(n)} <span className="share-pct">{pct(n, total)}</span></span>
            <span className="share-bar" style={{ transform: `scaleX(${n / top})` }} aria-hidden="true" />
          </li>
        ))}
      </ul>
      {limit && sorted.length > limit && (
        <button type="button" className="textlink share-more" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? "Show fewer" : `Show all ${sorted.length}`}
        </button>
      )}
    </div>
  );
}

function Today() {
  const s = useStats();
  if (s === undefined) return <p className="lead">Reading today's count…</p>;
  // No counter answering, or nobody counted in 30 days: the live figure still shows, at zero, with when it starts
  if (s === null || s.days.every((d) => d.n === 0))
    return (
      <div className="today">
        <p className="today-n">0</p>
        <p className="today-what">
          computers counted today. Counting starts with the next release of Crest, the first to send the daily count, and this number then follows it live.
        </p>
      </div>
    );
  const t = s.today;
  return (
    <>
      <div className="today">
        <p className="today-n">{num(t.total)}</p>
        <p className="today-what">
          computers ran Crest today, {s.day} in UTC. Yesterday, {num(s.yesterday)}.
        </p>
      </div>
      <WorldMap counts={t.country} />
      <div className="share-grid">
        <Shares title="Where" rows={Object.entries(t.country).map(([k, n]) => [country(k), n])} total={t.total} limit={10} />
        <Shares title="System" rows={Object.entries(t.platform).map(([k, n]) => [PLATFORMS[k] ?? k, n])} total={t.total} />
        <Shares title="Installed from" rows={Object.entries(t.channel).map(([k, n]) => [CHANNELS[k] ?? k, n])} total={t.total} />
        <Shares title="Version" rows={Object.entries(t.version)} total={t.total} limit={6} />
      </div>
    </>
  );
}

/** The two figures in the page's green head: today's live count (zero until anyone is counted) and the README's download total. */
function HeadFigures() {
  const s = useStats();
  const d = __SITE_DOWNLOADS__;
  return (
    <>
      <span className="head-fig">
        <strong>{s === undefined ? "…" : num(s?.today.total ?? 0)}</strong> computers run Crest today, live
      </span>
      {d && (
        <span className="head-fig">
          <strong>{num(d.total)}</strong> downloads from GitHub
        </span>
      )}
    </>
  );
}

function StatsPage() {
  return (
    <Page color="#bfe03a" title="Stats" lead={<HeadFigures />}>
      <section className="sec stats" aria-labelledby="today-title">
        <Rise><h2 id="today-title">Today</h2></Rise>
        <Today />
      </section>
      <section className="sec stats" aria-labelledby="downloads-title">
        <Rise><h2 id="downloads-title">Downloads</h2></Rise>
        <p className="body stats-note">
          The figure at the top is every file of every release on GitHub, the same total as the README's badge, updates included. The Microsoft Store keeps its own figures, which are not public.{" "}
          <a className="textlink" href={`${REPO}/releases`}>Every release <ArrowUpRight size={16} weight="bold" aria-hidden="true" /></a>
        </p>
      </section>
      <section className="sec prose" aria-labelledby="how-title">
        <h2 id="how-title">How the count works</h2>
        <p>
          Once a day, each copy of Crest sends one request with three things: its version, whether it runs on Windows or a Mac, and whether it came from the Microsoft Store, the installer or the portable zip. There is no ID, so two requests from the same computer cannot be told apart, and nothing about you, your files or your settings.
        </p>
        <p>
          Cloudflare, which serves this site, tells the counter which country a request came from. The address itself is not stored or logged. Each day's countries, systems and versions are deleted just after midnight UTC; only that day's total stays.
        </p>
        <p>
          To leave the count, turn off Count this install in Crest's Settings, General, Updates. The code of the counter is in the repository, in <a href={`${REPO}/tree/main/site/stats-worker`}>site/stats-worker</a>.
        </p>
      </section>
    </Page>
  );
}

mount(<StatsPage />);
