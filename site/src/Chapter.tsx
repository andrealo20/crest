import { useRef, useState } from "react";
import { motion } from "motion/react";
import { GearSix, HandWaving, Gift, Pause, Play, PawPrint } from "@phosphor-icons/react";
import { type Chapter, EDGES, HUE, LANGS, NOTICES, STYLES, THEMES, TOOLS } from "./data";
import type { DemoMessage } from "./demo";

interface Props {
  chapter: Chapter;
  active: boolean;
  tool: string;
  send: (m: DemoMessage) => void;
  setTool: (t: string) => void;
  onUse: () => void;
}

/** Perceived brightness of a #rrggbb colour, to pick black or white text on it. */
const isLight = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150;
};

export function ChapterCard({ chapter: c, active, tool, send, setTool, onUse }: Props) {
  const [style, setStyle] = useState("notch");
  const [edge, setEdge] = useState("top");
  const [theme, setTheme] = useState("dark");
  const [lang, setLang] = useState("en");
  const [pet, setPet] = useState<boolean | null>(null);
  const [notice, setNotice] = useState("");
  const timer = useRef<number | undefined>(undefined);

  const go = (id: string) => {
    setTool(id);
    send({ cmd: "navigate", tool: id });
  };
  const fire = (kind: string) => {
    setNotice(kind);
    send({ cmd: "close" });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => send({ cmd: "notice", kind }), 260);
  };

  return (
    <motion.article
      id={c.id}
      data-chapter={c.id}
      className={`chapter${active ? " is-active" : ""}`}
      aria-labelledby={`${c.id}-title`}
      style={{ ["--hue" as string]: HUE[c.hue] }}
      onClickCapture={(e) => { if ((e.target as HTMLElement).closest("button")) onUse(); }}
      initial={{ opacity: 0.5, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={{ type: "spring", visualDuration: 0.5, bounce: 0.12 }}
    >
      <h2 id={`${c.id}-title`}>{c.title}</h2>
      <p className="body">{c.text}</p>
      {c.next && <p className="next">{c.next}</p>}

      {c.image && <img className="shot" src={c.image.src} alt={c.image.alt} width={c.image.w} height={c.image.h} loading="lazy" decoding="async" />}

      {c.controls?.includes("styles") && (
        <Group label="Closed look">
          {STYLES.map((s) => (
            <button key={s.id} className="chip" aria-pressed={style === s.id} onClick={() => { setStyle(s.id); send({ cmd: "style", style: s.id }); send({ cmd: "close" }); }}>
              {s.label}
            </button>
          ))}
        </Group>
      )}
      {c.controls?.includes("edges") && (
        <Group label="Screen edge">
          {EDGES.map((s) => (
            <button key={s.id} className="chip" aria-pressed={edge === s.id} onClick={() => { setEdge(s.id); send({ cmd: "edge", edge: s.id }); send({ cmd: "close" }); }}>
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
          <button className="chip" onClick={() => send({ cmd: "play" })}><Play size={18} weight="fill" aria-hidden="true" /> Play</button>
          <button className="chip" onClick={() => send({ cmd: "pause" })}><Pause size={18} weight="fill" aria-hidden="true" /> Pause</button>
        </Group>
      )}
      {c.controls?.includes("themes") && (
        <Group label="Theme">
          {THEMES.map(([id, name, bg, accent]) => (
            <button
              key={id}
              className="chip theme-chip"
              aria-pressed={theme === id}
              style={{ background: bg, color: isLight(bg) ? "#111" : "#fff" }}
              onClick={() => { setTheme(id); send({ cmd: "theme", id }); send({ cmd: "navigate", tool: "overview" }); setTool("overview"); }}
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
            <button key={l.code} className="chip" lang={l.code} aria-pressed={lang === l.code} onClick={() => { setLang(l.code); send({ cmd: "lang", code: l.code }); }}>
              {l.label}
            </button>
          ))}
        </Group>
      )}
      {c.controls?.includes("pets") && (
        <Group label="Pets">
          <button className="chip" aria-pressed={pet === true} onClick={() => { setPet(true); send({ cmd: "close" }); send({ cmd: "pet", on: true }); }}>
            <PawPrint size={18} weight="fill" aria-hidden="true" /> Show a pet
          </button>
          <button className="chip" aria-pressed={pet === false} onClick={() => { setPet(false); send({ cmd: "pet", on: false }); }}>
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
    </motion.article>
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
