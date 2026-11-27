import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Calculator, Check, Clock, File, Folder, FolderOpen, GearSix, Globe, SlidersHorizontal, Sparkle, type Icon } from "../../../ui/iconset";
import { TextField } from "../../../ui/controls";
import { english, locale, t } from "../../../i18n";
import { fileSearch, launcher, type FoundFile } from "../../../platform/services";
import { fetchRates } from "../../../platform/portfolio";
import { isMac } from "../../../platform/native";
import { settings, updateSettings } from "../../../settings/store";
import { PART_IDS, type PartId } from "../../../notch/row/parts";
import { partInfo } from "../../../notch/row/partInfo";
import { allZones } from "../../clocks/zones";
import { convertMoney } from "../../convert/fx";
import { AppIcon } from "../../launcher/AppIcon";
import { mergeApps, type LauncherApp } from "../../launcher/apps";
import { barEngine } from "../../overview/search";
import { allThemes } from "../../themes/store";
import { effectiveBase } from "../../trading/base";
import type { Rates } from "../../trading/portfolio";
import { closePanel } from "../panel";
import { answerHit, needsRates } from "../search/answers";
import { appHits, toolHits, toolLabel, widgetHits } from "../search/catalog";
import { fileHits, latestSearch } from "../search/files";
import { askIntent, askReadyNow } from "../search/askIntent";
import { AI_SETTINGS, aiSetupHit, arrange, keepSelected, settingsSearchHit, understandHit, webOrPathHit, type Hit, type HitIcon, type SearchAction } from "../search/model";
import { runAction, type RunOutcome } from "../search/run";
import { settingHits } from "../search/settingsTable";
import { barWindows } from "../store";
import { toolInfo } from "../toolInfo";
import { label } from "../../window/hotkeys";

const GLYPHS: Record<Extract<HitIcon, { glyph: string }>["glyph"], Icon> = {
  calc: Calculator,
  clock: Clock,
  setting: SlidersHorizontal,
  sparkle: Sparkle,
  web: Globe,
  gear: GearSix,
  path: FolderOpen,
};

// The apps' icons, kept while the bar's window lives: every key reads them.
const appIcons = new Map<string, string | null>();

/** Files' pictures by path and size, the oldest dropped past THUMBS, so a long evening of searches keeps memory flat. */
const thumbs = new Map<string, string | null>();
const THUMBS = 100;
const ROW_THUMB = 64;
const PREVIEW = 320;
const thumbKey = (path: string, size: number) => `${size}:${path}`;

/**
 * The search box's panel: the rows for the text over the field, the best first (search/model.ts arrange), Enter or a click runs
 * the selected one (search/run.ts), Ctrl+Enter its second action. Fixed in size, so it never jumps while the text changes; with no
 * text, examples to try. What a setting changed shows under the field, with Rückgängig.
 */
export function SearchPanel() {
  const s = settings.use();
  const engine = barEngine(s.productivity.search);
  const [query, setQuery] = useState("");
  const [apps, setApps] = useState<LauncherApp[]>([]);
  const [rates, setRates] = useState<Rates | null>(null);
  const [, setIconsIn] = useState(0);
  const [files, setFiles] = useState<{ q: string; found: FoundFile[] }>({ q: "", found: [] });
  const [sel, setSel] = useState(-1);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [askOn, setAskOn] = useState(false);
  const [thinking, setThinking] = useState(false);
  const asking = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement>(null);

  // Capisci only with Ask set up; a question still out stops when the panel closes.
  useEffect(() => {
    let live = true;
    void askReadyNow().then((on) => live && setAskOn(on));
    return () => {
      live = false;
      asking.current?.abort();
    };
  }, []);

  // The Launcher's list as the Launcher shows it (mergeApps: no uninstallers, no exe twice), read at each opening; Rust caches it.
  useEffect(() => {
    let live = true;
    launcher.apps().then(
      (a) => live && setApps(mergeApps(a)),
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);

  // The rates only once the text names a currency, as Calc loads them (CalcView.tsx).
  const wantRates = needsRates(query);
  const base = effectiveBase(s.trading.base);
  useEffect(() => {
    if (!wantRates || rates) return;
    let live = true;
    fetchRates(base, [], ["EUR", "USD"]).then(
      (r) => live && setRates(r),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [wantRates, rates, base]);

  // Files from the index, for the last text only and once the typing pauses (search/files.ts).
  const searchFiles = useMemo(() => latestSearch((q) => fileSearch.find(q), (q, found) => setFiles({ q, found })), []);
  useEffect(() => {
    searchFiles(query);
  }, [query, searchFiles]);

  const zones = useMemo(() => allZones(), []);
  const hits = useMemo(() => {
    if (!query.trim()) return [];
    const names = { tr: t, en: (key: string) => english(t(key)) };
    const running = (id: string) => barWindows.get().groups.some((g) => g.windows.length > 0 && g.pins.some((p) => p.id === id));
    const money = rates ? (amount: number, from: string, to: string) => convertMoney(amount, from, to, rates) : undefined;
    const tools = s.tools.filter((x) => x.enabled).flatMap((x) => {
      const label = toolLabel(x.id, toolInfo);
      return label ? [{ id: x.id, label }] : [];
    });
    const widgets = PART_IDS.map((id) => ({ id, label: partInfo[id].label }));
    const themes = allThemes().map((th) => ({ id: th.id, name: th.name }));
    return arrange(
      [
        answerHit(query, { now: new Date(), locale: locale(), h12: s.units.clock === "12", zones, money }),
        ...appHits(apps, query, running, t),
        ...toolHits(query, tools, names),
        ...settingHits(query, { ...names, themes }),
        ...widgetHits(query, widgets, s.taskbar.zones, names),
        ...(files.q === query ? fileHits(files.found, query) : []),
        askOn ? understandHit(query.trim(), t) : aiSetupHit(query.trim(), t),
        settingsSearchHit(query.trim(), t),
        webOrPathHit(query, t),
      ].filter((h): h is Hit => h !== null),
    );
  }, [query, apps, rates, s, engine, zones, files, askOn]);

  // A new list starts on its best row, unless a row was picked with the arrows or the pointer and is still there (files arrive
  // late: Enter must run what was picked). The selected row stays in view.
  const chosen = useRef<string | null>(null);
  const keys = hits.map((h) => h.key).join("\n");
  useEffect(() => setSel(keepSelected(chosen.current, hits)), [keys]); // eslint-disable-line react-hooks/exhaustive-deps
  // In braces: Chromium's scrollIntoView now returns a Promise, which React would keep as the effect's clean-up and then call.
  useEffect(() => {
    list.current?.querySelector(`[data-row="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  // The icons of the apps in the list, once each.
  useEffect(() => {
    const need = hits.flatMap((h) => ("app" in h.icon && !appIcons.has(h.icon.app) ? [h.icon.app] : []));
    if (!need.length) return;
    for (const id of need) appIcons.set(id, null);
    launcher.icons(need).then(
      (got) => {
        for (const [id, src] of Object.entries(got)) appIcons.set(id, src);
        setIconsIn((n) => n + 1);
      },
      () => {},
    );
  }, [keys]); // eslint-disable-line react-hooks/exhaustive-deps

  // The files' pictures: small for the rows, large for the selected one, each asked once.
  const picked = hits[sel];
  const preview = picked && "file" in picked.icon && !picked.icon.folder ? picked.icon.file : null;
  useEffect(() => {
    const want: [string, number][] = hits.flatMap((h) => ("file" in h.icon ? [[h.icon.file, ROW_THUMB] as [string, number]] : []));
    if (preview) want.push([preview, PREVIEW]);
    for (const [path, size] of want) {
      const key = thumbKey(path, size);
      if (thumbs.has(key)) continue;
      thumbs.set(key, null);
      if (thumbs.size > THUMBS) thumbs.delete(thumbs.keys().next().value as string);
      void fileSearch.thumb(path, size).then((src) => {
        thumbs.set(key, src);
        if (src) setIconsIn((n) => n + 1);
      });
    }
  }, [keys, preview]); // eslint-disable-line react-hooks/exhaustive-deps

  const show = (out: RunOutcome) => (out.close ? closePanel() : setOutcome(out.done || out.error ? out : null));
  const run = async (i: number, alt = false) => {
    const action = alt ? hits[i]?.alt : hits[i]?.action;
    if (!action) return;
    if (action.do === "understand") return understand(action);
    show(await runAction(action, engine));
  };
  // Capisci: Ask says what the sentence means, and it runs as if its row had been picked, with the same limits and Rückgängig.
  const understand = async (action: Extract<SearchAction, { do: "understand" }>) => {
    asking.current?.abort();
    const stop = new AbortController();
    asking.current = stop;
    setOutcome(null);
    setThinking(true);
    const answer = await askIntent(action.text, apps, stop.signal);
    if (stop.signal.aborted) return;
    setThinking(false);
    if ("error" in answer) return setOutcome({ error: answer.error });
    if (!answer.action) return setOutcome({ error: t("Das habe ich nicht verstanden") });
    show(await runAction(answer.action, engine));
  };
  const undo = async () => {
    if (!outcome?.undo) return;
    const out = await runAction(outcome.undo, engine);
    setOutcome(out.error ? out : { done: out.done });
  };

  // The keys the field does not use itself: the list's, and Enter for the selected row.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!hits.length) return;
      const by = e.key === "ArrowDown" ? 1 : -1;
      const next = Math.min(hits.length - 1, Math.max(0, sel + by));
      chosen.current = hits[next]?.key ?? null;
      setSel(next);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (sel >= 0) void run(sel, e.ctrlKey);
    }
  };

  const tries = ["12*8.5", "100 usd to eur", "time in tokyo", t("Wetter"), `${t("Lautstärke")} 30`, `${t("Höhe")} 44`];
  return (
    <div className="flex h-full flex-col gap-2 p-3" onKeyDownCapture={onKey}>
      <div ref={list} id="bar-search-results" role="listbox" aria-label={t("Suchergebnisse")} className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {query.trim() ? (
          <>
            {preview && thumbs.get(thumbKey(preview, PREVIEW)) && (
              <img src={thumbs.get(thumbKey(preview, PREVIEW)) ?? undefined} alt="" draggable={false} className="mb-2 h-36 w-full rounded-[10px] bg-fill-2 object-contain" />
            )}
            {hits.map((h, i) => (
              <Row
                key={h.key}
                hit={h}
                index={i}
                selected={i === sel}
                onPick={() => void run(i)}
                onHover={() => {
                  chosen.current = h.key;
                  setSel(i);
                }}
              />
            ))}
          </>
        ) : (
          <div className="flex flex-col gap-2 p-1">
            {!askOn && (
              // Capisci needs a provider set up in Ask: this takes to its page, where the API key goes.
              <button
                type="button"
                className="pressable mb-1 flex items-center gap-2.5 rounded-[10px] bg-fill-2 p-2.5 text-left"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void runAction(AI_SETTINGS, engine).then(show)}
              >
                <Sparkle size={18} weight="fill" className="shrink-0 text-accent material:text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block text-footnote font-medium text-label">{t("KI einschalten")}</span>
                  <span className="block text-caption text-label-3">{t("Versteht Sätze in jeder Sprache: Anbieter und API-Schlüssel wählen")}</span>
                </span>
              </button>
            )}
            <p className="text-caption text-label-3">{t("Probier")}</p>
            <div className="flex flex-wrap gap-1.5">
              {tries.map((x) => (
                <button key={x} type="button" className="pressable rounded-full bg-fill-2 px-2.5 py-1 text-caption text-label-2" onMouseDown={(e) => e.preventDefault()} onClick={() => setQuery(x)}>
                  {x}
                </button>
              ))}
            </div>
            {!isMac && <ShortcutLine keys={s.behavior.hotkeys.search} />}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Sparkle size={14} weight="fill" className="shrink-0 text-accent material:text-primary" />
        <TextField
          value={query}
          onChange={(v) => {
            setQuery(v);
            setOutcome(null);
            chosen.current = null;
            // New text: a question still out to Ask no longer fits it.
            asking.current?.abort();
            setThinking(false);
          }}
          placeholder={t("App, Datei, Widget, Rechnung oder Einstellung suchen")}
          width="flex-1"
          autoFocus
          invalid={!!outcome?.error}
          list={{ id: "bar-search-results", active: sel >= 0 ? `bar-search-row-${sel}` : undefined }}
        />
      </div>
      <p role="status" className={`flex h-4 min-w-0 items-center gap-1.5 text-caption ${outcome?.error ? "text-red" : "text-label-3"}`}>
        {outcome?.done && <Check size={12} weight="bold" className="shrink-0" />}
        {thinking && <Sparkle size={12} weight="bold" className="shrink-0" />}
        <span className="truncate">{thinking ? t("Ask denkt nach…") : (outcome?.error ?? outcome?.done ?? "")}</span>
        {outcome?.undo && (
          <button type="button" className="pressable ml-auto shrink-0 font-medium text-accent hover:underline material:text-primary" onMouseDown={(e) => e.preventDefault()} onClick={() => void undo()}>
            {t("Rückgängig")}
          </button>
        )}
      </p>
    </div>
  );
}

function Row({ hit, index, selected, onPick, onHover }: { hit: Hit; index: number; selected: boolean; onPick: () => void; onHover: () => void }) {
  return (
    <button
      type="button"
      role="option"
      id={`bar-search-row-${index}`}
      aria-selected={selected}
      data-row={index}
      tabIndex={-1}
      // The field keeps the keyboard.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      onPointerMove={onHover}
      className={`flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left ${selected ? "bg-fill-2" : ""}`}
    >
      <RowIcon icon={hit.icon} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-footnote text-label">{hit.title}</span>
        {hit.subtitle && <span className="block truncate text-caption text-label-3">{hit.subtitle}</span>}
      </span>
    </button>
  );
}

function RowIcon({ icon }: { icon: HitIcon }) {
  if ("app" in icon) return <AppIcon src={appIcons.get(icon.app)} size={24} />;
  const picture = "file" in icon ? thumbs.get(thumbKey(icon.file, ROW_THUMB)) : null;
  if (picture) return <img src={picture} alt="" draggable={false} className="h-6 w-6 shrink-0 rounded-[5px] object-cover" />;
  const Glyph: Icon | undefined =
    "tool" in icon ? (toolInfo[icon.tool]?.icon ?? partInfo[icon.tool as PartId]?.icon) : "part" in icon ? partInfo[icon.part]?.icon : "glyph" in icon ? GLYPHS[icon.glyph] : icon.folder ? Folder : File;
  return <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-fill-2 text-label-2">{Glyph && <Glyph size={14} weight="bold" />}</span>;
}

/** The search's own key: the one that opens it from any app, or the offer of Alt+Space, unset by default since Windows and PowerToys Run use it. */
function ShortcutLine({ keys }: { keys: string }) {
  if (keys) return <p className="text-caption text-label-3">{t("{keys} öffnet diese Suche aus jeder App", { keys: label(keys) })}</p>;
  return (
    <div className="flex items-center gap-2">
      <p className="min-w-0 flex-1 text-caption text-label-3">{t("Öffne diese Suche aus jeder App mit {keys}", { keys: label("Alt+Space") })}</p>
      <button
        type="button"
        className="pressable shrink-0 text-caption font-medium text-accent hover:underline material:text-primary"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => updateSettings((cur) => ({ behavior: { ...cur.behavior, hotkeys: { ...cur.behavior.hotkeys, search: "Alt+Space" } } }))}
      >
        {t("Einschalten")}
      </button>
    </div>
  );
}
