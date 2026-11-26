import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowCounterClockwise, WarningCircle } from "../../ui/iconset";
import { Button, Group, Row, Segmented, Select, Slider, StyleCards, Switch, TextField } from "../../ui/controls";
import type { RowSymbol } from "../../ui/materialNames";
import { formatTime } from "../../lib/format";
import { isMac } from "../../platform/native";
import { windowKind } from "../../lib/windowKind";
import { openFile, revealFile } from "../../platform/services";
import { demo } from "../../dev/showcase-data";
import { glassShape } from "../../notch/glass/params";
import { liveSupport } from "../../notch/glass/live";
import { settings, updateSettings } from "../../settings/store";
import { design, type Design } from "../../design/design";
import { t } from "../../i18n";
import { contrast, parseColor, toHex, withAlpha, type Rgba } from "./color";
import { ColorPicker } from "./ColorPicker";
import { HALF_HOURS, activeThemeId, isNight, sunHours } from "./daynight";
import { original } from "./history";
import {
  activeTheme,
  deleteCustomTheme,
  discardEdits,
  draft,
  draftName,
  editClosedNotch,
  editColor,
  exportTheme,
  forcedColors,
  importFromFolder,
  overwriteTheme,
  pickTheme,
  previewFor,
  previewTheme,
  saveAsNew,
  savedTheme,
  startEditing,
  systemFile,
  themesFolder,
  undoEdit,
} from "./store";
import { resolveMaterial } from "./material";
import {
  EDITOR_KEYS,
  FONT_NAMES,
  GLASS_RANGE,
  MATERIAL_SHAPES,
  SYSTEM_THEME,
  editorKeys,
  findTheme,
  fontStack,
  glassVeilAt,
  isBuiltIn,
  resolveTheme,
  themeChoices,
  type Adjustment,
  type FontId,
  type MaterialShape,
  type ThemeFile,
  type ThemeKey,
} from "./themes";

/** The two plain built-ins are named after their look; the ported editor themes keep their own names. */
const themeName = (theme: ThemeFile) =>
  !isBuiltIn(theme.id) ? theme.name : theme.id === "dark" ? t("Dunkel") : theme.id === "light" ? t("Hell") : theme.id === SYSTEM_THEME ? t("System") : theme.name;

/** Settings → Themes: the theme, day and night, the colour editor and theme files. */
export function ThemeSettings() {
  return (
    <>
      {!demo && <StyleChoice />}
      <ThemeChoice />
      <DayNight />
      <ThemeEditor />
      <ThemeFiles />
    </>
  );
}

const KEY_LABELS: Record<Adjustment["key"], string> = {
  background: "Hintergrund",
  foreground: "Vordergrund",
  secondary: "Zweiter Text",
  tertiary: "Dritter Text",
  accent: "Akzent",
  link: "Links",
  warning: "Warnung",
  critical: "Kritisch",
  success: "Erfolg",
  elevated: "Menüs",
  yellow: "Gelb",
};

/**
 * Crest's own look or Material, for the whole app. The cards are drawn, never made of real controls: under a Material window a
 * real Crest control would come out Material.
 */
function StyleChoice() {
  const { themes } = settings.use();
  const chosen = themes.design;
  activeTheme.use(); // the drawings follow the theme in use and the draft
  const file = draft.use()?.present ?? savedTheme();
  return (
    <Group title={t("Stil")} id="settings-design">
      {/* Only for the search, which reads rows: one text per hint node, so "Material" is found too. */}
      <div data-row aria-hidden className="sr-only">
        <div data-row-label>{t("Stil")}</div>
        <div data-row-hint>
          <span>{t("Formen, Farben, Symbole und Bewegung der ganzen App")}</span>
          <span>Crest · Material</span>
        </div>
      </div>
      <div className="p-2">
        <StyleCards<Design>
          columns={2}
          label={t("Stil")}
          value={chosen}
          onChange={(design) => updateSettings((cur) => ({ themes: { ...cur.themes, design } }))}
          options={[
            { value: "crest", label: "Crest", hint: t("Das gewohnte Aussehen"), preview: <CrestThumb file={file} /> },
            { value: "material", label: "Material", hint: t("Farben aus dem Theme, weiche Formen"), preview: <MaterialThumb file={file} /> },
          ]}
        />
      </div>
      {chosen === "material" && (
        <Row icon="wallpaper" label={t("Bewegter Hintergrund")} hint={t("Höhenlinien in den Farben des Themes hinter dem Einstellungsfenster, die bei jedem Seitenwechsel weiterziehen")}>
          <Switch
            label={t("Bewegter Hintergrund")}
            checked={themes.contours}
            onChange={(contours) => updateSettings((cur) => ({ themes: { ...cur.themes, contours } }))}
          />
        </Row>
      )}
      {chosen === "material" && (
        <Row icon="dark_mode" label={t("Reines Schwarz")} hint={t("Bei dunklen Themes ein schwarzer Hintergrund statt des dunklen Graus von Material")}>
          <Switch
            label={t("Reines Schwarz")}
            checked={themes.materialBlack}
            onChange={(materialBlack) => updateSettings((cur) => ({ themes: { ...cur.themes, materialBlack } }))}
          />
        </Row>
      )}
      {chosen === "material" && (
        <Row icon="category" label={t("Formen")} hint={t("Hinter den Werten von CPU und GPU und im Zeichen der Einstellungen")}>
          <Segmented<MaterialShape>
            id="material-shape"
            label={t("Formen")}
            size="sm"
            value={themes.materialShape}
            onChange={(materialShape) => updateSettings((cur) => ({ themes: { ...cur.themes, materialShape } }))}
            options={MATERIAL_SHAPES.map((value) => ({ value, label: t(SHAPE_LABEL[value]) }))}
          />
        </Row>
      )}
    </Group>
  );
}

/** A pill button and the green switch on the theme's panel, as the Crest style draws them. */
function CrestThumb({ file }: { file: ThemeFile }) {
  const v = useMemo(() => resolveTheme(file).vars, [file]);
  return (
    <span className="flex h-full w-full items-center justify-center gap-2 forced-color-adjust-none" style={{ background: v["--color-notch"] }}>
      <span className="flex h-3 w-7 items-center justify-center rounded-full" style={{ background: v["--color-fill-2"] }}>
        <span className="h-1 w-4 rounded-full" style={{ background: v["--color-label"] }} />
      </span>
      <span className="flex h-3 w-5 items-center justify-end rounded-full px-0.5" style={{ background: v["--color-green"] }}>
        <span className="size-2 rounded-full bg-white" />
      </span>
    </span>
  );
}

/** The Material shapes by name. */
const SHAPE_LABEL: Record<MaterialShape, string> = { wavy: "Wellig", circle: "Kreis", square: "Quadrat" };

/** A tonal button and the M3 switch on the theme's surface, as the Material style draws them, black as the setting asks. */
function MaterialThumb({ file }: { file: ThemeFile }) {
  const black = settings.use().themes.materialBlack;
  const v = useMemo(() => resolveMaterial(file, { black }).vars, [file, black]);
  return (
    <span className="flex h-full w-full items-center justify-center gap-2 forced-color-adjust-none" style={{ background: v["--color-notch"] }}>
      <span className="flex h-3.5 w-7 items-center justify-center rounded-full" style={{ background: v["--color-secondary-container"] }}>
        <span className="h-1 w-4 rounded-full" style={{ background: v["--color-on-secondary-container"] }} />
      </span>
      <span className="flex h-3.5 w-6 items-center justify-end rounded-full px-0.5" style={{ background: v["--color-primary"] }}>
        <span className="size-2.5 rounded-full" style={{ background: v["--color-on-primary"] }} />
      </span>
    </span>
  );
}

function ThemeChoice() {
  const s = settings.use();
  const { themes, weather } = s;
  activeTheme.use(); // re-render when day turns to night
  const style = design.use();
  const forced = forcedColors.use();
  const editing = draft.use();
  const [pending, setPending] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const system = systemFile.use();
  const current = findTheme(activeThemeId(themes, new Date(), weather), themes.custom, system);
  const list = themeChoices(system, themes.custom);

  // The preview only shows in Material's settings window (previewFor); elsewhere the grid schedules and writes nothing.
  const previews = style === "material" && windowKind === "settings";
  const timer = useRef(0);
  const stopPreview = () => {
    window.clearTimeout(timer.current);
    // storeCore's set always notifies, and each notify runs apply().
    if (previewTheme.get() !== null) previewTheme.set(null);
  };
  const hover = (id: string | null) => {
    if (id === null) return stopPreview();
    window.clearTimeout(timer.current);
    // Stellaria's delay, so crossing the grid flashes no colours; the last preview stays until this one fires.
    timer.current = window.setTimeout(
      () =>
        previewTheme.set(
          previewFor(list.find((x) => x.id === id) ?? null, {
            current: current.id,
            material: style === "material",
            settingsWindow: windowKind === "settings",
            focused: document.hasFocus(),
            editing: editing !== null,
            forced,
          }),
        ),
      220,
    );
  };
  useEffect(() => {
    if (pending) stopPreview();
  }, [pending]);
  useEffect(() => {
    if (!previews) return;
    window.addEventListener("blur", stopPreview);
    // Any key: the keyboard moves on from the card the pointer rests on.
    window.addEventListener("keydown", stopPreview);
    return () => {
      window.removeEventListener("blur", stopPreview);
      window.removeEventListener("keydown", stopPreview);
      stopPreview();
    };
  }, [previews]);

  const choose = (id: string) => {
    setConfirmDelete(false);
    if (editing && editing.past.length > 0) {
      stopPreview();
      return setPending(id);
    }
    discardEdits();
    pickTheme(id);
    // After the pick: updateSettings is synchronous, so ending the preview first would draw the old theme for a moment.
    stopPreview();
  };
  // For the saved look; a window rule can change it for a while (Notch.tsx works from the look on screen).
  const fits = glassShape(s.display.idleStyle, s.dock.edge);
  // The live glass's switch only where it can run: Windows 11 24H2 on x64, not the Store build (capture/glass_live.rs).
  const support = liveSupport.use();

  return (
    <Group title={t("Theme")} id="settings-themes">
      {forced && <Row icon="contrast" label={t("Windows-Kontrastdesign ist an")} hint={t("Crest zeigt die Systemfarben, bis es ausgeschaltet wird")} />}
      <div className="p-2">
        <StyleCards
          label={t("Theme")}
          value={current.id}
          onChange={choose}
          onHover={previews ? hover : undefined}
          options={list.map((theme) => ({ value: theme.id, label: themeName(theme), preview: <ThemePreview theme={theme} style={style} /> }))}
        />
        {style === "material" && (
          <p className="px-1 pt-2 text-caption text-label-2">{t("In Material gibt jedes Theme seinen Akzent und die helle oder dunkle Seite vor; die Farbe änderst du unter Farben")}</p>
        )}
      </div>
      {pending && (
        <Row icon="warning" label={t("Ungespeicherte Farben verwerfen?")}>
          <div className="flex gap-1.5">
            <Button onClick={() => setPending(null)}>{t("Weiter bearbeiten")}</Button>
            <Button
              primary
              onClick={() => {
                discardEdits();
                pickTheme(pending);
                setPending(null);
              }}
            >
              {t("Verwerfen")}
            </Button>
          </div>
        </Row>
      )}
      {isBuiltIn(current.id) ? (
        current.author && <Row icon="style" label={themeName(current)} hint={t("Farben von {author}, {license}-Lizenz", { author: current.author, license: current.license ?? "" })} />
      ) : (
        <Row icon="style" label={themeName(current)} hint={t("Eigenes Theme")}>
          <Button
            onClick={() => {
              if (!confirmDelete) return setConfirmDelete(true);
              setConfirmDelete(false);
              discardEdits();
              deleteCustomTheme(current.id);
            }}
          >
            {confirmDelete ? t("Wirklich löschen") : t("Löschen")}
          </Button>
        </Row>
      )}
      <Row icon="font_download" label={t("Schrift")} hint={t("Für die ganze App. Terminal und Timer behalten ihre Schrift")}>
        <Select
          // Wide enough for "Automatic (Google Sans Flex)" in Russian, the longest.
          width="w-60"
          value={themes.font}
          options={(Object.keys(FONT_NAMES) as FontId[]).map((value) => ({
            value,
            label: value === "auto" ? t("Automatisch ({font})", { font: style === "material" ? "Google Sans Flex" : FONT_NAMES.auto }) : FONT_NAMES[value],
            font: fontStack(value, style),
          }))}
          onChange={(font) => updateSettings((cur) => ({ themes: { ...cur.themes, font } }))}
        />
      </Row>
      <Row icon="colors" label={t("Farbige Symbole")} hint={t("Werkzeugleiste, Einstellungen, Wetter und Werte der geschlossenen Notch in eigenen Farben")}>
        <Switch
          label={t("Farbige Symbole")}
          checked={themes.iconColors}
          onChange={(iconColors) => updateSettings((cur) => ({ themes: { ...cur.themes, iconColors } }))}
        />
      </Row>
      <Row icon="album" label={t("Tönung vom Albumcover")} hint={t("Das offene Panel nimmt leicht die Farbe des laufenden Songs an")}>
        <Switch
          label={t("Tönung vom Albumcover")}
          checked={themes.coverTint}
          onChange={(coverTint) => updateSettings((cur) => ({ themes: { ...cur.themes, coverTint } }))}
        />
      </Row>
      {!isMac && !demo && (
        <Row icon="blur_on"
          label={t("Glas")}
          hint={
            <>
              {fits ? t("Das offene Panel lässt den Bildschirm dahinter durchscheinen, wie Glas") : t("Nur mit der Kapsel oder wenn das offene Panel oben am Bildschirmrand hängt")}
              {/* The copy of the screen behind keeps Crest out of captures while it is made, which NVIDIA reads as protected content (#88). */}
              <span className="mt-1 block">{t("NVIDIA Instant Replay schaltet sich aus, sobald Crest sich aus Aufnahmen heraushält, und bleibt aus, bis du es in der NVIDIA-App wieder einschaltest")}</span>
            </>
          }
        >
          <Switch label={t("Glas")} checked={themes.glass} onChange={(glass) => updateSettings((cur) => ({ themes: { ...cur.themes, glass } }))} />
        </Row>
      )}
      {!isMac && !demo && themes.glass && <GlassLook />}
      {!isMac && !demo && themes.glass && support?.supported === true && <GlassLive />}
      {!isMac && !demo && themes.glass && support?.supported === true && <GlassAlerts />}
      {!isMac && !demo && themes.glass && support?.supported === true && <GlassFps />}
    </Group>
  );
}

/** Status alerts as clear glass (src/notch/Notch.tsx), over the live copy that runs for each one. */
function GlassAlerts() {
  const on = settings.use().themes.glassAlerts;
  const label = t("Statusmeldungen");
  return (
    <Row icon="blur_circular" label={label} hint={t("Lautstärke, Helligkeit und die anderen Meldungen als klares Glas. Solange eine zu sehen ist und ein paar Sekunden danach, fehlt die Notch in Screenshots und Aufnahmen.")}>
      <Switch label={`${t("Glas")}: ${label}`} checked={on} onChange={(glassAlerts) => updateSettings((cur) => ({ themes: { ...cur.themes, glassAlerts } }))} />
    </Row>
  );
}

/** The live glass's switch (src/notch/glass/live.ts), with the battery warning always under it, so it is read before switching on. */
function GlassLive() {
  const { glassLive: on, glassFps } = settings.use().themes;
  const label = t("Auch geschlossene Notch und Kapsel");
  return (
    <Row icon="blur_linear"
      label={label}
      hint={
        <>
          {t("Zeigt live, was hinter der geschlossenen Notch und der Kapsel liegt, bis zu {n}-mal pro Sekunde. Solange das an ist, fehlen Notch und Kapsel in Screenshots, Aufnahmen und Bildschirmfreigaben.", { n: glassFps })}
          <span className="mt-1 flex items-start gap-1 text-caution">
            <WarningCircle aria-hidden size={12} weight="fill" className="mt-px shrink-0" />
            {t("Braucht mehr Akku: Windows hat bei jeder Änderung auf dem Bildschirm mehr Arbeit")}
          </span>
        </>
      }
    >
      {/* Read out on its own, the label does not say what it adds to: the switch names the glass. */}
      <Switch label={`${t("Glas")}: ${label}`} checked={on} onChange={(glassLive) => updateSettings((cur) => ({ themes: { ...cur.themes, glassLive } }))} />
    </Row>
  );
}

/** The glass's look, under its switch; src/notch/glass shows each move on its next frame. */
function GlassLook() {
  const transparency = settings.use().themes.glassTransparency;
  const vars = activeTheme.use().vars;
  // The theme's veils as transparency in %: the mark's, and the slider's now.
  const alpha = (name: string) => parseColor(vars[name])?.a ?? 1;
  const percent = (veil: number) => Math.round((1 - veil) * 100);
  const safe = alpha("--glass-tint"), past = transparency > 0;
  return (
    <>
      <GlassSlider
        label={t("Transparenz")}
        icon="opacity"
        // A status, so crossing the mark is read out.
        hint={
          <span role="status" className={past ? "text-label" : undefined}>
            {past ? t("Über hellen oder gestreiften Hintergründen kann Text schlechter zu lesen sein") : t("Bis zur Markierung ({n} %) bleibt jeder Text über jedem Hintergrund lesbar", { n: percent(safe) })}
          </span>
        }
        field="glassTransparency"
        step={5}
        mark={0}
        text={`${percent(glassVeilAt(safe, transparency, alpha("--glass-tint-clear")))} %`}
      />
      <GlassSlider label={t("Lichtbrechung")} hint={t("Wie stark der Rand den Hintergrund biegt")} icon="ripples" field="glassRefraction" step={10} />
      <GlassSlider label={t("Mattierung")} hint={t("Wie stark der Hintergrund in der Mitte verschwimmt")} icon="lens_blur" field="glassFrost" step={10} />
      <GlassSlider label={t("Licht am Rand")} hint={t("Wie hell der Rand des Glases leuchtet")} icon="flare" field="glassRim" step={10} />
    </>
  );
}

/** The live copy's frames a second, one setting for the notch and every bar (src/notch/glass/live.ts), with the battery warning. */
export function GlassFps(props: { note?: string }) {
  const fps = settings.use().themes.glassFps;
  return (
    <GlassSlider
      label={t("Bilder pro Sekunde")}
      icon="speed"
      hint={
        <>
          {props.note}
          <span className={`${props.note ? "mt-1 " : ""}flex items-start gap-1 text-caution`}>
            <WarningCircle aria-hidden size={12} weight="fill" className="mt-px shrink-0" />
            {t("Ein höherer Wert braucht mehr Akku")}
          </span>
        </>
      }
      field="glassFps"
      step={5}
      text={String(fps)}
    />
  );
}

/**
 * A slider of the glass's look, with its value beside it; saved on every step, like the other sliders in the settings. A drag repeats
 * the same step over a few px, and each save would draw the whole panel again.
 */
export function GlassSlider(props: { label: string; hint: ReactNode; icon?: RowSymbol; field: keyof typeof GLASS_RANGE; step: number; mark?: number; text?: string }) {
  const value = settings.use().themes[props.field];
  const [min, max] = GLASS_RANGE[props.field];
  const text = props.text ?? `${value} %`;
  return (
    <Row icon={props.icon} label={props.label} hint={props.hint}>
      <div className="flex w-52 shrink-0 items-center gap-2">
        <Slider label={props.label} value={value} min={min} max={max} step={props.step} mark={props.mark} valueText={text} onChange={(v) => v !== value && updateSettings((cur) => ({ themes: { ...cur.themes, [props.field]: v } }))} />
        <span className="tabular w-10 shrink-0 text-end text-caption text-label-2">{text}</span>
      </div>
    </Row>
  );
}

/** A tiny panel in the theme's colours as the style draws them: accent dot, two text lines, warning and critical dots. */
function ThemePreview({ theme, style }: { theme: ThemeFile; style: Design }) {
  const black = settings.use().themes.materialBlack;
  const v = useMemo(() => (style === "material" ? resolveMaterial(theme, { black }) : resolveTheme(theme)).vars, [theme, style, black]);
  return (
    <span className="flex h-full w-full items-center gap-1.5 px-2 forced-color-adjust-none" style={{ background: v["--color-notch"] }}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: v["--theme-accent"] }} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="h-1 w-4/5 rounded-full" style={{ background: v["--color-label"] }} />
        <span className="h-1 w-1/2 rounded-full" style={{ background: v["--color-label-3"] }} />
      </span>
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: v["--color-orange"] }} />
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: v["--color-red"] }} />
    </span>
  );
}

function DayNight() {
  const { themes, weather } = settings.use();
  activeTheme.use(); // the "now" hint follows the change
  const s = themes.schedule;
  const set = (patch: Partial<typeof s>) => updateSettings((x) => ({ themes: { ...x.themes, schedule: { ...x.themes.schedule, ...patch } } }));
  // The System card too, so a day or night set to it has a name in its menu.
  const system = systemFile.use();
  const options = themeChoices(system, themes.custom).map((theme) => ({ value: theme.id, label: themeName(theme) }));
  // formatTime follows the 12 or 24 hour setting.
  const clock = (minutes: number) => formatTime(new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60));
  const times = HALF_HOURS.map((v) => ({ value: v, label: clock(Number(v.slice(0, 2)) * 60 + Number(v.slice(3))) }));
  const now = new Date();
  // Following the sun, today's sunrise and sunset stand where the two set times are. Without them (no place set, or a
  // day the sun does not rise or set) the set times still apply, so their menus stay.
  const sun = s.sun ? sunHours(now, weather) : null;
  const start = (minutes: number | undefined, value: string, onChange: (v: string) => void) =>
    minutes === undefined ? <Select width="w-24" value={value} options={times} onChange={onChange} /> : <span className="tabular flex w-24 items-center justify-center text-body text-label-2">{clock(minutes)}</span>;

  const turnOn = (on: boolean) => {
    if (!on) return set({ on });
    // Start from the theme in use: it keeps its place by day if it is light, by night if it is dark.
    const currentDark = resolveTheme(findTheme(themes.id, themes.custom, system)).dark;
    set(currentDark ? { on, night: themes.id } : { on, day: themes.id });
  };

  return (
    <Group title={t("Tag und Nacht")} id="settings-daynight">
      <Row icon="routine"
        label={t("Nach Uhrzeit wechseln")}
        hint={s.on ? (isNight(s, now, weather) ? t("Jetzt gilt das Nacht-Theme") : t("Jetzt gilt das Tag-Theme")) : t("Ein Theme für den Tag, eins für die Nacht")}
      >
        <Switch checked={s.on} onChange={turnOn} label={t("Nach Uhrzeit wechseln")} />
      </Row>
      {s.on && (
        <>
          {/* The place whose sun it is, or where to set one (issue #41). */}
          <Row icon="wb_twilight" label={t("Bei Sonnenaufgang und Sonnenuntergang")} hint={s.sun ? (weather ? weather.name : t("Lege zuerst deinen Ort unter Wetter fest")) : undefined}>
            <Switch checked={s.sun} onChange={(sun) => set({ sun })} label={t("Bei Sonnenaufgang und Sonnenuntergang")} />
          </Row>
          <Row icon="light_mode" label={t("Tag ab")}>
            <div className="flex gap-1.5">
              {start(sun?.[0], s.dayStart, (dayStart) => set({ dayStart }))}
              <Select width="w-32" value={s.day} options={options} onChange={(day) => set({ day })} />
            </div>
          </Row>
          <Row icon="dark_mode" label={t("Nacht ab")}>
            <div className="flex gap-1.5">
              {start(sun?.[1], s.nightStart, (nightStart) => set({ nightStart }))}
              <Select width="w-32" value={s.night} options={options} onChange={(night) => set({ night })} />
            </div>
          </Row>
        </>
      )}
    </Group>
  );
}

const ratio = (r: number) => `${(Math.floor(r * 10) / 10).toFixed(1)}:1`;

function ThemeEditor() {
  const h = draft.use();
  const theme = activeTheme.use();
  const [open, setOpen] = useState<ThemeKey | null>(null);
  const name = draftName.use();
  const material = design.use() === "material";

  if (!h)
    return (
      <Group title={t("Farben")} id="settings-colors">
        <Row icon="brush" label={t("Farben anpassen")} hint={t("Beginnt beim aktuellen Theme, jede Änderung ist sofort zu sehen")}>
          <Button
            onClick={() => {
              startEditing(t("{name} (eigenes)", { name: themeName(savedTheme()) }));
              setOpen(null);
            }}
          >
            {t("Bearbeiten")}
          </Button>
        </Row>
      </Group>
    );

  const file = h.present;
  const changed = h.past.length > 0;
  const custom = !isBuiltIn(original(h).id);
  const bg = theme.colors.background;
  const swatches = [...new Set(EDITOR_KEYS.map((k) => theme.vars[varFor[k]]).concat(["#000000", "#ffffff"]))].filter((c) => parseColor(c)?.a === 1);

  return (
    <Group title={t("Farben")} id="settings-colors">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2.5 text-footnote">
        <span className="font-semibold text-label">{t("Titel")}</span>
        <span className="text-label-2">{t("Text")}</span>
        <span className="text-label-3">{t("Hinweis")}</span>
        <span className="ms-auto text-link">{t("Akzent")}</span>
        <span className="text-orange">{t("Warnung")}</span>
        <span className="text-red">{t("Kritisch")}</span>
      </div>
      {editorKeys(material ? "material" : "crest").map((key) => {
        const shown = theme.colors[key];
        const written = parseColor(file.colors[key]) ?? shown;
        return (
          <Fragment key={key}>
            <button
              onClick={() => setOpen(open === key ? null : key)}
              aria-expanded={open === key}
              className="pressable pressable-fill flex min-h-9 w-full items-center gap-2.5 px-3 py-1.5 text-start"
            >
              <span className="size-4 shrink-0 rounded-full ring-1 ring-separator forced-color-adjust-none" style={{ background: theme.vars[varFor[key]] }} />
              <span className="flex-1 text-body text-label">{material && key === "accent" ? t("Startfarbe") : t(KEY_LABELS[key])}</span>
              {key !== "background" && <span className="tabular text-caption text-label-3">{ratio(contrast(shown, bg))}</span>}
              <span className="tabular w-16 text-end text-caption text-label-2">{hexOf(written)}</span>
            </button>
            {/* Lined up with the label: 12 px of padding, the 16 px swatch and its 10 px gap. */}
            {material && key === "background" && <div className="pe-3 pb-1.5 ps-[38px] text-caption text-label-2">{t("In Material zählt nur, ob er hell oder dunkel ist")}</div>}
            {open === key && <ColorPicker value={withAlpha(written, 1)} onChange={(c) => editColor(key, c)} swatches={swatches} />}
          </Fragment>
        );
      })}
      <Row icon="format_color_fill" label={t("Geschlossene Notch einfärben")} hint={t("Sonst bleibt sie schwarz wie der Bildschirmrand")}>
        <Switch checked={file.closedNotch === "background"} onChange={editClosedNotch} label={t("Geschlossene Notch einfärben")} />
      </Row>
      {theme.adjustments.length > 0 && (
        <div className="flex flex-col gap-0.5 px-3 py-2 text-caption text-label-3">
          <span className="text-label-2">{t("Für die Lesbarkeit angepasst")}</span>
          {theme.adjustments.map((a) => (
            <span key={a.key}>
              {a.met
                ? t("{name}: {from} wird {to} (hatte {ratio}, braucht {min})", { name: t(KEY_LABELS[a.key]), from: a.from, to: a.to, ratio: ratio(a.ratio), min: ratio(a.minimum) })
                : t("{name}: {from} erreicht {min} nicht, bestmöglich {to}", { name: t(KEY_LABELS[a.key]), from: a.from, to: a.to, min: ratio(a.minimum) })}
            </span>
          ))}
        </div>
      )}
      <Row icon="difference" label={t("Änderungen")} hint={changed ? t("Nicht gespeichert") : t("Noch keine")}>
        <div className="flex gap-1.5">
          <Button disabled={!changed} onClick={undoEdit} icon={ArrowCounterClockwise}>
            {t("Rückgängig")}
          </Button>
          <Button onClick={discardEdits}>{changed ? t("Verwerfen") : t("Schließen")}</Button>
        </div>
      </Row>
      <Row label={<TextField value={name} onChange={(v) => draftName.set(v)} placeholder={t("Name")} width="w-36" />}>
        <div className="flex gap-1.5">
          {custom && (
            <Button disabled={!changed} onClick={overwriteTheme}>
              {t("Überschreiben")}
            </Button>
          )}
          <Button primary disabled={!name.trim()} onClick={() => saveAsNew(name)}>
            {t("Als neu sichern")}
          </Button>
        </div>
      </Row>
    </Group>
  );
}

const varFor: Record<(typeof EDITOR_KEYS)[number], string> = {
  background: "--color-notch",
  foreground: "--color-label",
  accent: "--theme-accent",
  warning: "--color-orange",
  critical: "--color-red",
};

const hexOf = (c: Rgba) => toHex(c).toUpperCase();

function ThemeFiles() {
  const [message, setMessage] = useState<ReactNode>(null);
  const [busy, setBusy] = useState(false);
  const run = (job: () => Promise<ReactNode>) => {
    setBusy(true);
    job()
      .then(setMessage, (e) => setMessage(t(String(e))))
      .finally(() => setBusy(false));
  };

  return (
    <Group title={t("Theme-Dateien")} id="settings-theme-files">
      <Row icon="file_export" label={t("Aktuelles Theme exportieren")} hint={t("Als JSON-Datei in den Theme-Ordner")}>
        <Button
          disabled={busy}
          onClick={() =>
            run(async () => {
              const path = await exportTheme();
              if (!path) return t("Heruntergeladen");
              return (
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{t("Gespeichert: {path}", { path })}</span>
                  <Button onClick={() => revealFile(path)}>{t("Zeigen")}</Button>
                </span>
              );
            })
          }
        >
          {t("Exportieren")}
        </Button>
      </Row>
      <Row icon="file_open" label={t("Aus dem Theme-Ordner importieren")} hint={t("Liest jede .json-Datei im Ordner")}>
        <div className="flex gap-1.5">
          <Button disabled={busy} onClick={() => void themesFolder().then((dir) => (dir ? openFile(dir) : undefined))}>
            {t("Ordner öffnen")}
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await importFromFolder();
                const names = r.added.map((x) => x.name).join(", ");
                return (
                  <span className="flex flex-col gap-0.5">
                    <span>
                      {r.added.length + r.unchanged + r.failed.length === 0
                        ? t("Keine .json-Dateien im Ordner")
                        : names
                          ? t("{n} importiert ({names}), {u} schon vorhanden", { n: r.added.length, u: r.unchanged, names })
                          : t("{n} importiert, {u} schon vorhanden", { n: r.added.length, u: r.unchanged })}
                    </span>
                    {r.failed.map((f) => (
                      <span key={f.file} className="text-orange">
                        {f.file}: {f.problems.map((p) => t(p.key, p.vars)).join("; ")}
                      </span>
                    ))}
                  </span>
                );
              })
            }
          >
            {t("Importieren")}
          </Button>
        </div>
      </Row>
      {message && <div className="px-3 py-2 text-caption text-label-2">{message}</div>}
    </Group>
  );
}
