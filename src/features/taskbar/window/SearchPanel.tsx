import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Calculator, Check, Clock, File, Folder, FolderOpen, GearSix, Globe, MagnifyingGlass, SlidersHorizontal, Sparkle, type Icon } from "../../../ui/iconset";
import { TextField } from "../../../ui/controls";
import { english, locale, t } from "../../../i18n";
import { launcher, type LauncherAppEntry } from "../../../platform/services";
import { fetchRates } from "../../../platform/portfolio";
import { settings } from "../../../settings/store";
import { PART_IDS } from "../../../notch/row/parts";
import { partInfo } from "../../../notch/row/partInfo";
import { allZones } from "../../clocks/zones";
import { convertMoney } from "../../convert/fx";
import { AppIcon } from "../../launcher/AppIcon";
import { barEngine } from "../../overview/search";
import { allThemes } from "../../themes/store";
import { effectiveBase } from "../../trading/base";
import type { Rates } from "../../trading/portfolio";
import { closePanel } from "../panel";
import { answerHit, needsRates } from "../search/answers";
import { appHits, toolHits, widgetHits } from "../search/catalog";
import { arrange, firstSelected, settingsSearchHit, webOrPathHit, type Hit, type HitIcon } from "../search/model";
import { runAction, type RunOutcome } from "../search/run";
import { settingHits } from "../search/settingsTable";
import { barWindows } from "../store";
import { toolInfo } from "../toolInfo";

const GLYPHS: Record<Extract<HitIcon, { glyph: string }>["glyph"], Icon> = {
  calc: Calculator,
  clock: Clock,
  setting: SlidersHorizontal,
  sparkle: Sparkle,
  web: Globe,
  gear: GearSix,
  path: FolderOpen,
};

// The Launcher's apps and their icons, kept while the bar's window lives: every key reads them.
let appList: Promise<LauncherAppEntry[]> | null = null;
const appIcons = new Map<string, string | null>();

/**
 * The search box's panel: the rows for the text over the field, the best first (search/model.ts arrange), Enter or a click runs
 * the selected one (search/run.ts), Ctrl+Enter its second action. Fixed in size, so it never jumps while the text changes; with no
 * text, examples to try. What a setting changed shows under the field, with Rückgängig.
 */
export function SearchPanel() {
  const s = settings.use();
  const engine = barEngine(s.productivity.search);
  const [query, setQuery] = useState("");
  const [apps, setApps] = useState<LauncherAppEntry[]>([]);
  const [rates, setRates] = useState<Rates | null>(null);
  const [, setIconsIn] = useState(0);
  const [sel, setSel] = useState(-1);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    appList ??= launcher.apps().catch(() => []);
    let live = true;
    void appList.then((a) => live && setApps(a));
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

  const zones = useMemo(() => allZones(), []);
  const hits = useMemo(() => {
    if (!query.trim()) return [];
    const names = { tr: t, en: (key: string) => english(t(key)) };
    const running = (id: string) => barWindows.get().groups.some((g) => g.windows.length > 0 && g.pins.some((p) => p.id === id));
    const money = rates ? (amount: number, from: string, to: string) => convertMoney(amount, from, to, rates) : undefined;
    const tools = s.tools.filter((x) => x.enabled && toolInfo[x.id]).map((x) => ({ id: x.id, label: toolInfo[x.id].label }));
    const widgets = PART_IDS.map((id) => ({ id, label: partInfo[id].label }));
    const themes = allThemes().map((th) => ({ id: th.id, name: th.name }));
    return arrange(
      [
        answerHit(query, { now: new Date(), locale: locale(), h12: s.units.clock === "12", zones, money }),
        ...appHits(apps, query, running, t),
        ...toolHits(query, tools, names),
        ...settingHits(query, { ...names, themes }),
        ...widgetHits(query, widgets, s.taskbar.zones, names),
        settingsSearchHit(query.trim(), t),
        webOrPathHit(query, engine, t),
      ].filter((h): h is Hit => h !== null),
    );
  }, [query, apps, rates, s, engine, zones]);

  // A new list starts on its best row; the selected row stays in view.
  const keys = hits.map((h) => h.key).join("\n");
  useEffect(() => setSel(firstSelected(hits)), [keys]); // eslint-disable-line react-hooks/exhaustive-deps
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

  const run = async (i: number, alt = false) => {
    const action = alt ? hits[i]?.alt : hits[i]?.action;
    if (!action) return;
    const out = await runAction(action, engine);
    if (out.close) return closePanel();
    setOutcome(out.done || out.error ? out : null);
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
      setSel((i) => Math.min(hits.length - 1, Math.max(0, i + by)));
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (sel >= 0) void run(sel, e.ctrlKey);
    }
  };

  const tries = ["12*8.5", "100 usd to eur", "time in tokyo", t("Wetter"), `${t("Lautstärke")} 30`, `${t("Höhe")} 44`];
  return (
    <div className="flex h-full flex-col gap-2 p-3" onKeyDownCapture={onKey}>
      <div ref={list} role="listbox" aria-label={t("Suchergebnisse")} className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {query.trim() ? (
          hits.map((h, i) => <Row key={h.key} hit={h} index={i} selected={i === sel} onPick={() => void run(i)} onHover={() => setSel(i)} />)
        ) : (
          <div className="flex flex-col gap-2 p-1">
            <p className="text-caption text-label-3">{t("Probier")}</p>
            <div className="flex flex-wrap gap-1.5">
              {tries.map((x) => (
                <button key={x} type="button" className="pressable rounded-full bg-fill-2 px-2.5 py-1 text-caption text-label-2" onMouseDown={(e) => e.preventDefault()} onClick={() => setQuery(x)}>
                  {x}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <MagnifyingGlass size={14} weight="bold" className="shrink-0 text-label-3" />
        <TextField
          value={query}
          onChange={(v) => {
            setQuery(v);
            setOutcome(null);
          }}
          placeholder={t("App, Datei, Widget, Rechnung oder Einstellung suchen")}
          width="flex-1"
          autoFocus
          invalid={!!outcome?.error}
        />
      </div>
      <p role="status" className={`flex h-4 min-w-0 items-center gap-1.5 text-caption ${outcome?.error ? "text-red" : "text-label-3"}`}>
        {outcome?.done && <Check size={12} weight="bold" className="shrink-0" />}
        <span className="truncate">{outcome?.error ?? outcome?.done ?? ""}</span>
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
  const Glyph: Icon | undefined =
    "tool" in icon ? toolInfo[icon.tool]?.icon : "part" in icon ? partInfo[icon.part]?.icon : "glyph" in icon ? GLYPHS[icon.glyph] : icon.folder ? Folder : File;
  return <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-fill-2 text-label-2">{Glyph && <Glyph size={14} weight="bold" />}</span>;
}
