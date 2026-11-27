import { useState } from "react";
import { num, type Stats, useStats } from "../live";
import { mount, Page } from "../Page";
import { REPO, Rise } from "../Sections";
import { ArrowUpRight } from "../icons";

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
const dayName = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

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

/** The last 30 daily totals as bars, today last, with the figure of the bar under the pointer; the table says the same to a screen reader. */
function Days({ days }: { days: Stats["days"] }) {
  const [at, setAt] = useState(days.length - 1);
  const top = Math.max(1, ...days.map((d) => d.n));
  const W = 600, H = 160, gap = 2, bw = W / days.length - gap;
  const d = days[at];
  return (
    <figure className="days">
      <figcaption>
        <strong>{num(d.n)}</strong> on {dayName(d.day)}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Computers that ran Crest on each of the last 30 days" onMouseLeave={() => setAt(days.length - 1)}>
        {days.map((x, i) => {
          const h = Math.max(x.n ? 4 : 0, (x.n / top) * (H - 4));
          return (
            <g key={x.day} onMouseEnter={() => setAt(i)}>
              <rect x={i * (bw + gap)} y={0} width={bw + gap} height={H} fill="transparent" />
              <rect x={i * (bw + gap)} y={H - h} width={bw} height={h} rx={Math.min(4, bw / 2)} className={i === at ? "day on" : "day"} />
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>Computers that ran Crest, by day</caption>
        <tbody>
          {days.map((x) => (
            <tr key={x.day}>
              <th scope="row">{dayName(x.day)}</th>
              <td>{x.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function Today() {
  const s = useStats();
  if (s === undefined) return <p className="lead">Reading today's count…</p>;
  if (s === null || s.days.every((d) => d.n === 0))
    return (
      <p className="lead">
        Nothing counted yet. The count starts with the version of Crest that brings it, and the numbers show here once the first computers have counted themselves.
      </p>
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
      <Days days={s.days} />
      <div className="share-grid">
        <Shares title="Where" rows={Object.entries(t.country).map(([k, n]) => [country(k), n])} total={t.total} limit={10} />
        <Shares title="System" rows={Object.entries(t.platform).map(([k, n]) => [PLATFORMS[k] ?? k, n])} total={t.total} />
        <Shares title="Installed from" rows={Object.entries(t.channel).map(([k, n]) => [CHANNELS[k] ?? k, n])} total={t.total} />
        <Shares title="Version" rows={Object.entries(t.version)} total={t.total} limit={6} />
      </div>
    </>
  );
}

function Downloads() {
  const d = __SITE_DOWNLOADS__;
  if (!d) return <p className="lead">The download total could not be read from GitHub when this page was built.</p>;
  return (
    <div className="today">
      <p className="today-n">{num(d.total)}</p>
      <p className="today-what">downloads from GitHub, every file of every release, as of {new Date(d.read).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.</p>
    </div>
  );
}

function StatsPage() {
  return (
    <Page color="#bfe03a" title="Stats" lead="How many computers run Crest today, where and on which version, live from the daily count.">
      <section className="sec stats" aria-labelledby="today-title">
        <Rise><h2 id="today-title">Today</h2></Rise>
        <Today />
      </section>
      <section className="sec stats" aria-labelledby="downloads-title">
        <Rise><h2 id="downloads-title">Downloads</h2></Rise>
        <Downloads />
        <p className="body stats-note">
          The same total as the README's badge, updates included. The Microsoft Store keeps its own figures, which are not public.{" "}
          <a className="textlink" href={`${REPO}/releases`}>Every release <ArrowUpRight size={16} weight="bold" aria-hidden="true" /></a>
        </p>
      </section>
      <section className="sec prose" aria-labelledby="how-title">
        <h2 id="how-title">How the count works</h2>
        <p>
          Once a day, each copy of Crest sends one request with three things: its version, whether it runs on Windows or a Mac, and whether it came from the Microsoft Store, the installer or the portable zip. There is no ID, so two requests from the same computer cannot be told apart, and nothing about you, your files or your settings.
        </p>
        <p>
          Cloudflare, which serves this site, tells the counter which country a request came from. The address itself is not stored or logged. Each day's countries, systems and versions are deleted just after midnight UTC; only that day's total stays, for the line of the last 30 days.
        </p>
        <p>
          To leave the count, turn it off in Crest's Settings. The code of the counter is in the repository, in <a href={`${REPO}/tree/main/site/stats-worker`}>site/stats-worker</a>.
        </p>
      </section>
    </Page>
  );
}

mount(<StatsPage />);
