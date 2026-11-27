import { useEffect, useState } from "react";
import { Check, DownloadSimple, Files, FolderOpen, Key, Play, SlidersHorizontal, Tray, Warning, X } from "../../ui/iconset";
import { formatBytes } from "../../lib/format";
import { isTaskbarWindow } from "../../lib/windowKind";
import { HeaderActions, HeaderButton } from "../../notch/header";
import { navigate } from "../../notch/nav";
import { filesDrop } from "../../platform/drop";
import { filesEngine, revealFile, type EngineStatus } from "../../platform/services";
import { settings } from "../../settings/store";
import { Button, Meter, Segmented, Select, Switch, TextField } from "../../ui/controls";
import { language, t } from "../../i18n";
import { addToShelf, shelfFiles } from "../shelf/ShelfView";
import { compatible, defaultValues, engineLang, outputsOf, tabsOf, type FileTab, type Op, type OpOption, type RunState } from "./model";
import { addPaths, cancelDownload, cancelJob, clearJob, closeRun, download, downloadFailed, downloading, engine, job, loadEngine, runError, runJob } from "./store";

/*
 * Files: conversions and file tools from a separate engine (src-tauri/src/pomelo_engine), downloaded once on request.
 *
 *   [a.jpg  b.png  +2]                     [From the Shelf] [x]
 *   (Convert) Tools  Actions
 *   [PNG] [JPG] [WebP]
 *   Quality [85]                                      [Start]
 *
 * Files come by a drop on the open tool (`filesDrop`, never the Shelf meanwhile) or from the Shelf; the operations shown are
 * those that take all of them. A run shows each file's progress, then its result. The files, the run and the download live in
 * store.ts, so closing the notch loses none of them.
 */

export function FilesView() {
  const status = engine.use();
  useEffect(() => void loadEngine(), []);
  const actions = (
    <HeaderActions>
      <HeaderButton label={t("Einstellungen für Dateien")} onClick={() => navigate("settings", "files")}>
        <SlidersHorizontal size={14} weight="bold" />
      </HeaderButton>
    </HeaderActions>
  );
  if (!status) return actions;
  return (
    <>
      {actions}
      {status.version ? <Workbench /> : <Intro status={status} />}
    </>
  );
}

/** First opening, without the engine: what it does, the download and the licence. */
function Intro({ status }: { status: EngineStatus }) {
  const progress = downloading.use();
  const error = downloadFailed.use();
  return (
    <div className="flex h-full flex-col gap-3 px-5 pt-1 pb-3">
      <div className="flex items-start gap-3">
        <Files size={26} weight="duotone" className="mt-0.5 shrink-0 text-label-3" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-body text-label">{t("Bilder, PDFs, Audio und Video umwandeln und bearbeiten, ohne die Originale zu ändern")}</p>
          <p className="text-caption text-label-3">
            {t("Das erledigt ein eigenes Programm auf diesem PC, das Crest erst auf Wunsch herunterlädt. Es ist nicht Teil von Crest und nicht quelloffen.")}
          </p>
        </div>
      </div>
      <ul className="flex flex-col gap-1 ps-[38px] text-caption text-label-2">
        {status.size > 0 && <li>{t("Download: {size}", { size: formatBytes(status.size) })}</li>}
        <li>{t("Die ersten Dateien sind gratis, danach einmalig 4,99 USD. Der Schlüssel gilt in jeder Version von Crest.")}</li>
      </ul>
      <div className="mt-auto flex min-h-8 items-center gap-3 ps-[38px]">
        {progress ? (
          <>
            <div className="min-w-0 flex-1">
              <Meter percent={progress.total ? (progress.done / progress.total) * 100 : 0} color="var(--color-primary)" />
            </div>
            <span className="tabular shrink-0 text-caption text-label-3">
              {progress.total ? `${formatBytes(progress.done)} / ${formatBytes(progress.total)}` : formatBytes(progress.done)}
            </span>
            <Button onClick={cancelDownload}>{t("Abbrechen")}</Button>
          </>
        ) : (
          <>
            <Button primary icon={DownloadSimple} disabled={!status.available} onClick={download}>
              {t("Programm herunterladen")}
            </Button>
            {(error || !status.available) && <span className="truncate text-caption text-orange">{error ?? t("Das Programm ist noch nicht verfügbar")}</span>}
          </>
        )}
      </div>
    </div>
  );
}

const tabLabel = (tab: FileTab) => (tab === "convert" ? t("Umwandeln") : tab === "tools" ? t("Werkzeuge") : t("Aktionen"));
const nameOf = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** With the engine: the files, the operations that fit them, a run. */
function Workbench() {
  const outDir = settings.use().files.outDir;
  const lang = language.use();
  const { paths, run, running, failed: runFailed } = job.use();
  const [ops, setOps] = useState<Op[] | null>(null);
  const [catalogFailed, setCatalogFailed] = useState<string | null>(null);
  const [tab, setTab] = useState<FileTab>("convert");
  const [opId, setOpId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [secret, setSecret] = useState("");
  const failed = runFailed ?? catalogFailed;

  useEffect(() => {
    let alive = true;
    filesEngine
      .catalog(engineLang(lang))
      .then((list) => alive && setOps(list))
      .catch((e) => alive && setCatalogFailed(runError(String(e))));
    return () => void (alive = false);
  }, [lang]);

  // While the tool shows, files dropped on the notch come here. The bar's window takes no drops.
  useEffect(() => {
    if (isTaskbarWindow) return;
    filesDrop.set(() => addPaths);
    return () => filesDrop.set(null);
  }, []);

  const fit = compatible(ops ?? [], paths);
  const tabs = tabsOf(fit);
  const shownTab = tabs.includes(tab) ? tab : (tabs[0] ?? "convert");
  const op = fit.find((o) => o.id === opId) ?? null;
  const pick = (o: Op) => {
    setOpId(o.id);
    setValues(defaultValues(o));
    setSecret("");
  };

  const start = () => {
    if (!op) return;
    runJob({ op: op.id, out: outDir || null, options: op.options.map((o) => [o.id, values[o.id] ?? ""]), secret: op.secret ? secret : null, lang: engineLang(lang) });
  };
  const clear = () => {
    clearJob();
    setOpId(null);
  };

  const fromShelf = shelfFiles().filter((p) => !paths.includes(p));
  const shelfButton = fromShelf.length > 0 && (
    <Button icon={Tray} onClick={() => addPaths(fromShelf)}>
      {t("Aus der Ablage")}
    </Button>
  );

  if (!paths.length) {
    return (
      <div className="flex h-full flex-col px-4 pt-1 pb-3">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-label-4 text-center">
          <Files size={24} weight="duotone" className="text-label-3" />
          <span className="text-body text-label-2">{t("Dateien hierher ziehen")}</span>
          {failed && <span className="max-w-80 text-caption text-orange">{failed}</span>}
          {shelfButton}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 px-4 pt-1 pb-3">
      <div className="flex h-7 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-footnote text-label-2" title={paths.map(nameOf).join("\n")}>
          {paths.length === 1 ? nameOf(paths[0]) : t("{n} Dateien", { n: paths.length })}
          <span className="text-label-4"> · {paths.slice(paths.length === 1 ? 1 : 0, 3).map(nameOf).join(", ")}</span>
        </span>
        {!running && shelfButton}
        <HeaderButton label={running ? t("Abbrechen") : t("Leeren")} onClick={running ? cancelJob : clear}>
          <X size={14} weight="bold" />
        </HeaderButton>
      </div>

      {run ? (
        <Results run={run} running={running} failed={failed} onDone={closeRun} />
      ) : (
        <>
          {tabs.length > 0 && (
            <Segmented<FileTab> id="files-tab" label={t("Vorgänge")} size="sm" value={shownTab} onChange={setTab} options={tabs.map((x) => ({ value: x, label: tabLabel(x) }))} />
          )}
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto [scrollbar-width:none]">
            {ops === null && !failed && <span className="text-caption text-label-3">{t("Wird geladen …")}</span>}
            {ops !== null && fit.length === 0 && <span className="text-caption text-label-3">{t("Für diese Dateien gibt es keinen Vorgang")}</span>}
            <div className="flex flex-wrap gap-1.5">
              {fit
                .filter((o) => o.tab === shownTab)
                .map((o) => (
                  <button
                    key={o.id}
                    onClick={() => pick(o)}
                    aria-pressed={o.id === op?.id}
                    className={`pressable h-7 rounded-full px-3 text-footnote font-medium ${o.id === op?.id ? "bg-primary text-on-primary" : "pressable-fill bg-fill-2 text-label"}`}
                  >
                    {o.name}
                  </button>
                ))}
            </div>
            {op && (
              <div className="flex flex-col divide-y divide-separator rounded-[12px] bg-fill-1">
                {op.options.map((o) => (
                  <OptionRow key={o.id} option={o} value={values[o.id] ?? ""} onChange={(v) => setValues((s) => ({ ...s, [o.id]: v }))} />
                ))}
                {op.secret && (
                  <label className="flex min-h-9 items-center justify-between gap-3 px-3 py-1">
                    <span className="text-footnote text-label">{t("Passwort")}</span>
                    <TextField value={secret} onChange={setSecret} secret width="w-44" />
                  </label>
                )}
              </div>
            )}
            {failed && <span className="text-caption text-orange">{failed}</span>}
          </div>
          <div className="flex items-center justify-end gap-2">
            <span className="min-w-0 flex-1 truncate text-caption text-label-3">{outDir ? outDir : t("Neben den Originalen")}</span>
            <Button primary icon={Play} disabled={!op || (op.secret && !secret)} onClick={start}>
              {t("Starten")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function OptionRow({ option: o, value, onChange }: { option: OpOption; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3 px-3 py-1">
      <span className="truncate text-footnote text-label">{o.label || o.id}</span>
      {o.type === "bool" ? (
        <Switch label={o.label || o.id} checked={value === "true"} onChange={(v) => onChange(v ? "true" : "false")} />
      ) : o.type === "choice" ? (
        <Select<string> value={value} options={o.choices.map((c) => ({ value: c.id, label: c.label }))} onChange={onChange} />
      ) : (
        <TextField value={value} onChange={onChange} width={o.type === "int" ? "w-20" : "w-44"} invalid={o.type === "int" && !intOk(o, value)} />
      )}
    </div>
  );
}

const intOk = (o: OpOption, v: string) => /^-?\d+$/.test(v) && (o.min == null || Number(v) >= o.min) && (o.max == null || Number(v) <= o.max);

/** Each file's progress, then its result; the free files left, or the locked state with the way to a key. */
function Results({ run, running, failed, onDone }: { run: RunState; running: boolean; failed: string | null; onDone: () => void }) {
  const outputs = outputsOf(run);
  const shelfOn = settings.use().tools.some((x) => x.id === "shelf" && x.enabled);
  if (run.locked) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center">
        <Key size={22} weight="duotone" className="text-label-3" />
        <span className="max-w-96 text-body text-label-2">
          {run.left
            ? t("Für so viele Dateien reichen die gratis Dateien nicht (noch {n}). Mit einem Schlüssel geht es weiter, einmalig 4,99 USD.", { n: run.left })
            : t("Die gratis Dateien sind aufgebraucht. Mit einem Schlüssel geht es weiter, einmalig 4,99 USD.")}
        </span>
        <Button primary icon={Key} onClick={() => navigate("settings", "files")}>
          {t("Schlüssel eingeben")}
        </Button>
      </div>
    );
  }
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto [scrollbar-width:none]">
        {run.files.map((f) => (
          <div key={f.path} className="flex min-h-8 shrink-0 items-center gap-2 rounded-[10px] bg-fill-1 px-3 py-1">
            {f.status === "done" ? (
              <Check size={13} weight="bold" className="shrink-0 text-green" />
            ) : f.status === "error" ? (
              <Warning size={13} weight="bold" className="shrink-0 text-orange" />
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-footnote text-label">{nameOf(f.path)}</span>
              {f.error && <span className="text-caption text-orange">{f.error.message || runError(f.error.code)}</span>}
              {f.text && <span className="line-clamp-3 text-caption break-all text-label-2 select-text">{f.text}</span>}
            </div>
            {running && (f.status === "running" || f.status === "waiting") ? (
              <div className="w-28 shrink-0">
                {f.fraction === null ? <span className="text-caption text-label-3">{t("Läuft …")}</span> : <Meter percent={f.fraction * 100} color="var(--color-primary)" />}
              </div>
            ) : (
              f.outputs[0] && (
                <button aria-label={t("Im Ordner zeigen")} title={t("Im Ordner zeigen")} onClick={() => void revealFile(f.outputs[0])} className="pressable shrink-0 text-label-3 hover:text-label-2">
                  <FolderOpen size={14} weight="bold" />
                </button>
              )
            )}
          </div>
        ))}
        {(run.problem ?? failed) && <span className="text-caption text-orange">{run.problem ?? failed}</span>}
      </div>
      <div className="flex items-center justify-end gap-2">
        <span className="min-w-0 flex-1 truncate text-caption text-label-3">{run.left !== null && t("Noch {n} gratis Dateien", { n: run.left })}</span>
        {!running && outputs.length > 0 && shelfOn && (
          <Button icon={Tray} onClick={() => addToShelf(outputs)}>
            {t("Zur Ablage hinzufügen")}
          </Button>
        )}
        {!running && (
          <Button primary onClick={onDone}>
            {t("Fertig")}
          </Button>
        )}
      </div>
    </>
  );
}
