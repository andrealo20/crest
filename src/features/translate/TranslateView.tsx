import { useEffect, useRef, useState } from "react";
import { ArrowsLeftRight, Check, Copy, Trash, X } from "../../ui/iconset";
import { HeaderActions, HeaderButton } from "../../notch/header";
import { createStore } from "../../lib/store";
import { isMac, isNative } from "../../platform/native";
import { settings, updateSettings } from "../../settings/store";
import { Button, Select } from "../../ui/controls";
import { lang, locale, t, tBackend } from "../../i18n";
import { downloadPairs, offlineStatus, translateOffline } from "../now-playing/offlineEngine";
import { providerInfo, streamChat } from "../ask/providers";
import { askReady } from "../taskbar/search/understand";
import { secrets } from "../../platform/services";
import { LANGS, MAX_CHARS, joinLines, linesOf, plan, providerPrompt, sourceOf, targetOf } from "./logic";

/*
 * The local engine is Bergamot as WebAssembly in the page's worker, with the files from src-tauri/src/translate.rs, which is
 * built on every platform: it translates on Windows x64, Windows ARM64 and macOS alike. Only the browser preview has none.
 */

interface Draft {
  text: string;
  /** "auto" or a language code. */
  from: string;
  /** "" follows Settings > Tools > Translate. */
  to: string;
}
/** The text and the languages, saved as they change (localStorage, nothing leaves the PC). */
const draft = createStore<Draft>({ text: "", from: "auto", to: "" }, { persist: "translate" });
draft.set((d) => ({
  text: typeof d?.text === "string" ? d.text : "",
  from: d?.from === "auto" || LANGS.includes(d?.from) ? d.from : "auto",
  to: LANGS.includes(d?.to) ? d.to : "",
}));

/** The last translation and what it was made from, so reopening the tool does not translate the same text again. */
const result = createStore<{ key: string; text: string; via: "local" | "provider" | null }>({ key: "", text: "", via: null });

/** A pause after the last keystroke before the local models translate on their own. */
const AUTO_MS = 600;

const nameOf = (code: string) => {
  const name = new Intl.DisplayNames([lang()], { type: "language" }).of(code) ?? code;
  return name.charAt(0).toLocaleUpperCase(locale()) + name.slice(1);
};

/*
 *   Translate                                         [⧉] [🗑]
 *   [ Detect (Italian) ▾ ]  ⇄  [ English ▾ ]
 *   ┌──────────────────────────┐ ┌──────────────────────────┐
 *   │ Ciao, come stai?         │ │ Hello, how are you?      │
 *   └──────────────────────────┘ └──────────────────────────┘
 *   status                                  16 / 5000  [Translate]
 */
export function TranslateView() {
  const { text, from: pickedFrom, to: pickedTo } = draft.use();
  const s = settings.use();
  const status = offlineStatus.use();
  const done = result.use();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"busy" | "failed" | null>(null);
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const [askOn, setAskOn] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const run = useRef<AbortController | null>(null);

  const ask = s.ask;
  useEffect(() => {
    let live = true;
    void secrets.has(`ai.${ask.provider}`).catch(() => false).then((key) => live && setAskOn(askReady(ask.provider, ask.configs[ask.provider], key)));
    return () => {
      live = false;
    };
  }, [ask]);

  useEffect(() => {
    area.current?.focus({ preventScroll: true });
    return () => run.current?.abort();
  }, []);

  const to = targetOf(pickedTo, s.translate.target, lang());
  const from = sourceOf(pickedFrom, text);
  const useProvider = s.translate.provider && askOn;
  const p = plan(text, from, to, status, useProvider);
  const key = `${from ?? "auto"}|${to}|${text}`;

  const translate = async () => {
    if (p.kind !== "local" && p.kind !== "provider") return;
    run.current?.abort();
    const stop = (run.current = new AbortController());
    setBusy(true);
    setError(null);
    try {
      if (p.kind === "local") {
        const { lines, at } = linesOf(text);
        const out = await translateOffline(p.pairs, lines);
        if (!stop.signal.aborted) result.set({ key, text: joinLines(text, at, out), via: "local" });
      } else {
        let reply = "";
        result.set({ key, text: "", via: "provider" });
        const config = { ...ask.configs[ask.provider], effort: "off" as const };
        await streamChat(ask.provider, config, [{ role: "user", content: text }], (d) => {
          reply += d;
          result.set({ key, text: reply, via: "provider" });
        }, stop.signal, providerPrompt(p.from, to));
      }
    } catch (e) {
      if (stop.signal.aborted) return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg === "no-key" ? t("Kein API-Schlüssel für {p}, in den Einstellungen eintragen.", { p: t(providerInfo[ask.provider].label) }) : p.kind === "local" ? t("Übersetzung fehlgeschlagen") : tBackend(msg));
    } finally {
      if (run.current === stop) setBusy(false);
    }
  };

  // The local models translate by themselves a moment after typing stops; a provider only on Ctrl+Enter or the button.
  useEffect(() => {
    if (p.kind !== "local" || done.key === key) return;
    const timer = window.setTimeout(() => void translate(), AUTO_MS);
    return () => window.clearTimeout(timer);
  }, [key, p.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // The local models replace the last translation in a moment, so it stays while typing; any other text has none yet.
  const shown = done.key === key || busy || p.kind === "local" ? done.text : "";

  const download = (pairs: [string, string][]) => {
    setLoading("busy");
    downloadPairs(pairs).then(() => setLoading(null), () => setLoading("failed"));
  };

  const swap = () => {
    if (!from) return;
    draft.set((d) => ({ text: shown || d.text, from: to, to: from }));
    area.current?.focus();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
    window.setTimeout(() => setCopied(null), 1600);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Escape leaves the field first, so it does not also close the notch.
    if (e.key === "Escape") {
      e.stopPropagation();
      return e.currentTarget.blur();
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void translate();
    }
  };

  const note = (() => {
    if (error) return <span className="truncate text-red">{error}</span>;
    if (busy) return <span>{t("Wird übersetzt …")}</span>;
    switch (p.kind) {
      case "too-long":
        return <span className="text-orange">{t("Zu lang: höchstens {max} Zeichen", { max: MAX_CHARS.toLocaleString(locale()) })}</span>;
      case "same":
        return <span>{t("Der Text ist schon auf {lang}", { lang: nameOf(to) })}</span>;
      case "pick":
        return <span>{t("Sprache nicht erkannt, bitte oben wählen")}</span>;
      case "download":
        return (
          <>
            <span className="truncate">
              {loading === "busy"
                ? t("Wird geladen …")
                : loading === "failed"
                  ? t("Download fehlgeschlagen, später noch einmal versuchen")
                  : p.missing > 1
                    ? t("Modelle fehlen, Download von 80 bis 140 MB")
                    : t("Modell fehlt, Download von 40 bis 70 MB")}
            </span>
            {isNative && (
              <Button disabled={loading === "busy"} onClick={() => download(p.pairs)}>
                {t("Laden")}
              </Button>
            )}
            {askOn && (
              <Button disabled={loading === "busy"} onClick={() => updateSettings((cur) => ({ translate: { ...cur.translate, provider: true } }))}>
                {t("Mit {p} übersetzen", { p: t(providerInfo[ask.provider].label) })}
              </Button>
            )}
          </>
        );
      default:
        return done.via === "provider" && shown ? <span className="truncate">{t("Übersetzt von {p}", { p: t(providerInfo[ask.provider].label) })}</span> : null;
    }
  })();

  const field = "min-h-0 flex-1 resize-none rounded-[12px] bg-fill-1 px-3 py-2 text-body text-label outline-none [scrollbar-width:thin] placeholder:text-label-4";

  return (
    <div className="flex h-full flex-col gap-2 px-4 pt-1 pb-2">
      <HeaderActions>
        <HeaderButton label={copied === "ok" ? t("Kopiert") : copied === "failed" ? t("Kopieren fehlgeschlagen") : t("Kopieren")} disabled={!shown} onClick={() => void copy()}>
          {copied === "ok" ? <Check size={14} weight="bold" /> : copied === "failed" ? <X size={14} weight="bold" className="text-red" /> : <Copy size={14} weight="bold" />}
        </HeaderButton>
        <HeaderButton
          label={t("Leeren")}
          disabled={!text}
          onClick={() => {
            run.current?.abort();
            draft.set((d) => ({ ...d, text: "" }));
            setError(null);
            area.current?.focus();
          }}
        >
          <Trash size={14} weight="bold" />
        </HeaderButton>
      </HeaderActions>

      <div className="flex items-center gap-2">
        <Select
          width="w-48"
          value={pickedFrom}
          options={[
            { value: "auto", label: pickedFrom === "auto" && from ? t("Erkannt: {lang}", { lang: nameOf(from) }) : t("Sprache erkennen") },
            ...LANGS.map((code) => ({ value: code, label: nameOf(code) })),
          ]}
          onChange={(v) => draft.set((d) => ({ ...d, from: v }))}
        />
        <HeaderButton label={t("Sprachen tauschen")} disabled={!from || from === to} onClick={swap}>
          <ArrowsLeftRight size={14} weight="bold" />
        </HeaderButton>
        <Select width="w-48" value={to} options={LANGS.map((code) => ({ value: code, label: nameOf(code) }))} onChange={(v) => draft.set((d) => ({ ...d, to: v }))} />
      </div>

      <div className="flex min-h-0 flex-1 gap-2">
        <textarea
          ref={area}
          value={text}
          onChange={(e) => {
            setError(null);
            draft.set((d) => ({ ...d, text: e.target.value }));
          }}
          onKeyDown={onKeyDown}
          spellCheck={false}
          aria-label={t("Text zum Übersetzen")}
          placeholder={t("Text eingeben oder einfügen")}
          className={field}
        />
        <textarea readOnly value={shown} aria-label={t("Übersetzung")} placeholder={t("Übersetzung")} className={`${field} text-label-2`} />
      </div>

      <div className="flex h-7 items-center gap-2 text-caption text-label-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">{note}</div>
        <span className={`tabular-nums ${text.length > MAX_CHARS ? "text-orange" : ""}`}>
          {text.length.toLocaleString(locale())} / {MAX_CHARS.toLocaleString(locale())}
        </span>
        <Button primary disabled={busy || (p.kind !== "local" && p.kind !== "provider")} onClick={() => void translate()}>
          <span title={`${isMac ? "Cmd" : t("Strg")} + Enter`}>{t("Übersetzen")}</span>
        </Button>
      </div>
    </div>
  );
}
