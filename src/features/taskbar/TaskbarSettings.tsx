import { useEffect, useRef, useState } from "react";
import { Reorder } from "motion/react";
import { AppWindow, CaretUp, DotsSixVertical, WarningCircle, WifiHigh } from "../../ui/iconset";
import { CaretDown } from "../../ui/iconset";
import { design } from "../../design/design";
import { springs } from "../../design/motion";
import { t } from "../../i18n";
import { liveSupport } from "../../notch/glass/live";
import { nav } from "../../notch/nav";
import type { PartId } from "../../notch/row/parts";
import { partInfo } from "../../notch/row/partInfo";
import { isMac, isNative } from "../../platform/native";
import { build, taskbar } from "../../platform/services";
import { settings } from "../../settings/store";
import { CrestMark } from "../../ui/CrestMark";
import { WindowsMark } from "../../ui/WindowsMark";
import { Button, Group, Row, Segmented, Select, Slider, Switch } from "../../ui/controls";
import type { RowSymbol } from "../../ui/materialNames";
import { FavoriteList } from "../launcher/FavoriteList";
import { MoveButton } from "../launcher/FavoriteList";
import { normalizeFavorites } from "../launcher/apps";
import { activeTheme, darkInk } from "../themes/store";
import { GlassSlider } from "../themes/ThemeSettings";
import { barLook, barVeil, themeVeils } from "./look";
import { fitIcon, HEIGHT, ICON, moveItem, stepFocus, stepItem, taskbarShown, TOOL_BUTTONS, TRANSPARENCY, type BarItem, type BarShape, type ToolItem, type Zone } from "./model";
import { demoBarOffered, setTaskbar } from "./store";
import { AddTool, AddWidget, WidgetOptions } from "./WidgetRows";
import { toolInfo } from "./toolInfo";
import { addWidget, isTool, isWidget, removeWidget, shownZones, toolOf } from "./widgets";

/*
 * Settings → Taskbar: the pages of Crest's bar, behind the settings window's Notch | Taskbar switch (SettingsView lists them). They
 * only save: the notch applies the bar's settings to Rust (store.ts) and the bar redraws on them.
 */

/** Whether the Taskbar settings show here (model.ts taskbarShown); as in a build without the bar until the build has answered. */
export function useTaskbarShown(): boolean {
  const enabled = settings.use().taskbar.enabled;
  const demo = demoBarOffered.use();
  const [offered, setOffered] = useState(false);
  useEffect(() => void build.info().then((b) => setOffered(b.taskbar)), []);
  return taskbarShown({ native: isNative, mac: isMac, dev: import.meta.env.DEV, offered, enabled, demo });
}

/** The bar's zones, physical: left stays left in a right-to-left language. */
const ZONES: Zone[] = ["left", "center", "right"];
const ZONE_LABEL: Record<Zone, string> = { left: "Linke Seite", center: "Mitte", right: "Rechte Seite" };
/** What the bar draws for each fixed item: Windows' Start button, the apps' buttons, the button of the Crest menu, the notification area and Stato. A widget has its part's name. */
const ITEM_LABEL: Record<Exclude<BarItem, PartId | ToolItem>, string> = { start: "Startmenü", apps: "Apps und Fenster", crest: "Crest-Menü", tray: "Infobereich", status: "Status" };
const SHAPE_LABEL: Record<BarShape, string> = { docked: "Angedockt", floating: "Schwebend", capsule: "Kapsel", tiles: "Kacheln" };

/** Taskbar → General: the bar on or off, whether it slides away when a window touches it, and where the system icons it leaves out are. */
export function TaskbarGeneral() {
  const { enabled, autoHide, shape } = settings.use().taskbar;
  // Bars that stay up with auto-hide on (Rust front.rs `stays_up`), read as the page opens and when the switch changes.
  const [blocked, setBlocked] = useState(0);
  useEffect(() => void taskbar.slideBlocked().then(setBlocked, () => {}), [autoHide]);
  // Whether a docked bar can reserve its strip (Rust reserve.rs), read as the page opens and when shape or auto-hide change.
  const [reachable, setReachable] = useState(true);
  useEffect(() => void taskbar.reserveReachable().then(setReachable, () => {}), [autoHide, shape]);
  return (
    <Group id="settings-taskbar">
      <Row
        icon="dock_to_bottom"
        label={t("Crest-Taskleiste")}
        hint={t("Blendet die Windows-Taskleiste aus und zeigt die von Crest auf jedem Bildschirm. Ausgeschaltet oder wenn Crest endet, kommt die von Windows zurück")}
      >
        <Switch label={t("Crest-Taskleiste")} checked={enabled} onChange={(on) => setTaskbar({ enabled: on })} />
      </Row>
      <Row
        icon="visibility_off"
        label={t("Automatisch ausblenden")}
        hint={
          <>
            {t("Die Leiste gleitet weg, wenn ein Fenster sie berührt, zum Beispiel ein maximiertes, und kommt zurück, wenn der Zeiger den unteren Rand berührt")}
            {autoHide && blocked > 0 && (
              <span className="mt-1 flex items-start gap-1 text-caution">
                <WarningCircle aria-hidden size={12} weight="fill" className="mt-px shrink-0" />
                {t("Auf einem Bildschirm kann die Leiste nicht weggleiten: Dort endet der Arbeitsbereich über dem Rand, oder darunter liegt ein anderer Bildschirm")}
              </span>
            )}
            {enabled && shape === "docked" && !autoHide && !reachable && (
              <span className="mt-1 flex items-start gap-1 text-caution">
                <WarningCircle aria-hidden size={12} weight="fill" className="mt-px shrink-0" />
                {t("Ein anderes Programm steht an der Stelle der Windows-Taskleiste: Die angedockte Leiste reserviert keinen Platz, maximierte Fenster reichen unter sie")}
              </span>
            )}
          </>
        }
      >
        <Switch label={t("Automatisch ausblenden")} checked={autoHide} onChange={(on) => setTaskbar({ autoHide: on })} />
      </Row>
      {/* A sentence, not a setting's name: it wraps instead of being cut. Width 0 under Material keeps it beside its icon, as the hints. */}
      <Row icon="keyboard" label={<span className="whitespace-normal roomy:block roomy:w-0 roomy:min-w-full">{t("Lautstärke, Netzwerk, Akku und Mitteilungen erreichst du mit Win+A und Win+N")}</span>} />
    </Group>
  );
}

/** Taskbar → Items: what each zone of the bar holds, in order. A row's menu moves the item to the end of another zone, a widget before the Crest button. */
export function TaskbarItems() {
  const { zones: saved, shape } = settings.use().taskbar;
  // No row for a tool button the bar does not offer: another window gets the raw JSON from a storage event, without normalizeZones (storeCore.ts:51-57).
  const zones = shownZones(saved, TOOL_BUTTONS.map((id) => ({ id, enabled: true })));
  const [dragging, setDragging] = useState<BarItem | null>(null);
  const options = ZONES.map((z) => ({ value: z, label: t(ZONE_LABEL[z]) }));
  // React moves a row stepped down in the DOM, which drops its arrow's focus: given back to that row's arrow once the step is saved.
  const stepped = useRef<{ id: BarItem; by: -1 | 1 } | null>(null);
  const step = (id: BarItem, shown: BarItem[], by: -1 | 1) => {
    const cur = settings.get().taskbar.zones, next = stepItem(cur, shown, id, by);
    if (next === cur) return;
    stepped.current = { id, by };
    setTaskbar({ zones: next });
  };
  useEffect(() => {
    const s = stepped.current, zone = s && ZONES.find((z) => zones[z].includes(s.id));
    if (!s || !zone) return;
    stepped.current = null;
    const to = stepFocus(s.by, zones[zone].indexOf(s.id), zones[zone].length);
    document.querySelectorAll<HTMLElement>(`[data-steps="${s.id}"] button`)[to < 0 ? 0 : 1]?.focus();
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Group id="settings-taskbar-items">
      {ZONES.map((zone) => (
        <div key={zone}>
          <Row icon="widgets" label={t(ZONE_LABEL[zone])} hint={zones[zone].length > 1 ? t("Zum Sortieren ziehen") : undefined}>
            <div className="flex flex-wrap justify-end gap-2">
              <AddWidget zone={zone} />
              <AddTool zone={zone} />
            </div>
          </Row>
          <Reorder.Group
            as="div"
            axis="y"
            values={zones[zone]}
            onReorder={(order: BarItem[]) => setTaskbar((cur) => ({ zones: { ...cur.zones, [zone]: order } }))}
            className="divide-y divide-separator"
          >
            {zones[zone].map((id, i) => (
              <Reorder.Item
                key={id}
                value={id}
                as="div"
                transition={springs.snappy}
                onDragStart={() => setDragging(id)}
                onDragEnd={() => setDragging(null)}
                whileDrag={{ scale: 1.02 }}
                className={`group relative flex min-h-9 cursor-grab items-center gap-2.5 px-3 py-1 active:cursor-grabbing ${
                  dragging === id ? "z-10 rounded-[10px] bg-elevated shadow-[0_6px_18px_rgb(0_0_0/0.45)] material:shadow-level4 m3-dragged" : ""
                }`}
              >
                <DotsSixVertical size={13} weight="bold" className="-ms-1 shrink-0 text-label-4 transition-colors group-hover:text-label-3" />
                <ItemIcon id={id} />
                {/* From its own width, so a narrow page shrinks it along with a widget's options instead of first. */}
                <div className="min-w-0 flex-auto select-none">
                  <div className="truncate text-body text-label">{t(isWidget(id) ? partInfo[id].label : isTool(id) ? toolInfo[toolOf(id)].label : ITEM_LABEL[id])}</div>
                  {id === "start" && <div className="text-caption text-label-3">{t("Start öffnet sich dort, wo Windows es hinsetzt, je nach Ausrichtung seiner Taskleiste")}</div>}
                </div>
                {(isWidget(id) || isTool(id) || id === "tray" || id === "status") && <WidgetOptions id={id} />}
                <div data-steps={id} onPointerDown={(e) => e.stopPropagation()} className="flex items-center">
                  <MoveButton label={t("Nach oben")} disabled={i === 0} onClick={() => step(id, zones[zone], -1)}>
                    <CaretUp size={12} weight="bold" />
                  </MoveButton>
                  <MoveButton label={t("Nach unten")} disabled={i === zones[zone].length - 1} onClick={() => step(id, zones[zone], 1)}>
                    <CaretDown size={12} weight="bold" />
                  </MoveButton>
                </div>
                <div onPointerDown={(e) => e.stopPropagation()}>
                  {/* The menu also reports its current zone when picked again, which would send the item to that zone's end. A widget goes in as "+" puts it, before the Crest button. */}
                  <Select
                    width="w-36"
                    value={zone}
                    options={options}
                    onChange={(to) => to !== zone && setTaskbar((cur) => ({ zones: isWidget(id) || isTool(id) || id === "tray" || id === "status" ? addWidget(removeWidget(cur.zones, id), id, to) : moveItem(cur.zones, id, to) }))}
                  />
                </div>
              </Reorder.Item>
            ))}
          </Reorder.Group>
        </div>
      ))}
      {shape === "capsule" && (
        <Row icon="info" label={<span className="whitespace-normal roomy:block roomy:w-0 roomy:min-w-full">{t("Als Kapsel reiht die Taskleiste die drei Bereiche in der Mitte aneinander: links, Mitte, rechts. Die Bereiche hier bleiben, wie sie sind")}</span>} />
      )}
    </Group>
  );
}

/** An item's icon: Crest's mark, Windows' mark, the apps' window, the tray's ^, Stato's Wi-Fi, a widget's part as the settings show it or a tool's icon. A new fixed item does not compile without one. */
function ItemIcon({ id }: { id: BarItem }) {
  if (isWidget(id)) {
    const I = partInfo[id].icon;
    return <I size={15} weight="bold" className="shrink-0 text-label-2" />;
  }
  if (isTool(id)) {
    const I = toolInfo[toolOf(id)].icon;
    return <I size={15} weight="bold" className="shrink-0 text-label-2" />;
  }
  if (id === "start") return <WindowsMark size={15} className="shrink-0 text-label-2" />;
  if (id === "apps") return <AppWindow size={15} weight="bold" className="shrink-0 text-label-2" />;
  if (id === "crest") return <CrestMark size={15} className="shrink-0 text-label-2" />;
  if (id === "tray") return <CaretUp size={15} weight="bold" className="shrink-0 text-label-2" />;
  if (id === "status") return <WifiHigh size={15} weight="bold" className="shrink-0 text-label-2" />;
  return id satisfies never;
}

/**
 * Taskbar → Apps and windows: the pinned apps in the bar's order, and whether the app menu has End task. An app is pinned on the bar,
 * from its right-click menu; Windows' pinned apps replace the list from here (one that is not empty only on a second click within
 * 3 s), and an empty answer leaves it.
 */
export function TaskbarApps() {
  const { pinned: saved, endTask } = settings.use().taskbar;
  const pinned = saved ?? [];
  const [confirm, setConfirm] = useState(false);
  const [outcome, setOutcome] = useState<"none" | "failed" | null>(null);
  const [reading, setReading] = useState(false);

  useEffect(() => {
    if (!confirm) return;
    const id = window.setTimeout(() => setConfirm(false), 3000);
    return () => window.clearTimeout(id);
  }, [confirm]);

  const importPins = () => {
    setOutcome(null);
    if (pinned.length && !confirm) return setConfirm(true);
    setConfirm(false);
    setReading(true);
    void taskbar.importPins().then(
      (apps) => {
        const next = normalizeFavorites(apps);
        // Windows' pins as remembered too, so its next change is followed from these and not taken for the first read.
        if (next?.length) setTaskbar({ pinned: next, windowsPins: next.map((f) => f.id) });
        else setOutcome("none");
      },
      () => setOutcome("failed"),
    ).finally(() => setReading(false));
  };

  return (
    <Group id="settings-taskbar-apps">
      <Row icon="keep" label={t("Angeheftete Apps")} hint={pinned.length ? t("Zum Sortieren ziehen") : t("Über Start, mit Rechtsklick auf eine App in der Taskleiste oder durch Ziehen auf die Taskleiste anheften")} />
      {pinned.length > 0 && <FavoriteList favorites={pinned} onChange={(next) => setTaskbar({ pinned: next })} />}
      {/* Long in some languages beside the button: the name wraps instead of being cut. */}
      <Row
        icon="file_open"
        label={<span className="whitespace-normal">{t("Apps der Windows-Taskleiste")}</span>}
        // A status, so the import's outcome is read out after the click.
        hint={
          <span role="status">
            {outcome === "none"
              ? t("Auf der Windows-Taskleiste ist keine App angeheftet")
              : outcome === "failed"
                ? t("Die Apps von Windows lassen sich gerade nicht lesen")
                : t("Ersetzt die angehefteten Apps durch die der Windows-Taskleiste")}
          </span>
        }
      >
        {/* One read at a time: a second click would start another import. */}
        <Button onClick={importPins} disabled={reading}>
          {/* Both texts in one cell: the button keeps the wider one's width, so the confirming click lands where the first did. */}
          <span className="grid text-center">
            <span className={`col-start-1 row-start-1 ${confirm ? "invisible" : ""}`} aria-hidden={confirm}>
              {t("Von Windows übernehmen")}
            </span>
            <span className={`col-start-1 row-start-1 ${confirm ? "" : "invisible"}`} aria-hidden={!confirm}>
              {t("Wirklich ersetzen?")}
            </span>
          </span>
        </Button>
      </Row>
      <Row icon="stop_circle" label={t("Task beenden im App-Menü")} hint={t("Beendet die App sofort, ohne zu speichern")}>
        <Switch label={t("Task beenden im App-Menü")} checked={endTask} onChange={(on) => setTaskbar({ endTask: on })} />
      </Row>
    </Group>
  );
}

/**
 * Taskbar → Appearance: the bar's shape, height, its icons' size, its background, its transparency and its glass. Colours, theme and
 * the glass's sliders are the ones of Notch → Themes.
 */
export function TaskbarLook() {
  const { shape, height, iconSize, surface, transparency, glass, glassLook, autoHide } = settings.use().taskbar;
  const theme = activeTheme.use();
  const appDesign = design.use();
  // The glass's switch only where the live glass can run (src/notch/glass/live.ts), as in Notch → Themes.
  const support = liveSupport.use(), live = !isMac && support?.supported === true;
  const plus = barLook({ glass, glassLook }, live) === "plus";
  // A name in Latin letters, isolated left to right, so in Arabic its plus stays after it.
  const name = "\u2066" + t("Liquid Glass +") + "\u2069";
  const looks = [
    { value: "off", label: t("Aus") },
    { value: "crest", label: t("Glas") },
    { value: "plus", label: name },
  ] as const;
  const picked = glass ? glassLook : "off";
  // How much of the screen behind shows, as the notch's Transparency says it: the surface's veil (look.ts barVeil) on the Notch
  // surface's Dark tokens, unless the theme colours the closed notch too, and always under Liquid Glass + (useBarSurface).
  const veils = themeVeils((surface === "notch" && !theme.closedNotch) || plus ? darkInk() : theme.vars);
  const seen = Math.round((1 - barVeil({ transparency, glass: glass && live, reduced: false, ...veils })) * 100);
  return (
    <Group id="settings-taskbar-look">
      <Row icon="style" label={t("Stil")} hint={t("Gilt für die ganze App; ändern unter Themen")}>
        <Button onClick={() => nav.set({ tabId: "settings", section: "design" })}>{appDesign === "material" ? "Material" : "Crest"}</Button>
      </Row>
      <Row icon="rounded_corner" label={t("Form")}>
        <Segmented
          id="taskbar-shape"
          size="sm"
          value={shape}
          onChange={(shape) => setTaskbar({ shape })}
          options={(Object.keys(SHAPE_LABEL) as BarShape[]).map((s) => ({ value: s, label: t(SHAPE_LABEL[s]) }))}
        />
      </Row>
      {/* A reserving bar's height moves its strip and resizes maximized windows: written once, on release. */}
      <PxRow icon="height" label={t("Höhe")} value={height} min={HEIGHT[0]} max={HEIGHT[1]} live={!(shape === "docked" && !autoHide)} onChange={(height) => setTaskbar({ height })} />
      {/* The size the bar draws: a lower bar keeps the saved one and a taller bar gives it back (fitIcon). */}
      <PxRow icon="aspect_ratio" label={t("Symbolgröße")} value={fitIcon(height, iconSize)} min={ICON[0]} max={fitIcon(height, ICON[1])} onChange={(iconSize) => setTaskbar({ iconSize })} />
      <Row icon="format_color_fill" label={t("Hintergrund")} hint={t("Notch: wie die geschlossene Notch. Theme: die Hintergrundfarbe des Themes")}>
        <Segmented
          id="taskbar-surface"
          size="sm"
          value={surface}
          onChange={(surface) => setTaskbar({ surface })}
          options={[
            { value: "notch", label: t("Notch") },
            { value: "theme", label: t("Theme") },
          ]}
        />
      </Row>
      <Row icon="opacity" label={t("Transparenz")}>
        <div className="flex w-52 items-center gap-2">
          <Slider label={t("Transparenz")} value={transparency} min={TRANSPARENCY[0]} max={TRANSPARENCY[1]} step={5} valueText={`${seen} %`} onChange={(transparency) => setTaskbar({ transparency })} />
          <span className="tabular w-14 shrink-0 text-end text-caption text-label-2">{seen} %</span>
        </div>
      </Row>
      {live && (
        <Row
          label={t("Glas")}
          hint={
            <>
              {t("Zeigt live, was hinter der Taskleiste liegt, bis zu 10-mal pro Sekunde. Solange das an ist, fehlt die Taskleiste in Screenshots, Aufnahmen und Bildschirmfreigaben.")}
              {plus && <span className="mt-1 block">{t("Mit {name} ist der Inhalt der Taskleiste immer weiß, und der Hintergrund gilt nicht", { name })}</span>}
              <span className="mt-1 flex items-start gap-1 text-caution">
                <WarningCircle aria-hidden size={12} weight="fill" className="mt-px shrink-0" />
                {t("Braucht mehr Akku: Windows hat bei jeder Änderung auf dem Bildschirm mehr Arbeit")}
              </span>
            </>
          }
        >
          <Segmented
            id="taskbar-glass"
            size="sm"
            label={t("Glas")}
            value={picked}
            onChange={(v) => setTaskbar(v === "off" ? { glass: false } : { glass: true, glassLook: v })}
            options={[...looks]}
          />
        </Row>
      )}
      {/* The notch's glass sliders (Notch → Themes shows them only with the notch's glass on); both of the bar's looks read them. */}
      {live && glass && (
        <>
          <Row label={<span className="whitespace-normal">{t("Lichtbrechung, Mattierung und Licht am Rand gelten auch für die Notch")}</span>} />
          <GlassSlider label={t("Lichtbrechung")} hint={t("Wie stark der Rand den Hintergrund biegt")} icon="ripples" field="glassRefraction" step={10} />
          <GlassSlider label={t("Mattierung")} hint={t("Wie stark der Hintergrund in der Mitte verschwimmt")} icon="lens_blur" field="glassFrost" step={10} />
          <GlassSlider label={t("Licht am Rand")} hint={t("Wie hell der Rand des Glases leuchtet")} icon="flare" field="glassRim" step={10} />
        </>
      )}
      <Row icon="palette" label={<span className="whitespace-normal">{t("Farben und Thema gelten auch für die Taskleiste")}</span>}>
        <Button onClick={() => nav.set({ tabId: "settings", section: "themes" })}>{t("Themen")}</Button>
      </Row>
    </Group>
  );
}

/**
 * A slider with its value in CSS px, in even steps: the icon then sits in the bar's middle on whole pixels. Not `live`, it shows the
 * dragged value and calls `onChange` once, on release.
 */
function PxRow({ label, icon, value, min, max, onChange, live = true }: { label: string; icon: RowSymbol; value: number; min: number; max: number; onChange: (v: number) => void; live?: boolean }) {
  const dragged = useRef<number | undefined>(undefined);
  const [shown, setShown] = useState<number>();
  const hold = (v: number) => {
    dragged.current = v;
    setShown(v);
  };
  const release = () => {
    if (dragged.current !== undefined) onChange(dragged.current);
    dragged.current = undefined;
    setShown(undefined);
  };
  const v = shown ?? value;
  return (
    <Row icon={icon} label={label}>
      <div className="flex w-52 items-center gap-2">
        <Slider label={label} value={v} min={min} max={max} step={2} onChange={live ? onChange : hold} onRelease={live ? undefined : release} />
        <span className="tabular w-14 shrink-0 text-end text-caption text-label-2">{v} px</span>
      </div>
    </Row>
  );
}
