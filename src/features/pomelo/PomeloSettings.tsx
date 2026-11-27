import { useEffect, useState } from "react";
import { formatBytes } from "../../lib/format";
import { isNative } from "../../platform/native";
import { windowKind } from "../../lib/windowKind";
import { filesEngine, pomeloWheel } from "../../platform/services";
import { settings, updateSettings } from "../../settings/store";
import { Button, Group, Row, Segmented, Select, Slider, Switch, TextField } from "../../ui/controls";
import { language, t } from "../../i18n";
import { engineLang } from "../files/model";
import { LicenseRows, PomeloSite } from "../files/LicenseRows";
import { cancelDownload, download, downloadFailed, downloading, engine, loadEngine } from "../files/store";
import { groupTitle, keyOf, listText, packageNeed, parseList, parseWhole, RETRY_PHASES, rowSymbol, selectWidth, shortPath, shownRows, valueOf, type Control, type SchemaRow, type WheelState } from "./model";
import { followWheel, forgetSchema, pomeloValues, reloadPomeloValues, schema, setPomeloValue, wheelState } from "./store";

/*
 * The Pomelo scope of the settings window: its first page (the wheel, the package, the licence), then the pages of Pomelo's own
 * settings as the engine's schema gives them, drawn with Crest's controls. Every change goes through the engine, which checks it.
 */

type Need = ReturnType<typeof packageNeed>;

function stateText(s: WheelState, on: boolean, need: Need | null): string {
  if (!on) return t("Aus");
  if (!need) return t("Wird geladen …");
  if (need !== "ready" || s.phase === "missing") return t("Diesem Paket fehlt das Rad: Programm aktualisieren");
  if (s.phase === "conflict") {
    if (s.with === "store") return t("Pomelo aus dem Microsoft Store läuft schon. Schließe es und versuche es noch einmal.");
    if (s.with === "hosted") return t("Eine andere Crest-Kopie hat das Pomelo-Rad schon. Schließe sie und versuche es noch einmal.");
    return t("Eine andere Kopie von Pomelo läuft schon. Schließe sie und versuche es noch einmal.");
  }
  if (s.phase === "crashed") return t("Mehrmals abgestürzt. Versuche es noch einmal.");
  if (s.phase === "stopped") return t("Pomelo hat sich beendet");
  if (s.phase === "failed") return t("Pomelo ist nicht gestartet");
  if (s.phase === "ready" && s.locked)
    return s.left ? t("Ein Vorgang wurde abgelehnt: zu wenige Gratis-Dateien (noch {n})", { n: s.left }) : t("Ein Vorgang wurde abgelehnt: keine Gratis-Dateien mehr");
  if (s.phase === "ready") return t("Läuft und wartet auf gezogene Dateien");
  return t("Startet …");
}

/** The scope's first page. */
export function PomeloMain() {
  const status = engine.use();
  const wheel = wheelState.use();
  const on = settings.use().pomelo.wheel;
  const lang = language.use();
  const progress = downloading.use();
  const failed = downloadFailed.use();
  const [store, setStore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    void loadEngine();
    followWheel();
    void pomeloWheel.storeInstalled().then(setStore, () => {});
  }, []);

  const need = status ? packageNeed(status) : null;
  const setOn = (wheel: boolean) => {
    updateSettings((s) => ({ pomelo: { ...s.pomelo, wheel } }));
    // In the app the notch sends the switch (store.ts startPomeloWheel); the browser has no notch behind this page.
    if (!isNative) void pomeloWheel.set(wheel, engineLang(lang));
  };
  const retry = on && need === "ready" && RETRY_PHASES.includes(wheel.phase);
  const remove = () => {
    setBusy(true);
    setNote(null);
    filesEngine
      .remove()
      .then(forgetSchema)
      .catch((e) => setNote(String(e) === "wheel" ? t("Zuerst das Pomelo-Rad ausschalten") : t("Fehlgeschlagen")))
      .finally(() => {
        setBusy(false);
        void loadEngine();
      });
  };
  const packageHint = progress
    ? progress.total
      ? `${formatBytes(progress.done)} / ${formatBytes(progress.total)}`
      : formatBytes(progress.done)
    : (note ??
      failed ??
      (need === "ready"
        ? t("Pomelo {v}", { v: status?.version ?? "" })
        : !status?.available
          ? t("Das Programm ist noch nicht verfügbar")
          : need === "update"
            ? t("Diese Version hat das Rad noch nicht")
            : status.size > 0
              ? t("Download: {size}", { size: formatBytes(status.size) })
              : t("Nicht heruntergeladen")));

  return (
    <>
      <Group title={t("Pomelo-Rad")} id="settings-pomelo">
        <Row
          icon="touch_app"
          label={t("Pomelo-Rad")}
          hint={t("Zieh Dateien im Explorer und halte Umschalt, Strg oder Alt: Ein Rad mit den Umwandlungen und Werkzeugen von Pomelo erscheint.")}
        >
          {(need === "ready" || on) && <Switch label={t("Pomelo-Rad")} checked={on} onChange={setOn} />}
        </Row>
        <Row icon="public" label={t("Was ist Pomelo?")} hint={t("Seine Website zeigt, was es kann, bevor du etwas herunterlädst")}>
          <PomeloSite />
        </Row>
        <Row icon="info" label={t("Status")} hint={stateText(wheel, on, need)}>
          {retry && <Button onClick={() => void pomeloWheel.set(true, engineLang(lang))}>{t("Erneut versuchen")}</Button>}
        </Row>
        {/* A quiet note while it is only installed; a warning once it keeps the wheel here from starting. */}
        {store && (
          <Row
            icon={wheel.phase === "conflict" && wheel.with === "store" ? "warning" : "info"}
            label={t("Pomelo aus dem Microsoft Store")}
            hint={t("Ist auf diesem PC installiert. Solange es läuft, startet das Rad hier nicht.")}
          />
        )}
      </Group>
      <Group title={t("Programm")} id="settings-pomelo-package">
        <Row
          icon="download_done"
          label={t("Pomelo")}
          hint={
            status?.bundled
              ? t("Ein eigenes Programm, das im Paket von Crest aus dem Microsoft Store mitkommt. Es ist nicht Teil von Crest und nicht quelloffen.")
              : t("Ein eigenes Programm, das Crest erst auf Wunsch herunterlädt. Es ist nicht Teil von Crest und nicht quelloffen.")
          }
        />
        {/* The Store's package carries it: nothing to download, update or remove. */}
        <Row icon="download" label={t("Programm")} hint={packageHint}>
          {status?.bundled ? null : progress ? (
            <Button onClick={cancelDownload}>{t("Abbrechen")}</Button>
          ) : (
            <>
              {need !== "ready" && (
                <Button primary disabled={!status?.available} onClick={download}>
                  {need === "update" ? t("Programm aktualisieren") : t("Programm herunterladen")}
                </Button>
              )}
              {status?.version && (
                <Button disabled={busy} onClick={remove}>
                  {t("Entfernen")}
                </Button>
              )}
            </>
          )}
        </Row>
      </Group>
      <Group title={t("Lizenz")} id="settings-pomelo-license">
        <LicenseRows installed={!!status?.version} refresh={wheel.locked ? 1 : 0} takesLink={windowKind === "settings"} />
        <Row icon="receipt_long" label={t("Gratis-Dateien")} hint={t("Die ersten 20 Dateien sind gratis, danach 2 pro Tag. Das Rad und das Tool Dateien zählen zusammen.")} />
      </Group>
    </>
  );
}

/** One page of Pomelo's settings, as the schema gives it. */
export function PomeloSchemaPage({ id }: { id: string }) {
  const loaded = schema.use();
  const values = pomeloValues.use();
  const ready = wheelState.use().phase === "ready";
  useEffect(followWheel, []);
  // Pomelo's own window (Open on a row) may change any setting: read again when this window comes back to the front.
  useEffect(() => {
    window.addEventListener("focus", reloadPomeloValues);
    return () => window.removeEventListener("focus", reloadPomeloValues);
  }, []);
  if (!loaded) return <div className="px-3 pt-2 text-caption text-label-3">{t("Wird geladen …")}</div>;
  const page = loaded.pages.find((p) => p.id === id);
  if (!page) return <div className="px-3 pt-2 text-caption text-label-3">{t("Fehlgeschlagen")}</div>;
  return (
    <>
      {page.groups.map((group, i) => (
        <Group key={i} title={groupTitle(group)} id={i === 0 ? `settings-pomelo-${id}` : undefined}>
          {shownRows(group, values, loaded.defaults).map(({ row, control }) => (
            <SchemaRowView key={row.key} row={row} control={control} value={valueOf(row, values)} ready={ready} />
          ))}
        </Group>
      ))}
    </>
  );
}

function SchemaRowView({ row, control, value, ready }: { row: SchemaRow; control: Control; value: unknown; ready: boolean }) {
  const lang = language.use();
  const [error, setError] = useState<string | null>(null);
  // A text being typed, and a slider being dragged: written once, when done.
  const [draft, setDraft] = useState<string | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const save = (v: unknown) => {
    setError(null);
    // A key given to one tab moves the key that tab had to the one that held it: the values are read again.
    void setPomeloValue(row.key, v, control === "keys").then(setError);
  };
  const shown = control === "list" ? listText(value) : value == null ? "" : String(value);
  const commit = () => {
    if (draft === null || draft === shown) return setDraft(null);
    const v = control === "number" ? parseWhole(row, draft) : control === "list" ? parseList(draft) : draft;
    setDraft(null);
    if (v === undefined) setError(t("Wird nicht angenommen"));
    else save(v);
  };
  const choices = (row.choices ?? []).map((c) => ({ value: c.id, label: c.label }));
  const width = selectWidth(choices.map((c) => c.label));
  const number = typeof value === "number" ? value : (row.min ?? 0);

  let field: React.ReactNode;
  if (control === "switch") field = <Switch label={row.label} checked={value === true} onChange={save} />;
  else if (control === "slider")
    field = (
      // As Crest's own sliders (ThemeSettings): a track of fixed width, then the value.
      <div className="flex w-52 shrink-0 items-center gap-2">
        <Slider
          label={row.label}
          value={live ?? number}
          min={row.min!}
          max={row.max!}
          step={row.step}
          onChange={setLive}
          onRelease={() => {
            if (live !== null && live !== value) save(live);
            setLive(null);
          }}
        />
        <span className="tabular w-10 shrink-0 text-end text-caption text-label-2">{live ?? number}</span>
      </div>
    );
  else if (control === "segmented") field = <Segmented id={`pomelo-${row.key}`} label={row.label} value={String(value)} options={choices} onChange={save} />;
  else if (control === "select") field = <Select value={String(value)} options={choices} onChange={save} width={width} />;
  else if (control === "folder") {
    const path = typeof value === "string" ? value : "";
    field = (
      <>
        {path && (
          <span className="max-w-60 truncate text-caption text-label-2" title={path}>
            {shortPath(path)}
          </span>
        )}
        <Button onClick={() => void filesEngine.pickFolder().then((dir) => dir && save(dir))}>{t("Ändern")}</Button>
      </>
    );
  } else if (control === "button")
    field = row.page && (
      <Button disabled={!ready} onClick={() => void pomeloWheel.open(row.page!, engineLang(lang)).catch(() => setError(t("Fehlgeschlagen")))}>
        {t("Öffnen")}
      </Button>
    );
  else field = <TextField value={draft ?? shown} onChange={setDraft} onSubmit={commit} onBlur={commit} invalid={!!error} width="w-40" />;

  const hint = error ? <span className="text-red">{error}</span> : control === "button" && !ready ? t("Wenn das Pomelo-Rad läuft") : row.hint;
  if (control === "keys")
    // Three choices beside the text would squeeze it to a word a line: they go under it, across the row.
    return (
      <div>
        <Row icon={rowSymbol(row)} label={row.label} hint={hint} />
        <div className="flex flex-wrap gap-x-4 gap-y-2 px-3 pb-2 roomy:ps-[60px] roomy:pe-[14px]">
          {(row.parts ?? []).map((part) => (
            <span key={part.id} className="flex items-center gap-2 text-caption text-label-2">
              {part.label}
              <Select value={keyOf(value, part.id)} options={choices} onChange={(key) => save({ [part.id]: key })} width={width} />
            </span>
          ))}
        </div>
      </div>
    );
  return (
    <Row icon={rowSymbol(row)} label={row.label} hint={hint}>
      {field}
    </Row>
  );
}
