import iconPng from "../../../assets/logo/crest-icon-1024.png?url";
import iconSvg from "../../../assets/logo/crest-icon.svg?url";
import markSvg from "../../../assets/logo/crest-mark.svg?url";
import markMono from "../../../assets/logo/crest-mark-mono.svg?url";
import { DownloadSimple } from "../icons";
import { mount, Page } from "../Page";
import { REPO, SITE, STORE, SUPPORT } from "../Sections";

// The README's own screenshots (docs/media/features), so the press kit never drifts from them. Only the ones in SHOTS are listed,
// since the glob decides which files the build copies.
const shots = import.meta.glob("../../../docs/media/features/{overview,now-playing,timer,clipboard,converter,ask,hardware,calendar-join,weather,capture,settings-themes,closed-notch}.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const shot = (name: string) => shots[`../../../docs/media/features/${name}.png`];

const SHOTS: [string, string][] = [
  ["overview", "Overview with the time, the weather, the song playing and quick controls"],
  ["now-playing", "Now Playing with the cover, synced lyrics and the playback controls"],
  ["timer", "The focus timer with big pixel digits"],
  ["clipboard", "The clipboard history with text, links and images"],
  ["converter", "The Converter turning one currency into another"],
  ["ask", "Ask, a chat with the AI provider you pick"],
  ["hardware", "Hardware with CPU, GPU, memory and network graphs"],
  ["calendar-join", "The Calendar agenda with a Join button on an event"],
  ["weather", "The weather with an hourly strip and seven days"],
  ["capture", "Capture, for screenshots and screen recordings"],
  ["settings-themes", "Settings, Themes with the built-in themes"],
  ["closed-notch", "The closed notch with a timer, AI quota, hardware readings and the clock"],
];

const LOGOS: { name: string; file: string; href: string; dark?: boolean }[] = [
  { name: "App icon, PNG 1024 px", file: "crest-icon-1024.png", href: iconPng },
  { name: "App icon, SVG", file: "crest-icon.svg", href: iconSvg },
  { name: "Mark in colour, SVG", file: "crest-mark.svg", href: markSvg, dark: true },
  { name: "Mark in one colour, SVG", file: "crest-mark-mono.svg", href: markMono, dark: true },
];

const FACTS: [string, React.ReactNode][] = [
  ["Name", "Crest. On the Microsoft Store it is called Crest Island."],
  ["Made by", "Andrea Loroni, an independent developer."],
  ["Price", "Free, with no ads, no paid tier and no account."],
  ["Licence", <>Open source under the GPL-3.0, <a href={REPO}>code on GitHub</a>.</>],
  ["Runs on", "Windows 11 and 10 on x64 and ARM, and macOS 12 or later as a preview."],
  ["Get it", <><a href={STORE}>Microsoft Store</a>, or the installer and portable zip from <a href={`${REPO}/releases/latest`}>GitHub</a>.</>],
  ["Contact", <a href={`mailto:${SUPPORT}`}>{SUPPORT}</a>],
];

function Press() {
  return (
    <Page color="#ff9a4d" title="Press kit" lead="The logo, screenshots and facts about Crest, free to use when you write about it.">
      <section className="sec prose" aria-labelledby="about-title">
        <h2 id="about-title">About Crest</h2>
        <p className="lead">
          Crest is a free, open source Dynamic Island for Windows and macOS. It sits at the top of the screen as a small notch and opens into a panel with music and synced lyrics, a timer, to-dos, notes, the clipboard history, a converter, screenshots and recordings, hardware readings, an AI chat and more than twenty other tools. Scripts can post notices to it, and plugins add tools of their own. Everything stays on the computer: no account, no server, no tracking.
        </p>
        <p>Short version: Crest puts a Dynamic Island on your Windows or Mac screen, with more than thirty tools and no account.</p>
        <dl className="press-facts">
          {FACTS.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="sec press-logos" aria-labelledby="logo-title">
        <h2 id="logo-title">Logo</h2>
        <p className="body">Use the logo as it is: no other colours, no effects, no changes to its shape. Give it room around it.</p>
        <ul className="logo-grid">
          {LOGOS.map((l) => (
            <li key={l.file} className={l.dark ? "on-dark" : undefined}>
              <img src={l.href} alt="" width={120} height={120} />
              <a className="textlink" href={l.href} download={l.file}>
                <DownloadSimple size={18} weight="bold" aria-hidden="true" /> {l.name}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="sec press-shots" aria-labelledby="shots-title">
        <h2 id="shots-title">Screenshots</h2>
        <p className="body">Taken from the app at 1x on Windows 11. Click one for the full file. The live demo at <a href={SITE}>{SITE.replace("https://", "")}</a> lets readers try every tool themselves.</p>
        <ul className="shot-grid">
          {SHOTS.map(([name, alt]) => (
            <li key={name}>
              <a href={shot(name)} download={`crest-${name}.png`}>
                <img src={shot(name)} alt={alt} loading="lazy" decoding="async" />
              </a>
              <p>{alt}</p>
            </li>
          ))}
        </ul>
      </section>
    </Page>
  );
}

mount(<Press />);
