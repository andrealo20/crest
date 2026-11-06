import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, X } from "@phosphor-icons/react";
import { content } from "../../design/motion";
import { HeaderButton } from "../../notch/header";
import { requestSize } from "../../notch/size";
import { findTab } from "../../notch/tabs";
import { clipboard, useClipboard, type ClipItem } from "../../platform/clipboard";
import { settings } from "../../settings/store";
import { Button } from "../../ui/controls";
import { usePresenting } from "../privacy/store";
import { locale, t } from "../../i18n";
import { decode, type Decoded } from "./decode";

/*
 * Decode chips: a small chip on a text or link entry that is a JWT, Unix time, Base64, UUID, JSON, hex colour or a
 * link with tracking parameters. A click opens what it decodes to under the row, with "Copy decoded".
 * Everything happens in memory, on this computer: decode.ts is pure, nothing is stored or logged.
 */

/** The list carries only the first 400 characters of an entry (src-tauri/src/clipboard.rs), so a shorter text is the whole text. */
const PREVIEW_CHARS = 400;
/** Characters of a decoded text shown; "Copy decoded" always copies all of it. */
const SHOWN_CHARS = 4000;

/** Space of the decoded view around its content: top and bottom padding, the title row with its gap, the padding of the box. */
const VIEW_CHROME = 72;
/** The notch never grows more than this for it; a longer content scrolls. */
const MAX_EXTRA = 300;

/** Lines of `s`, counted only up to `max`. */
function lines(s: string, max = 16): number {
  let n = 1;
  for (let i = s.indexOf("\n"); i >= 0 && n < max; i = s.indexOf("\n", i + 1)) n++;
  return n;
}

/** Height of what the decoded view shows, in px (code lines are 14 px; wrapped lines are not counted, they scroll). */
function contentHeight(d: Decoded): number {
  switch (d.kind) {
    case "jwt":
      return 16 + 14 * Math.max(lines(d.header), lines(d.payload)) + 8 + 16;
    case "json":
      return 14 * lines(d.pretty);
    case "base64":
      return 14 * lines(d.text);
    case "tracking":
      return 14 * 2 + 24;
    case "time":
      return 44;
    case "uuid":
      return 14;
    case "color":
      return 48;
  }
}

const eligible = (item: ClipItem | undefined): item is ClipItem => !!item && (item.kind === "text" || item.kind === "link");

/**
 * The decoded entry once `on`: undefined while it is read, null when there is nothing to decode. With `keep`, the
 * previous entry's result stays in place while the next is read, so a view that switches does not blink.
 */
function useDecoded(item: ClipItem | undefined, on: boolean, keep = false): Decoded | null | undefined {
  const [result, setResult] = useState<{ id: number; decoded: Decoded | null }>();
  const id = on && eligible(item) ? item.id : null;
  const text = item?.text;
  useEffect(() => {
    if (id === null || text === undefined) {
      setResult(undefined);
      return;
    }
    let alive = true;
    const whole = text.length < PREVIEW_CHARS ? Promise.resolve(text) : clipboard.text(id);
    whole.then(
      (full) => alive && setResult({ id, decoded: full === null ? null : decode(full) }),
      () => alive && setResult({ id, decoded: null }),
    );
    return () => {
      alive = false;
    };
  }, [id, text]);
  return id !== null && (keep || result?.id === id) ? result?.decoded : undefined;
}

function chipLabel(d: Decoded): string {
  switch (d.kind) {
    case "jwt":
      return "JWT";
    case "time":
      return `Unix ${d.unit}`;
    case "base64":
      return "Base64";
    case "uuid":
      return d.version ? `UUID v${d.version}` : "UUID";
    case "json":
      return "JSON";
    case "color":
      return d.hex;
    case "tracking":
      return t("Tracking");
  }
}

/**
 * The chip on one card, shown on hover, on keyboard focus, or while its view is open. The card is looked at the
 * first time the pointer or focus reaches it, so a long history costs nothing until you move over it.
 * `open`/`onToggle` are the Clipboard view's own selection: opening a decoded view closes an image preview and back.
 */
export function ClipChip({ item, open, onToggle }: { item: ClipItem; open: boolean; onToggle: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  const on = settings.use().clipChips !== false;
  const hidden = usePresenting();

  useEffect(() => {
    const card = root.current?.parentElement;
    if (!card) return;
    const arm = () => setArmed(true);
    card.addEventListener("pointerenter", arm, { once: true });
    card.addEventListener("focusin", arm, { once: true });
    return () => {
      card.removeEventListener("pointerenter", arm);
      card.removeEventListener("focusin", arm);
    };
  }, []);

  const decoded = useDecoded(item, on && !hidden && (armed || open));
  const label = decoded ? chipLabel(decoded) : "";

  return (
    <div ref={root} className="contents">
      {decoded && on && !hidden && (
        <button
          onClick={onToggle}
          aria-expanded={open}
          aria-label={t("Dekodierung zeigen: {kind}", { kind: label })}
          title={t("Dekodierung zeigen: {kind}", { kind: label })}
          className={`pressable absolute start-8 top-2 z-10 flex h-5 max-w-[64px] items-center gap-1 rounded-full bg-fill-3 px-1.5 text-[10px] leading-none font-semibold hover:text-label ${
            open ? "text-label opacity-100" : "text-label-2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
          }`}
        >
          {decoded.kind === "color" && <span className="size-2 shrink-0 rounded-full" style={{ background: decoded.hex }} />}
          <span className="truncate">{label}</span>
        </button>
      )}
    </div>
  );
}

/** The decoded view of the selected entry, under the row. Renders nothing when the selection is an image or has nothing to decode. */
export function ClipDecodePane({ id, onClose }: { id: number | null; onClose: () => void }) {
  const items = useClipboard();
  const item = id === null ? undefined : items.find((i) => i.id === id);
  const on = settings.use().clipChips !== false;
  const hidden = usePresenting();
  const decoded = useDecoded(item, on && !hidden, true);

  // The notch grows by the view's height while it shows, and goes back when it leaves. While it is read (undefined)
  // nothing changes, so a switch between two entries does not make the notch jump.
  const extra = decoded ? Math.min(MAX_EXTRA, VIEW_CHROME + contentHeight(decoded)) : id === null || decoded === null ? 0 : undefined;
  useEffect(() => {
    if (extra === undefined) return;
    const base = findTab("clipboard")!.size;
    requestSize("clipboard", extra ? { w: base.w, h: base.h + extra } : null);
  }, [extra]);
  useEffect(() => () => requestSize("clipboard", null), []);

  return <AnimatePresence>{decoded && id !== null && <DecodeView key="decode" d={decoded} onClose={onClose} />}</AnimatePresence>;
}

function DecodeView({ d, onClose }: { d: Decoded; onClose: () => void }) {
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  useEffect(() => setCopied(null), [d]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(d.copy);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
    window.setTimeout(() => setCopied(null), 1400);
  };

  return (
    <motion.div
      className="flex min-h-0 flex-1 flex-col gap-1.5 px-4 pt-2.5 pb-2"
      initial={{ opacity: 0, transform: "translateY(-6px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)", transition: { ...content.enter, delay: 0.08 } }}
      exit={{ opacity: 0, transition: content.exit }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-caption font-medium text-label-3">{title(d)}</span>
        <div className="flex shrink-0 items-center gap-1">
          <Button icon={copied === "ok" ? Check : Copy} onClick={() => void copy()}>
            {copied === "ok" ? t("Kopiert") : copied === "failed" ? t("Kopieren fehlgeschlagen") : d.kind === "tracking" ? t("Ohne Tracking kopieren") : t("Dekodiert kopieren")}
          </Button>
          <HeaderButton label={t("Dekodierung schließen")} onClick={onClose}>
            <X size={13} weight="bold" />
          </HeaderButton>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-[12px] bg-fill-1 p-2.5 [scrollbar-width:none]">
        <Body d={d} />
      </div>
    </motion.div>
  );
}

function title(d: Decoded): string {
  switch (d.kind) {
    case "jwt":
      return "JWT";
    case "time":
      return d.unit === "s" ? t("Unix-Zeit in Sekunden") : t("Unix-Zeit in Millisekunden");
    case "base64":
      return t("Base64, als Text gelesen");
    case "uuid":
      return d.nil ? t("Nil-UUID (nur Nullen)") : d.version ? t("UUID, Version {v}", { v: d.version }) : t("UUID, Version unbekannt");
    case "json":
      return t("JSON, formatiert");
    case "color":
      return t("Farbe");
    case "tracking":
      return t("Link mit Tracking-Parametern");
  }
}

const clip = (s: string) => (s.length > SHOWN_CHARS ? s.slice(0, SHOWN_CHARS) : s);

function Code({ children }: { children: string }) {
  return (
    <>
      <pre className="font-mono text-[11px] leading-[14px] whitespace-pre-wrap text-label-2 [overflow-wrap:anywhere]">{clip(children)}</pre>
      {children.length > SHOWN_CHARS && <p className="mt-1 text-caption text-label-3">{t("Nur der Anfang ist zu sehen, Kopieren nimmt alles")}</p>}
    </>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 text-footnote">
      <span className="w-12 shrink-0 text-caption text-label-3">{label}</span>
      <span className="min-w-0 text-label [overflow-wrap:anywhere]">{children}</span>
    </div>
  );
}

function Body({ d }: { d: Decoded }) {
  switch (d.kind) {
    case "jwt": {
      const when = d.exp === null ? null : new Date(d.exp).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "medium" });
      return (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <p className="mb-0.5 text-caption text-label-3">Header</p>
              <Code>{d.header}</Code>
            </div>
            <div className="min-w-0">
              <p className="mb-0.5 text-caption text-label-3">Payload</p>
              <Code>{d.payload}</Code>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-footnote">
            <span className="text-orange">{t("Signatur nicht geprüft")}</span>
            {when === null ? (
              <span className="text-label-3">{t("Ohne Ablauf (kein exp)")}</span>
            ) : (
              <span className={d.expired ? "text-red" : "text-green"}>{d.expired ? t("Abgelaufen {date}", { date: when }) : t("Läuft ab {date}", { date: when })}</span>
            )}
          </div>
        </div>
      );
    }
    case "time": {
      const iso = new Date(d.ms).toISOString();
      const utc = `${iso.slice(0, 10)} ${iso.slice(11, 19)}${d.ms % 1000 ? iso.slice(19, 23) : ""} UTC`;
      return (
        <div className="flex flex-col gap-1">
          <Line label={t("Lokal")}>{new Date(d.ms).toLocaleString(locale(), { dateStyle: "full", timeStyle: "long" })}</Line>
          <Line label="UTC">{utc}</Line>
        </div>
      );
    }
    case "base64":
      return <Code>{d.text}</Code>;
    case "json":
      return <Code>{d.pretty}</Code>;
    case "uuid":
      return <Code>{d.copy}</Code>;
    case "color":
      return (
        <div className="flex items-center gap-3">
          <span className="size-12 shrink-0 rounded-[10px] ring-1 ring-separator" style={{ background: d.hex }} />
          <div className="flex flex-col gap-0.5 font-mono text-[11px] leading-[14px] text-label-2">
            <span>{d.hex}</span>
            <span>{d.copy}</span>
            <span>{`hsl(${d.hsl[0]}, ${d.hsl[1]}%, ${d.hsl[2]}%)`}</span>
          </div>
        </div>
      );
    case "tracking":
      return (
        <div className="flex flex-col gap-1.5">
          <Code>{d.clean}</Code>
          <p className="text-caption text-label-3">{t("Entfernt: {names}", { names: [...new Set(d.removed)].join(", ") })}</p>
        </div>
      );
  }
}
