import { useEffect, useRef, useState } from "react";
import { ArrowLineUp, Plus, X } from "@phosphor-icons/react";
import { isMac } from "../../platform/native";
import { windowShell, type HotkeyState, type RunningApp } from "../../platform/services";
import { settings } from "../../settings/store";
import { tabs, settingsTab, findTab, type NotchTab } from "../../notch/tabs";
import { Button, Group, Row, Segmented, Select, Switch, TextField } from "../../ui/controls";
import { t } from "../../i18n";
import { altGrRisk, conflicts, keycaps, record, toolConflicts, type Holder, type HotkeyKind, type RecordError } from "./hotkeys";
import { CONTEXTS, MAX_APP_RULES, addRule, newRule, ruleKey, type AppRule, type Behavior, type ScreenContext } from "./model";
import { PANEL_SCALES, currentQuick, quickSize, stepScale, type QuickSize } from "./panelSize";
import { activeToolHotkeys, hotkeyStatus, pauseHotkeys, takenByLauncher, toolHotkeyStatus, updateBehavior, usableHotkeys } from "./store";

const contextLabel: Record<ScreenContext, string> = {
  maximized: "Maximiertes Fenster",
  borderless: "Randloses Vollbild",
  exclusive: "Exklusives Vollbild",
};
const contextHint: Record<ScreenContext, string> = {
  maximized: "Ein Fenster, das den Bildschirm bis zur Taskleiste füllt",
  borderless: "Spiele, Videos und Browser im Vollbild (F11)",
  exclusive: "Spiele, die den Bildschirm für sich allein nehmen",
};
const behaviorOptions = (): { value: Behavior; label: string }[] => [
  { value: "normal", label: t("Behalten") },
  { value: "line", label: t("Linie") },
  { value: "hide", label: t("Ausblenden") },
];

/** Window rules, app rules, shortcuts, panel size and scale, mouse. */
export function WindowSettings() {
  return (
    <>
      <Rules />
      {!isMac && <AppRules />}
      <Shortcuts />
      <Panel />
      <Mouse />
    </>
  );
}

function Rules() {
  const s = settings.use();
  const r = s.behavior.rules;
  const gaming = s.gaming.mode !== "off";
  return (
    <Group title={isMac ? undefined : t("Wenn ein Fenster den Bildschirm füllt")} id="settings-window">
      {/* The window watcher behind the rules is Windows only. */}
      {!isMac && (
        <>
          {CONTEXTS.map((c) => (
            <Row key={c} label={t(contextLabel[c])} hint={gaming && c !== "maximized" ? t("Der Gaming-Modus hält Crest hier sichtbar") : t(contextHint[c])}>
              <Segmented
                id={`rule-${c}`}
                size="sm"
                value={r[c]}
                onChange={(v) => updateBehavior((b) => ({ rules: { ...b.rules, [c]: v } }))}
                options={behaviorOptions()}
              />
            </Row>
          ))}
          <Row label={t("Auch Fenster dahinter prüfen")} hint={t("Ein maximiertes oder randloses Fenster hinter dem aktiven zählt auch")}>
            <Switch label={t("Auch Fenster dahinter prüfen")} checked={r.background} onChange={(background) => updateBehavior((b) => ({ rules: { ...b.rules, background } }))} />
          </Row>
        </>
      )}
      <Row label={t("Nach vorne holen")} hint={t("Wenn ein anderes Fenster über Crest liegt")}>
        <Button icon={ArrowLineUp} onClick={windowShell.raise}>
          {t("Jetzt")}
        </Button>
      </Row>
    </Group>
  );
}

function AppRules() {
  const apps = settings.use().behavior.apps;
  const [running, setRunning] = useState<RunningApp[]>([]);
  const [pick, setPick] = useState("");
  const [typed, setTyped] = useState("");
  useEffect(() => {
    void windowShell.apps().then(setRunning);
  }, []);
  const known = new Set(apps.map(ruleKey));
  const choices = running.filter((a) => !known.has(ruleKey(a)) && !known.has(ruleKey({ name: a.name, path: "" })));
  const add = (rule: AppRule) => updateBehavior((b) => ({ apps: addRule(b.apps, rule) }));
  const full = apps.length >= MAX_APP_RULES;
  const set = (key: string, patch: Partial<AppRule>) => updateBehavior((b) => ({ apps: b.apps.map((a) => (ruleKey(a) === key ? { ...a, ...patch } : a)) }));
  const options = [{ value: "follow", label: t("Wie oben") }, ...behaviorOptions()];

  return (
    <Group title={t("App-Regeln")}>
      {apps.map((a) => {
        const key = ruleKey(a);
        const file = a.path ? a.path.split(/[\\/]/).pop() : `${a.name}.exe`;
        return (
          <div key={key} className="px-3 py-2" title={a.path || undefined}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-body text-label">{a.name}</span>
                <span className="truncate text-caption text-label-3">{file}</span>
              </div>
              <button
                aria-label={t("{name} entfernen", { name: a.name })}
                title={t("Entfernen")}
                className="pressable shrink-0 text-label-3 hover:text-label-2"
                onClick={() => updateBehavior((b) => ({ apps: b.apps.filter((x) => ruleKey(x) !== key) }))}
              >
                <X size={13} weight="bold" />
              </button>
            </div>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {CONTEXTS.map((c) => (
                <div key={c} className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-caption text-label-3">{t(contextLabel[c])}</span>
                  <Select<string> width="w-full" value={a[c] ?? "follow"} onChange={(v) => set(key, { [c]: v === "follow" ? null : (v as Behavior) })} options={options} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <Row label={t("Laufende App")} hint={apps.length === 0 ? t("Eigene Regeln für eine App, nach ihrer .exe") : undefined}>
        <div className="flex items-center gap-2">
          <Select<string>
            width="w-44"
            value={pick}
            onChange={setPick}
            options={[{ value: "", label: t("App wählen …") }, ...choices.map((a) => ({ value: a.path, label: a.name }))]}
          />
          <Button
            disabled={!pick || full}
            onClick={() => {
              const app = running.find((a) => a.path === pick);
              if (app) add(newRule(app.name, app.path));
              setPick("");
            }}
          >
            {t("Hinzufügen")}
          </Button>
        </div>
      </Row>
      <Row label={t("Nach Name")} hint={t("Für Apps, die gerade nicht laufen")}>
        <div className="flex items-center gap-2">
          <TextField
            value={typed}
            onChange={setTyped}
            placeholder="game.exe"
            width="w-40"
            onSubmit={() => {
              if (!typed.trim() || full) return;
              add(newRule(typed));
              setTyped("");
            }}
          />
          <Button
            disabled={!typed.trim() || full}
            onClick={() => {
              add(newRule(typed));
              setTyped("");
            }}
          >
            {t("Hinzufügen")}
          </Button>
        </div>
      </Row>
    </Group>
  );
}

const hotkeyLabel: Record<HotkeyKind, string> = { open: "Öffnen und schließen", hide: "Crest aus- und einblenden", resize: "Größe ändern", find: "Auf dem Bildschirm suchen", mic: "Mikrofon stummschalten" };
const hotkeyHint: Record<HotkeyKind, string> = {
  open: "Öffnet und schließt die Notch von überall",
  hide: "Blendet Crest aus, bis du es wieder drückst",
  resize: isMac
    ? "Mit Option, einer weiteren Taste und den Pfeiltasten: ←/→ Breite, ↑/↓ Höhe des offenen Tools"
    : "Mit Alt, einer weiteren Taste und den Pfeiltasten: ←/→ Breite, ↑/↓ Höhe des offenen Tools",
  find: "Liest den Text auf allen Bildschirmen und öffnet die Suche darin",
  mic: "Schaltet das Standard-Mikrofon stumm und wieder ein, von überall",
};
const recordErrors: Record<RecordError, string> = {
  "need-modifier": isMac ? "Buchstaben und Ziffern brauchen Ctrl, Option oder Cmd; F1 bis F24 gehen allein" : "Buchstaben und Ziffern brauchen Strg, Alt oder Win; F1 bis F24 gehen allein",
  "resize-modifiers": isMac ? "Option und eine weitere Taste (Ctrl, Umschalt oder Cmd) halten" : "Alt und eine weitere Taste (Strg, Umschalt oder Win) halten",
  "resize-arrow": "Halte die Tasten und drücke eine Pfeiltaste",
  "unsupported-key": "Diese Taste geht nicht als Tastenkürzel",
};

function Shortcuts() {
  return (
    <Group title={t("Tastenkürzel")}>
      <HotkeyRow kind="open" />
      <HotkeyRow kind="hide" />
      <HotkeyRow kind="resize" />
      {!isMac && <HotkeyRow kind="find" />}
      <HotkeyRow kind="mic" />
      <ToolHotkeys />
    </Group>
  );
}

/** A keycap in the interface language: Ctrl is "Strg" and Space "Leertaste" in German; on a Mac the Win key is Cmd and Alt is Option. */
export const keyText = (k: string) =>
  k === "Space" ? t("Leertaste") : isMac ? (k === "Win" ? "Cmd" : k === "Alt" ? "Option" : k) : k === "Ctrl" ? t("Strg") : k === "Alt" ? t("Alt") : k;

const toolName = (id: string) => {
  const tab = findTab(id);
  return tab ? t(tab.label) : id;
};

/** What already holds a combination, as the settings name it. */
const holderName = (h: Holder) => (h === "launcher" ? t("Launcher") : h.startsWith("tool:") ? toolName(h.slice(5)) : t(hotkeyLabel[h as HotkeyKind]));

/** Recording into a shortcut box: click it, press the combination. Esc cancels, Backspace or Delete clears. `onStop` follows every end. */
function useRecorder(kind: HotkeyKind, save: (text: string) => void, onStop?: () => void) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<RecordError | null>(null);
  const box = useRef<HTMLButtonElement>(null);
  const stop = () => {
    setRecording(false);
    pauseHotkeys(false);
    onStop?.();
  };
  const start = () => {
    setError(null);
    setRecording(true);
    pauseHotkeys(true);
    box.current?.focus();
  };
  // A recorder left open (the panel closed) must not keep the shortcuts off.
  useEffect(() => () => pauseHotkeys(false), []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") return stop();
    const plain = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
    if (plain && (e.code === "Backspace" || e.code === "Delete")) {
      save("");
      setError(null);
      return stop();
    }
    const r = record(kind, e.nativeEvent, !isMac);
    if (!r) return;
    if ("error" in r) return setError(r.error);
    save(r.text);
    setError(null);
    stop();
  };
  return { recording, error, box, start, stop, onKeyDown };
}

/** The hint under a shortcut: what went wrong first, else `fallback`. Orange when something is wrong. */
function shortcutHint(r: { error: RecordError | null; clash: Holder | null; status?: HotkeyState | "duplicate"; altGr: boolean; off?: boolean }, fallback: string) {
  const text = r.error
    ? t(recordErrors[r.error])
    : r.clash
      ? t("Schon belegt von „{name}“, bitte eine andere Kombination", { name: holderName(r.clash) })
      : r.off
        ? t("Das Tool ist aus; das Tastenkürzel wirkt, sobald du es einschaltest")
        : r.status === "in-use"
          ? t("Ein anderes Programm nutzt diese Kombination, sie ist nicht aktiv")
          : r.status === "invalid"
            ? t("Nicht erkannt, bitte neu aufnehmen")
            : r.altGr
              ? t("Strg+Alt ist auf vielen Tastaturen AltGr und tippt dann z. B. @ oder €; besser Umschalt oder Win dazunehmen")
              : fallback;
  const warn = !!r.error || !!r.clash || !!r.off || r.status === "in-use" || r.status === "invalid" || r.altGr;
  return <span className={warn ? "text-orange" : undefined}>{text}</span>;
}

/** The box that shows and records a combination, and the button that clears it. */
function ShortcutBox({ rec, value, name, onClear }: { rec: ReturnType<typeof useRecorder>; value: string; name: string; onClear: () => void }) {
  const caps = keycaps(value, t("Pfeiltasten")).map(keyText);
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        ref={rec.box}
        data-no-drag
        aria-label={t("Tastenkürzel für „{name}“ aufnehmen", { name })}
        onClick={rec.start}
        onBlur={() => rec.recording && rec.stop()}
        onKeyDown={rec.onKeyDown}
        // Key combinations read left to right in any language.
        dir="ltr"
        className={`pressable flex h-7 min-w-24 items-center justify-center gap-1 rounded-[8px] px-2 text-caption outline-none focus-visible:ring-1 focus-visible:ring-label-3 ${
          rec.recording ? "bg-fill-3 text-label ring-1 ring-label-3" : "bg-fill-2 text-label-2"
        }`}
      >
        {rec.recording ? (
          t("Kombination drücken …")
        ) : caps.length ? (
          caps.map((k, i) => (
            <kbd key={i} className="rounded-[5px] bg-fill-2 px-1.5 py-0.5 font-sans text-caption">
              {k}
            </kbd>
          ))
        ) : (
          <span className="text-label-3">{t("Nicht gesetzt")}</span>
        )}
      </button>
      {value && !rec.recording && (
        <button aria-label={t("Tastenkürzel entfernen")} title={t("Tastenkürzel entfernen")} className="pressable p-1 text-label-3 hover:text-label-2" onClick={onClear}>
          <X size={12} weight="bold" />
        </button>
      )}
    </div>
  );
}

function HotkeyRow({ kind }: { kind: HotkeyKind }) {
  const s = settings.use();
  const status = hotkeyStatus.use()[kind];
  const value = s.behavior.hotkeys[kind];
  const save = (text: string) => updateBehavior((b) => ({ hotkeys: { ...b.hotkeys, [kind]: text } }));
  const rec = useRecorder(kind, save);
  const clash = conflicts(usableHotkeys(s), takenByLauncher(s))[kind];
  // AltGr is a Windows and Linux key; a Mac types its characters with Option alone.
  const altGr = !isMac && altGrRisk(kind, value);
  return (
    <Row label={t(hotkeyLabel[kind])} hint={shortcutHint({ error: rec.error, clash, status, altGr }, t(hotkeyHint[kind]))}>
      <ShortcutBox rec={rec} value={value} name={t(hotkeyLabel[kind])} onClear={() => save("")} />
    </Row>
  );
}

/**
 * The tools' own shortcuts: one row per tool that has one, in dock order, and a menu that adds a tool. A tool picked there
 * gets its row at once, recording; pressed nothing (Esc, a click elsewhere), the row goes again.
 */
function ToolHotkeys() {
  const s = settings.use();
  const [adding, setAdding] = useState<string | null>(null);
  const saved = s.behavior.toolHotkeys;
  // Tools in the dock that exist here (a removed plugin's shortcut stays saved but has no row).
  const known = s.tools.filter((x) => findTab(x.id));
  const rows = known.filter((x) => saved[x.id] || x.id === adding).map((x) => x.id);
  const free = known.filter((x) => x.enabled && !saved[x.id] && x.id !== adding);
  return (
    <>
      {rows.map((id) => (
        <ToolHotkeyRow key={id} id={id} adding={id === adding} onStop={() => setAdding(null)} />
      ))}
      {free.length > 0 && (
        <Row label={t("Tool direkt öffnen")} hint={t("Ein eigenes Tastenkürzel öffnet die Notch gleich auf einem Tool")}>
          <Select<string>
            value=""
            options={free.map((x) => ({ value: x.id, label: toolName(x.id) }))}
            onChange={setAdding}
            trigger={{
              label: t("Tool für ein Tastenkürzel wählen"),
              menuWidth: 200,
              className: "pressable pressable-fill flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-fill-2 px-3 text-footnote font-medium text-label",
              content: (
                <>
                  <Plus size={12} weight="bold" />
                  {t("Tool wählen")}
                </>
              ),
            }}
          />
        </Row>
      )}
    </>
  );
}

function ToolHotkeyRow({ id, adding, onStop }: { id: string; adding: boolean; onStop: () => void }) {
  const s = settings.use();
  const status = toolHotkeyStatus.use()[id];
  const value = s.behavior.toolHotkeys[id] ?? "";
  const save = (text: string) =>
    updateBehavior((b) => {
      const next = { ...b.toolHotkeys };
      if (text) next[id] = text;
      else delete next[id];
      return { toolHotkeys: next };
    });
  const rec = useRecorder("open", save, onStop);
  // Added from the menu: straight into recording.
  useEffect(() => {
    if (adding) rec.start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const off = !s.tools.some((x) => x.id === id && x.enabled);
  const clash = off ? null : (toolConflicts(usableHotkeys(s), activeToolHotkeys(s), takenByLauncher(s))[id] ?? null);
  const altGr = !isMac && altGrRisk("open", value);
  const tab = findTab(id);
  const name = toolName(id);
  return (
    <Row
      label={
        <span className="flex items-center gap-1.5">
          {tab && <tab.icon size={13} weight="bold" className="shrink-0 text-label-2" />}
          {name}
        </span>
      }
      hint={shortcutHint({ error: rec.error, clash, status, altGr, off }, t("Öffnet die Notch auf diesem Tool; noch einmal gedrückt, schließt sie"))}
    >
      <ShortcutBox rec={rec} value={value} name={name} onClear={() => save("")} />
    </Row>
  );
}

function Panel() {
  const { behavior: b, tools } = settings.use();
  // The installed plugins' tools count too: those enabled and those with a saved size.
  const plugins = [...tools.map((x) => x.id), ...Object.keys(b.sizes)].filter((id) => id.startsWith("plugin:")).map(findTab);
  const all = [...new Map([...tabs, settingsTab, ...plugins].filter((x): x is NotchTab => !!x).map((x) => [x.id, x])).values()];
  const defs = Object.fromEntries(all.map((tab) => [tab.id, tab.size]));
  const quick = currentQuick(defs, b.sizes);
  return (
    <Group title={t("Offenes Panel")}>
      <Row label={t("Größe")} hint={t("Pro Tool an den Rändern des offenen Panels ziehen; Doppelklick setzt zurück")}>
        <Segmented<QuickSize | "custom">
          id="panel-size"
          size="sm"
          value={quick ?? "custom"}
          onChange={(q) => {
            if (q === "custom") return;
            updateBehavior({ sizes: q === "standard" ? {} : Object.fromEntries(all.map((tab) => [tab.id, quickSize(tab.size, q)])) });
          }}
          options={[
            { value: "compact", label: t("Kompakt") },
            { value: "standard", label: t("Standard") },
            { value: "spacious", label: t("Geräumig") },
          ]}
        />
      </Row>
      <Row label={t("Skalierung")} hint={t("Zeichnet Crest größer, wie eine höhere Windows-Skalierung nur für Crest")}>
        {/* Steps instead of a slider: the scale redraws the whole page, so a dragged thumb would move under the pointer. */}
        <div id="panel-scale" className="flex shrink-0 items-center gap-2">
          <Button disabled={b.scale === PANEL_SCALES[0]} onClick={() => updateBehavior({ scale: stepScale(b.scale, -1) })}>
            −
          </Button>
          <span className="tabular w-12 text-center text-footnote text-label" aria-live="polite">
            {b.scale} %
          </span>
          <Button disabled={b.scale === PANEL_SCALES[PANEL_SCALES.length - 1]} onClick={() => updateBehavior({ scale: stepScale(b.scale, 1) })}>
            +
          </Button>
        </div>
      </Row>
    </Group>
  );
}

function Mouse() {
  const b = settings.use().behavior;
  return (
    <Group title={t("Maus")}>
      <Row label={t("Rechtsklick öffnet die Einstellungen")}>
        <Switch label={t("Rechtsklick öffnet die Einstellungen")} checked={b.rightClickSettings} onChange={(rightClickSettings) => updateBehavior({ rightClickSettings })} />
      </Row>
      <Row label={t("Mausrad wechselt das Tool")} hint={t("Über dem offenen Panel, wo nichts scrollt")}>
        <Switch label={t("Mausrad wechselt das Tool")} checked={b.wheelTools} onChange={(wheelTools) => updateBehavior({ wheelTools })} />
      </Row>
    </Group>
  );
}
