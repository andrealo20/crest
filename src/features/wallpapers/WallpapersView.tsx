import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { AnimatePresence, motion } from "motion/react";
import { artwork, fade, springs } from "../../design/motion";
import { locale, t } from "../../i18n";
import { holdOpen } from "../../notch/useNotchState";
import { isMac } from "../../platform/native";
import { filePreview, wallpapers, type WallNow } from "../../platform/services";
import { settings, updateSettings } from "../../settings/store";
import { Button, Segmented, Select } from "../../ui/controls";
import { CheckCircle } from "../../ui/iconset";
import { COLLECTION, bytesOf } from "./collection";
import { EVERY, baseName, type WallEvery, type WallFit, type WallpaperSettings } from "./model";
import { creditOf, screenOf, setWallpaper, useWallNow, wallShow } from "./store";
import { THUMBS } from "./thumbs";

/*
 * Wallpapers: Crest's collection or a folder, a click on a picture to set it on every screen or the one chosen in Monitor, the fit
 * and the automatic change. A picture of the collection comes from GitHub the first time it is used; Download fetches the rest at
 * once, Remove deletes them. The tool follows the wallpaper while it is open (store.ts followWall).
 */

const setWall = (patch: Partial<WallpaperSettings>) => updateSettings((s) => ({ wallpapers: { ...s.wallpapers, ...patch } }));
const mb = (bytes: number) => (bytes / 1_000_000).toLocaleString(locale(), { maximumFractionDigits: 1 });
/** The collection this build shows: the pictures it carries a thumbnail of (thumbs.ts). */
const GALLERY = COLLECTION.filter((p) => THUMBS[p.id]);

export function WallpapersView() {
  const cfg = settings.use().wallpapers;
  const now = useWallNow();
  const screens = now?.screens ?? [];
  // Not saved: a screen chosen once is not where the next picture should go.
  const [picked, setPicked] = useState<string | null>(null);
  const screen = screens.some((s) => s.id === picked) ? picked : null;
  // The picture being set, and whether the last change failed (said until the next one).
  const [pending, setPending] = useState<{ crest?: string; path?: string } | null>(null);
  const [failed, setFailed] = useState(false);
  // Which pictures of the collection are on the PC; read again after each download, removal and choice.
  const [present, setPresent] = useState<string[] | null>(null);
  const [epoch, setEpoch] = useState(0);
  const reread = () => setEpoch((n) => n + 1);

  useEffect(() => {
    let alive = true;
    void wallpapers.list("crest", "").then((ids) => alive && setPresent(ids), () => alive && setPresent([]));
    return () => void (alive = false);
  }, [epoch]);

  const change = (pick: { crest?: string; path?: string } | null, job: () => Promise<unknown>) => {
    setFailed(false);
    setPending(pick);
    void job()
      .catch(() => setFailed(true))
      .finally(() => {
        setPending(null);
        reread();
      });
  };
  const choose = (pick: { crest?: string; path?: string }) => change(pick, () => setWallpaper(pick, screen));
  const current = screenOf(now, screen);
  const label = (i: number) => (screens[i].primary ? t("Hauptbildschirm") : t("Bildschirm {n}", { n: i + 1 }));
  const fits: { value: WallFit; label: string }[] = [
    { value: "fill", label: t("Füllen") },
    { value: "fit", label: t("Einpassen") },
    ...(!isMac && (screens.length > 1 || cfg.fit === "span") ? [{ value: "span" as const, label: t("Über alle Bildschirme") }] : []),
  ];
  const every = (v: WallEvery) => (v === 0 ? t("Aus") : v === 1440 ? t("Jeden Tag") : v === 60 ? t("{n} Std.", { n: 1 }) : t("{n} Min.", { n: v }));
  const credit = creditOf(screenOf(now, null));
  const busy = pending !== null;

  return (
    <div className="flex h-full flex-col gap-2 px-3 pt-1 pb-3">
      <div className="flex h-8 shrink-0 items-center gap-2">
        <Segmented
          id="wallpapers-source"
          label={t("Hintergründe")}
          value={cfg.source}
          options={[{ value: "crest", label: t("Sammlung") }, { value: "folder", label: t("Eigener Ordner") }]}
          onChange={(source) => setWall({ source })}
        />
        {screens.length > 1 && (
          <span className="ms-auto flex items-center gap-2">
            <span className="text-footnote text-label-2">{t("Monitor")}</span>
            <Select
              value={screen ?? ""}
              width="w-40"
              options={[{ value: "", label: t("Alle Bildschirme") }, ...screens.map((s, i) => ({ value: s.id, label: label(i) }))]}
              onChange={(v) => setPicked(v || null)}
            />
          </span>
        )}
      </div>

      {cfg.source === "crest" ? (
        <>
          <PackRow present={present} fetching={!!pending?.crest && !!present && !present.includes(pending.crest)} busy={busy} onDone={reread} />
          <Grid>
            {GALLERY.map((p, i) => {
              const name = p.author ? t("Foto: {name} auf Unsplash", { name: p.author }) : `${t("Bild {n}", { n: i + 1 })}, ${t("Quelle unbekannt")}`;
              return <Tile key={p.id} src={THUMBS[p.id]} label={name} current={current?.crest === p.id} disabled={busy} onClick={() => choose({ crest: p.id })} />;
            })}
          </Grid>
        </>
      ) : (
        <FolderPart folder={cfg.folder} now={now} screen={screen} busy={busy} onChoose={(path) => choose({ path })} />
      )}

      <div className="flex h-8 shrink-0 items-center gap-2">
        <span className="text-footnote text-label-2">{t("Bildanpassung")}</span>
        <Select
          value={cfg.fit}
          width="w-28"
          options={fits}
          onChange={(fit) => {
            setWall({ fit });
            change(null, () => wallpapers.fit(fit));
          }}
        />
        <span className="ms-1 text-footnote text-label-2">{t("Automatisch wechseln")}</span>
        <Select
          value={String(cfg.every)}
          width="w-28"
          options={EVERY.map((v) => ({ value: String(v), label: every(v) }))}
          onChange={(v) => {
            // Turned on, or a new interval: it waits a whole one from now.
            wallShow.set({ at: Date.now() });
            setWall({ every: Number(v) as WallEvery });
          }}
        />
        <span dir="auto" title={failed ? undefined : (credit ?? undefined)} className={`ms-auto min-w-0 truncate text-caption ${failed ? "text-orange" : "text-label-3"}`}>
          {failed ? t("Hintergrundbild nicht geändert") : credit}
        </span>
      </div>
    </div>
  );
}

/** The collection's full pictures: what is still to come from GitHub or what is on the PC, with Download and Remove. */
function PackRow({ present, fetching, busy, onDone }: { present: string[] | null; fetching: boolean; busy: boolean; onDone: () => void }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<"download" | "remove" | null>(null);
  if (present === null) return <div className="h-8 shrink-0" />;
  const here = GALLERY.filter((p) => present.includes(p.id)).map((p) => p.id);
  const missing = GALLERY.filter((p) => !present.includes(p.id)).map((p) => p.id);
  const run = (kind: "download" | "remove") => {
    setError(null);
    setWorking(true);
    void (kind === "download" ? wallpapers.download() : wallpapers.remove())
      .catch(() => setError(kind))
      .finally(() => {
        setWorking(false);
        onDone();
      });
  };
  const text =
    working || fetching
      ? t("Wird geladen …")
      : error === "remove"
        ? t("Löschen fehlgeschlagen")
        : error
          ? t("Download fehlgeschlagen, später noch einmal versuchen")
          : missing.length
            ? t("Die Bilder in voller Größe kommen einmal von GitHub ({mb} MB) und bleiben dann auf dem PC", { mb: mb(bytesOf(missing)) })
            : t("{mb} MB im App-Datenordner", { mb: mb(bytesOf(here)) });
  return (
    <div className="flex h-8 shrink-0 items-center gap-2">
      <span role="status" className={`min-w-0 flex-1 truncate text-caption ${error && !working ? "text-orange" : "text-label-3"}`}>
        {text}
      </span>
      {missing.length > 0 && (
        <Button disabled={working || busy} onClick={() => run("download")}>
          {t("Laden")}
        </Button>
      )}
      {here.length > 0 && (
        <Button disabled={working || busy} onClick={() => run("remove")}>
          {t("Entfernen")}
        </Button>
      )}
    </div>
  );
}

/** The chosen folder's name and Folder …, then its pictures. */
function FolderPart({ folder, now, screen, busy, onChoose }: { folder: string; now: WallNow | null; screen: string | null; busy: boolean; onChoose: (path: string) => void }) {
  // "folder": gone or unreadable.
  const [files, setFiles] = useState<string[] | "folder" | null>(null);
  // The previews read so far, kept while the folder stays.
  const previews = useMemo(() => new Map<string, string | null>(), [folder]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    setFiles(null);
    if (folder) void wallpapers.list("folder", folder).then((list) => alive && setFiles(list), () => alive && setFiles("folder"));
    return () => void (alive = false);
  }, [folder]);
  const pick = async () => {
    // The picker takes the pointer off the notch and the focus off the bar's panel: both stay open meanwhile.
    holdOpen(true);
    try {
      const path = await wallpapers.folder();
      if (path) setWall({ folder: path });
    } finally {
      holdOpen(false);
    }
  };
  const current = screenOf(now, screen)?.path.toLowerCase();
  return (
    <>
      <div className="flex h-8 shrink-0 items-center gap-2">
        <span dir="auto" title={folder || undefined} className="min-w-0 flex-1 truncate text-caption text-label-3">
          {files === "folder" ? t("Ordner nicht verfügbar") : files?.length === 0 ? t("Keine Bilder in diesem Ordner") : folder && baseName(folder)}
        </span>
        <Button onClick={() => void pick()}>{t("Ordner …")}</Button>
      </div>
      <Grid>
        {Array.isArray(files) &&
          files.map((path) => (
            <FolderTile key={path} path={path} label={baseName(path)} previews={previews} current={path.toLowerCase() === current} disabled={busy} onClick={() => onChoose(path)} />
          ))}
      </Grid>
    </>
  );
}

/** Four pictures a row, scrolling. */
function Grid({ children }: { children: ReactNode }) {
  return <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-4 gap-2 overflow-y-auto [scrollbar-width:thin]">{children}</div>;
}

/** A folder's picture, its preview read once it scrolls into view. */
function FolderTile({ path, previews, ...rest }: { path: string; previews: Map<string, string | null> } & Omit<TileProps, "src">) {
  const ref = useRef<HTMLButtonElement>(null);
  const [src, setSrc] = useState(previews.get(path) ?? null);
  useEffect(() => {
    const el = ref.current;
    if (previews.has(path) || !el) return;
    let alive = true;
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      seen.disconnect();
      void filePreview(path).then(
        (url) => {
          previews.set(path, url);
          if (alive) setSrc(url);
        },
        () => previews.set(path, null),
      );
    });
    seen.observe(el);
    return () => {
      alive = false;
      seen.disconnect();
    };
  }, [path, previews]);
  return <Tile ref={ref} src={src} {...rest} />;
}

interface TileProps {
  src: string | null;
  label: string;
  current: boolean;
  disabled: boolean;
  onClick: () => void;
  ref?: Ref<HTMLButtonElement>;
}

/** A picture as a 16:9 button; the one on the chosen screen has a ring and a check. */
function Tile({ src, label, current, disabled, onClick, ref }: TileProps) {
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      aria-pressed={current}
      disabled={disabled}
      onClick={onClick}
      className="pressable relative grid aspect-video overflow-hidden rounded-[8px] bg-fill-2 disabled:cursor-progress"
    >
      <AnimatePresence initial={false}>
        {src && (
          <motion.img
            key={src}
            src={src}
            alt=""
            draggable={false}
            className="col-start-1 row-start-1 size-full object-cover"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: artwork.enter }}
            exit={{ opacity: 0, transition: fade }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {current && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[8px] shadow-[inset_0_0_0_2px_var(--color-accent)] material:shadow-[inset_0_0_0_2px_var(--color-primary)]"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1, transition: springs.pop }}
            exit={{ opacity: 0, scale: 0.9, transition: fade }}
          >
            <span className="absolute end-1 top-1 grid place-items-center rounded-full bg-notch">
              <CheckCircle size={16} weight="fill" className="text-accent material:text-primary" />
            </span>
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}
