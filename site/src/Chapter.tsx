import { useRef, useState } from "react";
import { GearSix, HandWaving, Gift, Pause, Play } from "./icons";
import { type Chapter, EDGES, ENGINES, HUE, LANGS, NOTICES, PETS, SCALES, STYLES, THEMES, TOOLS } from "./data";
import type { DemoMessage, DemoState } from "./demo";
import { useRise } from "./rise";

interface Props {
  chapter: Chapter;
  active: boolean;
  tool: string;
  state: DemoState;
  patch: (p: Partial<DemoState>) => void;
  send: (m: DemoMessage) => void;
  setTool: (t: string) => void;
  onUse: () => void;
}

/** Perceived brightness of a #rrggbb colour, to pick black or white text on it. */
const isLight = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150;
};

export function ChapterCard({ chapter: c, active, tool, state, patch, send, setTool, onUse }: Props) {
  const [notice, setNotice] = useState("");
  // On a narrow screen the text is cut to a few lines until the visitor asks for the rest (CSS decides when it applies).
  const [more, setMore] = useState(false);
  const [rise, seen] = useRise<HTMLElement>();
  const timer = useRef<number | undefined>(undefined);

  const go = (id: string) => {
    setTool(id);
    send({ cmd: "navigate", tool: id });
  };
  // Play and Pause only show on Now Playing, so the visitor is taken there first.
  const playback = (cmd: "play" | "pause") => {
    setTool("media");
    send({ cmd: "navigate", tool: "media" });
    send({ cmd });
  };
  const fire = (kind: string) => {
    setNotice(kind);
    send({ cmd: "close" });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => send({ cmd: "notice", kind }), 260);
  };

  return (
    <article
      ref={rise}
      id={c.id}
      data-chapter={c.id}
      className={`chapter rise${seen ? " in" : ""}${active ? " is-active" : ""}${more ? " is-more" : ""}`}
      aria-labelledby={`${c.id}-title`}
      style={{ ["--hue" as string]: HUE[c.hue] }}
      onClickCapture={(e) => { if ((e.target as HTMLElement).closest("button:not(.read-more)")) onUse(); }}
    >
      <h2 id={`${c.id}-title`}>{c.title}</h2>
      <p className="body" id={`${c.id}-body`}>{c.text}</p>
      <button type="button" className="read-more" aria-expanded={more} aria-controls={`${c.id}-body`} onClick={() => setMore(!more)}>
        {more ? "Show less" : "Read more"}
      </button>
      {c.next && <p className="next">{c.next}</p>}

      {c.image && <img className="shot" src={c.image.src} alt={c.image.alt} width={c.image.w} height={c.image.h} loading="lazy" decoding="async" />}

      {c.controls?.includes("styles") && (
        <Group label="Closed look">
          {STYLES.map((s) => (
            <button key={s.id} className="chip" aria-pressed={state.style === s.id} onClick={() => { patch({ style: s.id }); send({ cmd: "style", style: s.id }); send({ cmd: "close" }); }}>
              {s.label}
            </button>
          ))}
        </Group>
      )}
      {c.controls?.includes("edges") && (
        <Group label="Screen edge">
          {EDGES.map((s) => (
            <button key={s.id} className="chip" aria-pressed={state.edge === s.id} onClick={() => { patch({ edge: s.id }); send({ cmd: "edge", edge: s.id }); send({ cmd: "close" }); }}>
              {s.label}
            </button>
          ))}
        </Group>
      )}
      {c.controls?.includes("notices") && (
        <Group label="Show a notice">
          {NOTICES.map((n) => (
            <button key={n.kind} className="chip" aria-pressed={notice === n.kind} onClick={() => fire(n.kind)}>
              {n.label}
            </button>
          ))}
        </Group>
      )}
      {c.controls?.includes("play") && (
        <Group label="Playback">
          <button className="chip" onClick={() => playback("play")}><Play size={18} weight="fill" aria-hidden="true" /> Play</button>
          <button className="chip" onClick={() => playback("pause")}><Pause size={18} weight="fill" aria-hidden="true" /> Pause</button>
        </Group>
      )}
      {c.controls?.includes("cover") && (
        <Group label="Cover behind the panel">
          {[true, false].map((on) => (
            <button key={String(on)} className="chip" aria-pressed={state.cover === on} onClick={() => { patch({ cover: on }); go("media"); send({ cmd: "cover", on }); }}>
              {on ? "On" : "Off"}
            </button>
          ))}
        </Group>
      )}
      {c.controls?.includes("search") && (
        <Group label="Web search line">
          {ENGINES.map((e) => (
            <button key={e.id} className="chip" aria-pressed={state.search === e.id} onClick={() => { patch({ search: e.id }); go("overview"); send({ cmd: "search", engine: e.id }); }}>
              {e.label}
            </button>
          ))}
        </Group>
      )}
      {c.controls?.includes("scale") && (
        <Group label="Panel scale">
          {SCALES.map((v) => (
            <button key={v} className="chip" aria-pressed={state.scale === v} onClick={() => { patch({ scale: v }); send({ cmd: "scale", value: v }); send({ cmd: "open" }); }}>
              {v} %
            </button>
          ))}
        </Group>
      )}
      {c.controls?.includes("themes") && (
        <Group label="Theme">
          {THEMES.map(([id, name, bg, accent]) => (
            <button
              key={id}
              className="chip theme-chip"
              aria-pressed={state.theme === id}
              style={{ background: bg, color: isLight(bg) ? "#111" : "#fff" }}
              onClick={() => { patch({ theme: id }); send({ cmd: "theme", id }); send({ cmd: "navigate", tool: "overview" }); setTool("overview"); }}
            >
              <span className="swatch" style={{ background: accent }} aria-hidden="true" />
              {name}
            </button>
          ))}
        </Group>
      )}
      {c.controls?.includes("langs") && (
        <Group label="Language">
          {LANGS.map((l) => (
            <button key={l.code} className="chip" lang={l.code} aria-pressed={state.lang === l.code} onClick={() => { patch({ lang: l.code }); send({ cmd: "lang", code: l.code }); send({ cmd: "open" }); }}>
              {l.label}
            </button>
          ))}
        </Group>
      )}
      {c.controls?.includes("pets") && (
        <Group label="Pets">
          {PETS.map((p) => (
            <button key={p.id} className="chip" aria-pressed={state.pet === p.id} onClick={() => { patch({ pet: p.id }); send({ cmd: "close" }); send({ cmd: "pet", on: true, kind: p.id }); }}>
              {p.label}
            </button>
          ))}
          <button className="chip" aria-pressed={state.pet === null} onClick={() => { patch({ pet: null }); send({ cmd: "pet", on: false }); }}>
            No pet
          </button>
        </Group>
      )}
      {c.controls?.includes("pages") && (
        <Group label="Open a page">
          <button className="chip" aria-pressed={tool === "setup"} onClick={() => go("setup")}><HandWaving size={18} weight="bold" aria-hidden="true" style={{ color: HUE.amber }} /> First-run setup</button>
          <button className="chip" aria-pressed={tool === "settings"} onClick={() => go("settings")}><GearSix size={18} weight="bold" aria-hidden="true" style={{ color: HUE.slate }} /> Settings</button>
          <button className="chip" aria-pressed={tool === "whatsnew"} onClick={() => go("whatsnew")}><Gift size={18} weight="bold" aria-hidden="true" style={{ color: HUE.pink }} /> What's new</button>
        </Group>
      )}
      {c.tools && (
        <Group label={c.id === "notices" ? "Open the history" : "Try a tool"}>
          {c.tools.map((id) => {
            const t = TOOLS[id];
            const Icon = t.icon;
            return (
              <button key={id} className="chip tool-chip" aria-pressed={tool === id} onClick={() => go(id)}>
                <Icon size={20} weight="bold" aria-hidden="true" style={{ color: HUE[t.hue] }} />
                {t.label}
              </button>
            );
          })}
        </Group>
      )}
      {c.note && <p className="note">{c.note}</p>}
    </article>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="group" role="group" aria-label={label}>
      <p className="group-label">{label}</p>
      <div className="chips">{children}</div>
    </div>
  );
}
