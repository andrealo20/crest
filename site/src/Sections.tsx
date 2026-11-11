import { useEffect, useState } from "react";
import { useRise } from "./rise";
import { ArrowUpRight, GithubLogo } from "./icons";
import { FAQ, HUE, LOGO, NOTIFY_ASK, NOTIFY_CODE, NOTIFY_PART, PLUGIN_JSON } from "./data";
import { RELEASE } from "./release";

export const REPO = "https://github.com/andrealo20/crest";
export const RELEASES = "https://github.com/andrealo20/crest/releases/latest";
export const STORE = "https://apps.microsoft.com/detail/9N2KXJ2924KS";
export const SITE = "https://crestisland.app";
export const SUPPORT = "support@crestisland.app";

/** A part of a section that rises into place once, `i` steps after its neighbours. */
export function Rise({ children, i = 0, className }: { children: React.ReactNode; i?: number; className?: string }) {
  const [ref, seen] = useRise<HTMLDivElement>();
  return (
    <div ref={ref} className={`rise${seen ? " in" : ""}${className ? ` ${className}` : ""}`} style={{ transitionDelay: `${i * 70}ms` }}>
      {children}
    </div>
  );
}

const COLORED: Record<string, string> = {
  "1,0": LOGO.yellow, "2,0": LOGO.yellow, "3,0": LOGO.yellow,
  "0,1": LOGO.orange, "0,2": LOGO.red, "0,3": LOGO.pink,
  "1,4": LOGO.purple, "2,4": LOGO.purple, "3,4": LOGO.purple,
};

/** The Crest icon (assets/logo/crest-icon.svg): a C of rounded squares on a dark tile, which builds itself square by square. */
export function Mark({ size = 40, animate = true }: { size?: number; animate?: boolean }) {
  const cells: [number, number][] = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) cells.push([c, r]);
  let n = 0;
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true" className={animate ? "mark mark-build" : "mark"}>
      <rect width="1024" height="1024" rx="230" fill="#0f1015" />
      {cells.map(([c, r]) => {
        const fill = COLORED[`${c},${r}`];
        return (
          <rect key={`${c}${r}`} x={233 + c * 146} y={160 + r * 146} width={120} height={120} rx={28.8} fill={fill ?? "#20222b"} style={fill ? { animationDelay: `${0.1 + 0.05 * n++}s` } : undefined} className={fill ? "lit" : undefined} />
        );
      })}
    </svg>
  );
}

export function Nav() {
  return (
    <header className="nav">
      <a className="brand" href="/" aria-label="Crest, home">
        <Mark size={40} />
        <span>Crest</span>
      </a>
      <nav aria-label="Main">
        <a className="nav-link nav-new" href="/whats-new/">What's new</a>
        <a className="nav-link nav-plugins" href="/#plugins">Plugins</a>
        <a className="nav-link nav-privacy" href="/privacy/">Privacy</a>
        <a className="btn btn-small btn-light nav-try" href="/try/">Try it</a>
        <a className="btn btn-small" href="/#install">Get Crest</a>
      </nav>
    </header>
  );
}

/** Scripts and plugins: two halves of one section, each on its own ground. */
export function Make() {
  return (
    <section className="make" aria-label="Scripts and plugins">
      <div id="notify" className="half half-notify" role="region" aria-labelledby="notify-title">
        <Rise><h2 id="notify-title">Scripts can talk to your notch</h2></Rise>
        <Rise i={1}>
          <p className="lead">
            <code>crest-notify</code> is a small command line program that installs next to Crest. A build, a script or a coding agent uses it to show a notice, put a part of its own in the closed row, or ask you a question and get your answer back.
          </p>
        </Rise>
        <Rise className="codes" i={2}>
          <pre tabIndex={0} aria-label="crest-notify: notices and run"><code>{NOTIFY_CODE}</code></pre>
          <pre tabIndex={0} aria-label="crest-notify: a part in the closed row"><code>{NOTIFY_PART}</code></pre>
          <pre tabIndex={0} aria-label="crest-notify: ask a question"><code>{NOTIFY_ASK}</code></pre>
        </Rise>
        <Rise i={3}>
          <p className="body">
            A notice can replace itself and carry a progress ring. <code>run</code> reports the exit code and how long a command took. <code>ask</code> shows up to four buttons and falls back to the terminal prompt when nobody answers. Windows notifications from any app can show in the notch too, with a rule for each app and quiet hours.
          </p>
        </Rise>
        <Rise i={4}>
          <a className="textlink" href={`${REPO}/blob/main/docs/notices.md`}>Read the notices guide <ArrowUpRight size={18} weight="bold" aria-hidden="true" /></a>
        </Rise>
      </div>
      <div id="plugins" className="half half-plugins" role="region" aria-labelledby="plugins-title">
        <Rise><h2 id="plugins-title">Your own tools, sandboxed</h2></Rise>
        <Rise i={1}>
          <p className="lead">A plugin is a folder of HTML, CSS and JavaScript with a <code>crest-plugin.json</code>. Install it from Settings and it becomes a tool with its own icon in the tool bar.</p>
        </Rise>
        <Rise className="codes" i={2}>
          <pre tabIndex={0} aria-label="A crest-plugin.json file"><code>{PLUGIN_JSON}</code></pre>
        </Rise>
        <Rise i={3}>
          <p className="body">Before anything is installed, Crest lists what the plugin asks for: the addresses it may fetch from, its own storage, and notices in the closed notch. It cannot read your files, keys, vault, clipboard or settings. Its page runs in a sandboxed frame with no network of its own, so Crest fetches for it, over https, from the hosts it declared.</p>
        </Rise>
        <Rise i={4}>
          <a className="textlink" href={`${REPO}/blob/main/docs/plugins.md`}>Read the plugin guide <ArrowUpRight size={18} weight="bold" aria-hidden="true" /></a>
        </Rise>
      </div>
    </section>
  );
}

const FACTS: [string, string][] = [
  ["Accounts", "None. Crest has no server of its own and nothing is sent to the developer."],
  ["Tracking", "No analytics, no telemetry, no tracking."],
  ["Your keys", "In the Windows Credential Manager (the Keychain on a Mac), never in a plain file."],
  ["The vault", "Encrypted with Windows DPAPI under your account, and sealed again with a key from your PC's security chip when Windows Hello is on."],
  ["The clipboard", "History is kept in memory only. Password managers are left out on purpose."],
  ["The network", "On by default: the weather in Overview, the update check every 4 hours and the AI usage rings. Currency rates, lyrics, your AI provider and the rest only after you set them up. Each request goes straight from your PC to that service."],
];

/** What this page and the demo frame inside it have fetched so far, read from the browser's own resource timings. */
function useRequests() {
  const [seen, setSeen] = useState<{ count: number; others: string[] }>({ count: 0, others: [] });
  useEffect(() => {
    const read = () => {
      const entries: PerformanceEntry[] = [...performance.getEntriesByType("navigation"), ...performance.getEntriesByType("resource")];
      const frame = document.querySelector("iframe");
      try {
        const inner = frame?.contentWindow?.performance;
        if (inner) entries.push(...inner.getEntriesByType("navigation"), ...inner.getEntriesByType("resource"));
      } catch {
        // a frame on another address (the dev server) cannot be read
      }
      const others = new Set<string>();
      for (const e of entries) {
        try {
          const o = new URL(e.name).origin;
          if (o !== location.origin && o !== "null") others.add(o);
        } catch {
          // not a URL
        }
      }
      // The same numbers keep the same state, so nothing renders.
      setSeen((s) => (s.count === entries.length && s.others.join() === [...others].join() ? s : { count: entries.length, others: [...others] }));
    };
    read();
    const id = window.setInterval(read, 2500);
    return () => window.clearInterval(id);
  }, []);
  return seen;
}

export function Privacy() {
  const seen = useRequests();
  return (
    <section id="privacy" className="sec privacy" aria-labelledby="privacy-title">
      <Rise><h2 id="privacy-title">It all stays on your PC</h2></Rise>
      <div className="privacy-row">
        <div className="copy">
          <Rise i={1}>
            <p className="lead">Your settings, notes, to-dos and clipboard live on your machine. This page follows the same rule: its fonts, its scripts and the demo above are served from this address, with no trackers and no requests to anyone else.</p>
          </Rise>
        </div>
        <Rise className="counter" i={1}>
          <p className="count" aria-live="off">{seen.count}</p>
          <p className="count-text">
            {seen.others.length === 0
              ? `files fetched by this page and its demo so far, every one from ${location.host}. Nothing else was contacted.`
              : `files fetched so far, including from ${seen.others.join(", ")}.`}
          </p>
          <a className="textlink" href="/privacy/">What Crest itself sends over the network, and when <ArrowUpRight size={18} weight="bold" aria-hidden="true" /></a>
        </Rise>
      </div>
      <dl className="facts">
        {FACTS.map(([k, v], i) => (
          <Rise key={k} i={i % 3}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </Rise>
        ))}
      </dl>
    </section>
  );
}

/** A zigzag bottom edge for the install sheet, as a clip-path with `n` teeth. */
const zigzag = (n: number) => {
  const pts = ["0 0", "100% 0"];
  for (let i = n; i >= 0; i--) pts.push(`${((i / n) * 100).toFixed(2)}% ${i % 2 === 0 ? "calc(100% - 14px)" : "100%"}`);
  return `polygon(${pts.join(", ")})`;
};

const WAYS: { name: string; text: string; cta: string; href: string }[] = [
  { name: "Microsoft Store", text: "Crest Island, signed by Microsoft and kept up to date by the Store.", cta: "Open the Store page", href: STORE },
  { name: "Installer", text: "Crest_x.y.z_x64-setup.exe, or the arm64 one on a Windows on ARM PC. Installs for your user only, no admin rights. Not code-signed yet, so SmartScreen may warn: More info, then Run anyway.", cta: "Latest release", href: RELEASES },
  { name: "Portable zip", text: "Crest-x.y.z-Portable-x64.zip. Unzip it anywhere you can write to and run Crest.exe. Nothing is installed and the data stays in a folder next to it.", cta: "Latest release", href: RELEASES },
  { name: "Mac, preview", text: "A .dmg for Apple silicon or Intel, macOS 12 or later. Not notarized yet, so allow it once in System Settings, Privacy & Security, Open Anyway. Some tools are Windows-only for now.", cta: "Latest release", href: RELEASES },
];

export function Install() {
  return (
    <section id="install" className="sec install" aria-labelledby="install-title">
      <div className="split">
        <div className="copy">
          <Rise><h2 id="install-title" className="giant">Get Crest</h2></Rise>
          <Rise i={1}>
            <p className="lead">Free and open source, for Windows 11 and 10 on x64 and ARM, and for macOS as a preview. Every release lists a SHA-256 checksum for each download.</p>
          </Rise>
          <Rise i={2}>
            <a className="badge" href={STORE}><img src="/img/get-it-from-microsoft-dark.svg" width={161} height={44} alt="Get it from Microsoft" /></a>
          </Rise>
          <Rise i={3}>
            <p className="body">Crest uses WebView2, and the installer fetches it if it is missing. Settings and data stay in your user profile, or in a folder next to the portable copy. Every API key stays in the Credential Manager of that PC.</p>
          </Rise>
        </div>
        <Rise className="sheet-wrap" i={1}>
          <div className="sheet" style={{ clipPath: zigzag(26) }}>
            <ul>
              {WAYS.map((w) => (
                <li key={w.name}>
                  <div className="way">
                    <h3>{w.name}</h3>
                    <p>{w.text}</p>
                  </div>
                  <a className="btn btn-light" href={w.href}>{w.cta} <ArrowUpRight size={18} weight="bold" aria-hidden="true" /></a>
                </li>
              ))}
            </ul>
          </div>
        </Rise>
      </div>
    </section>
  );
}

export function Faq() {
  const tints = [LOGO.yellow, LOGO.orange, LOGO.red, LOGO.pink, HUE.violet, HUE.emerald];
  return (
    <section id="faq" className="sec faq" aria-labelledby="faq-title">
      <div className="faq-head">
        <Rise><h2 id="faq-title">Questions, answered</h2></Rise>
        <Rise i={1} className="faq-more">
          <p className="lead">Something missing from this list? Open an issue and ask.</p>
          <a className="textlink" href={`${REPO}/issues/new/choose`}>Suggest an idea or report a bug <ArrowUpRight size={18} weight="bold" aria-hidden="true" /></a>
        </Rise>
      </div>
      <div className="cards">
        {FAQ.map((f, i) => (
          <Rise key={f.q} i={i % 3}>
            <details name="faq" open={i === 0} style={{ ["--tint" as string]: tints[i % tints.length] }}>
              <summary>
                <span className="tab">{f.tab}</span>
                <span className="q">{f.q}</span>
              </summary>
              <p>{f.a}</p>
            </details>
          </Rise>
        ))}
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="foot-top">
        <div className="places">
          <a href={REPO}><GithubLogo size={30} weight="fill" aria-hidden="true" /> Source on GitHub</a>
          <a href={`${REPO}/issues/new/choose`}>Suggest an idea</a>
          <a href="/feedback/">Report a problem</a>
          <a href="https://github.com/sponsors/andrealo20">Sponsor the project</a>
        </div>
        <div className="small-links">
          <a href={`${REPO}/blob/main/docs/features.md`}>Every feature, in detail</a>
          <a href="/whats-new/">What's new in {RELEASE}</a>
          <a href="/privacy/">Privacy policy</a>
          <a href="/press/">Press kit</a>
          <a href={`mailto:${SUPPORT}`}>{SUPPORT}</a>
          <a href={`${REPO}/blob/main/LICENSE`}>GPL-3.0 licence</a>
          <a href={`${REPO}/blob/main/CONTRIBUTING.md`}>Contributing</a>
          <a href={`${REPO}/releases`}>All releases</a>
          <a href={`${REPO}/blob/main/README.md#credits-and-licences`}>Credits and licences</a>
        </div>
      </div>
      <p className="legal">
        Crest is free software under the GPL-3.0 licence, a fork of L4-Notchbar 1.6.0 by Linux5Real, made by Andrea Loroni. It is not made, sponsored or endorsed by Microsoft or Apple. Text set in Inter and icons by Phosphor, both bundled with this page.
      </p>
      <p className="wordmark" aria-hidden="true">Crest</p>
    </footer>
  );
}
