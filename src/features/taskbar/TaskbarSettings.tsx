import { useEffect, useState } from "react";
import { Reorder } from "motion/react";
import { AppWindow, DotsSixVertical, SquaresFour, WarningCircle } from "@phosphor-icons/react";
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
import { Button, Group, Row, Segmented, Select, Slider, Switch } from "../../ui/controls";
import { FavoriteList } from "../launcher/FavoriteList";
import { normalizeFavorites } from "../launcher/apps";
import { activeTheme, darkInk } from "../themes/store";
import { GlassSlider } from "../themes/ThemeSettings";
import { barVeil, themeVeils } from "./look";
import { fitIcon, HEIGHT, ICON, moveItem, taskbarShown, TRANSPARENCY, type BarItem, type BarShape, type Zone } from "./model";
import { setTaskbar } from "./store";
import { AddWidget, WidgetOptions } from "./WidgetRows";
import { addWidget, isWidget, removeWidget } from "./widgets";

/*
 * Settings → Taskbar: the pages of Crest's bar, behind the settings window's Notch | Taskbar switch (SettingsView lists them). They
 * only save: the notch applies the bar's settings to Rust (store.ts) and the bar redraws on them.
 */

/** Whether the Taskbar settings show here (model.ts taskbarShown); as without the preview file until the build has answered. */
export function useTaskbarShown(): boolean {
  const enabled = settings.use().taskbar.enabled;
  const [preview, setPreview] = useState(false);
  useEffect(() => void build.info().then((b) => setPreview(b.taskbarPreview)), []);
  return taskbarShown({ native: isNative, mac: isMac, dev: import.meta.env.DEV, preview, enabled });
}

/** The bar's zones, physical: left stays left in a right-to-left language. */
const ZONES: Zone[] = ["left", "center", "right"];
const ZONE_LABEL: Record<Zone, string> = { left: "Linke Seite", center: "Mitte", right: "Rechte Seite" };
/** What the bar draws for each fixed item: the app menu's button, the apps' buttons, and the button of the Crest menu. A widget has its part's name. */
const ITEM_LABEL: Record<Exclude<BarItem, PartId>, string> = { start: "App-Menü", apps: "Apps und Fenster", crest: "Crest-Menü" };
const SHAPE_LABEL: Record<BarShape, string> = { docked: "Angedockt", floating: "Schwebend", capsule: "Kapsel", tiles: "Kacheln" };

/** Taskbar → General: the bar on or off, whether it slides away when a window touches it, and where the system icons it leaves out are. */
export function TaskbarGeneral() {
  const { enabled, autoHide } = settings.use().taskbar;
  return (
    <Group id="settings-taskbar">
      <Row
        label={t("Crest-Taskleiste")}
        hint={t("Blendet die Windows-Taskleiste aus und zeigt die von Crest auf jedem Bildschirm. Ausgeschaltet oder wenn Crest endet, kommt die von Windows zurück")}
      >
        <Switch label={t("Crest-Taskleiste")} checked={enabled} onChange={(on) => setTaskbar({ enabled: on })} />
      </Row>
      <Row
        label={t("Ausblenden, wenn ein Fenster sie berührt")}
        hint={t("Die Leiste gleitet aus dem Bildschirm, solange das Fenster vorne sie berührt, und kommt zurück, wenn der Zeiger den unteren Rand berührt")}
      >
        <Switch label={t("Ausblenden, wenn ein Fenster sie berührt")} checked={autoHide} onChange={(on) => setTaskbar({ autoHide: on })} />
      </Row>
      {/* A sentence, not a setting's name: it wraps instead of being cut. */}
      <Row label={<span className="whitespace-normal">{t("Lautstärke, Netzwerk, Akku und Mitteilungen erreichst du mit Win+A und Win+N")}</span>} />
    </Group>
  );
}

/** Taskbar → Items: what each zone of the bar holds, in order. A row's menu moves the item to the end of another zone, a widget before the Crest button. */
export function TaskbarItems() {
  const { zones, shape } = settings.use().taskbar;
  const [dragging, setDragging] = useState<BarItem | null>(null);
  const options = ZONES.map((z) => ({ value: z, label: t(ZONE_LABEL[z]) }));
  return (
    <Group id="settings-taskbar-items">
      {ZONES.map((zone) => (
        <div key={zone}>
          <Row label={t(ZONE_LABEL[zone])} hint={zones[zone].length > 1 ? t("Zum Sortieren ziehen") : undefined}>
            <AddWidget zone={zone} />
          </Row>
          <Reorder.Group
            as="div"
            axis="y"
            values={zones[zone]}
            onReorder={(order: BarItem[]) => setTaskbar((cur) => ({ zones: { ...cur.zones, [zone]: order } }))}
            className="divide-y divide-separator"
          >
            {zones[zone].map((id) => (
              <Reorder.Item
                key={id}
                value={id}
                as="div"
                transition={springs.snappy}
                onDragStart={() => setDragging(id)}
                onDragEnd={() => setDragging(null)}
                whileDrag={{ scale: 1.02 }}
                className={`group relative flex min-h-9 cursor-grab items-center gap-2.5 px-3 py-1 active:cursor-grabbing ${
                  dragging === id ? "z-10 rounded-[10px] bg-elevated shadow-[0_6px_18px_rgb(0_0_0/0.45)]" : ""
                }`}
              >
                <DotsSixVertical size={13} weight="bold" className="-ms-1 shrink-0 text-label-4 transition-colors group-hover:text-label-3" />
                <ItemIcon id={id} />
                {/* From its own width, so a narrow page shrinks it along with a widget's options instead of first. */}
                <span className="min-w-0 flex-auto truncate text-body text-label select-none">{t(isWidget(id) ? partInfo[id].label : ITEM_LABEL[id])}</span>
                {isWidget(id) && <WidgetOptions id={id} />}
                <div onPointerDown={(e) => e.stopPropagation()}>
                  {/* The menu also reports its current zone when picked again, which would send the item to that zone's end. A widget goes in as "+" puts it, before the Crest button. */}
                  <Select
                    width="w-36"
                    value={zone}
                    options={options}
                    onChange={(to) => to !== zone && setTaskbar((cur) => ({ zones: isWidget(id) ? addWidget(removeWidget(cur.zones, id), id, to) : moveItem(cur.zones, id, to) }))}
                  />
                </div>
              </Reorder.Item>
            ))}
          </Reorder.Group>
        </div>
      ))}
      {shape === "capsule" && (
        <Row label={<span className="whitespace-normal">{t("Als Kapsel reiht die Taskleiste die drei Bereiche in der Mitte aneinander: links, Mitte, rechts. Die Bereiche hier bleiben, wie sie sind")}</span>} />
      )}
    </Group>
  );
}

/** An item's icon: Crest's mark, the app menu's squares, the apps' window, or a widget's part as the settings show it. A new fixed item does not compile without one. */
function ItemIcon({ id }: { id: BarItem }) {
  if (isWidget(id)) {
    const I = partInfo[id].icon;
    return <I size={15} weight="bold" className="shrink-0 text-label-2" />;
  }
  if (id === "start") return <SquaresFour size={15} weight="bold" className="shrink-0 text-label-2" />;
  if (id === "apps") return <AppWindow size={15} weight="bold" className="shrink-0 text-label-2" />;
  if (id === "crest") return <CrestMark size={15} className="shrink-0 text-label-2" />;
  return id satisfies never;
}

/**
 * Taskbar → Apps and windows: the pinned apps in the bar's order. An app is pinned on the bar, from its right-click menu; Windows'
 * pinned apps replace the list from here (one that is not empty only on a second click within 3 s), and an empty answer leaves it.
 */
export function TaskbarApps() {
  const pinned = settings.use().taskbar.pinned ?? [];
  const [confirm, setConfirm] = useState(false);
  const [outcome, setOutcome] = useState<"none" | "failed" | null>(null);

  useEffect(() => {
    if (!confirm) return;
    const id = window.setTimeout(() => setConfirm(false), 3000);
    return () => window.clearTimeout(id);
  }, [confirm]);

  const importPins = () => {
    setOutcome(null);
    if (pinned.length && !confirm) return setConfirm(true);
    setConfirm(false);
    void taskbar.importPins().then(
      (apps) => {
        const next = normalizeFavorites(apps);
        if (next?.length) setTaskbar({ pinned: next });
        else setOutcome("none");
      },
      () => setOutcome("failed"),
    );
  };

  return (
    <Group id="settings-taskbar-apps">
      <Row label={t("Angeheftete Apps")} hint={pinned.length ? t("Zum Sortieren ziehen") : t("Mit Rechtsklick auf eine App in der Taskleiste anheften")} />
      {pinned.length > 0 && <FavoriteList favorites={pinned} onChange={(next) => setTaskbar({ pinned: next })} />}
      {/* Long in some languages beside the button: the name wraps instead of being cut. */}
      <Row
        label={<span className="whitespace-normal">{t("Apps der Windows-Taskleiste")}</span>}
        hint={
          outcome === "none"
            ? t("Auf der Windows-Taskleiste ist keine App angeheftet")
            : outcome === "failed"
              ? t("Die Apps von Windows lassen sich gerade nicht lesen")
              : t("Ersetzt die angehefteten Apps durch die der Windows-Taskleiste")
        }
      >
        <Button onClick={importPins}>
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
    </Group>
  );
}

/**
 * Taskbar → Appearance: the bar's shape, height, its icons' size, its background, its transparency and its glass. Colours, theme and
 * the glass's sliders are the ones of Notch → Themes.
 */
export function TaskbarLook() {
  const { shape, height, iconSize, surface, transparency, glass } = settings.use().taskbar;
  const theme = activeTheme.use();
  // The glass's switch only where the live glass can run (src/notch/glass/live.ts), as in Notch → Themes.
  const support = liveSupport.use(), live = !isMac && support?.supported === true;
  // How much of the screen behind shows, as the notch's Transparency says it: the surface's veil (look.ts barVeil) on the Notch
  // surface's Dark tokens, unless the theme colours the closed notch too.
  const veils = themeVeils(surface === "notch" && !theme.closedNotch ? darkInk() : theme.vars);
  const seen = Math.round((1 - barVeil({ transparency, glass: glass && live, reduced: false, ...veils })) * 100);
  return (
    <Group id="settings-taskbar-look">
      <Row label={t("Form")}>
        <Segmented
          id="taskbar-shape"
          size="sm"
          value={shape}
          onChange={(shape) => setTaskbar({ shape })}
          options={(Object.keys(SHAPE_LABEL) as BarShape[]).map((s) => ({ value: s, label: t(SHAPE_LABEL[s]) }))}
        />
      </Row>
      <PxRow label={t("Höhe")} value={height} min={HEIGHT[0]} max={HEIGHT[1]} onChange={(height) => setTaskbar({ height })} />
      {/* The size the bar draws: a lower bar keeps the saved one and a taller bar gives it back (fitIcon). */}
      <PxRow label={t("Symbolgröße")} value={fitIcon(height, iconSize)} min={ICON[0]} max={fitIcon(height, ICON[1])} onChange={(iconSize) => setTaskbar({ iconSize })} />
      <Row label={t("Hintergrund")} hint={t("Notch: wie die geschlossene Notch. Theme: die Hintergrundfarbe des Themes")}>
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
      <Row label={t("Transparenz")}>
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
              <span className="mt-1 flex items-start gap-1 text-caution">
                <WarningCircle aria-hidden size={12} weight="fill" className="mt-px shrink-0" />
                {t("Braucht mehr Akku: Windows hat bei jeder Änderung auf dem Bildschirm mehr Arbeit")}
              </span>
            </>
          }
        >
          <Switch label={t("Glas")} checked={glass} onChange={(glass) => setTaskbar({ glass })} />
        </Row>
      )}
      {/* The notch's glass sliders (Notch → Themes shows them only with the notch's glass on): Crest has one glass. */}
      {live && glass && (
        <>
          <Row label={<span className="whitespace-normal">{t("Lichtbrechung, Mattierung und Licht am Rand gelten auch für die Notch")}</span>} />
          <GlassSlider label={t("Lichtbrechung")} hint={t("Wie stark der Rand den Hintergrund biegt")} field="glassRefraction" step={10} />
          <GlassSlider label={t("Mattierung")} hint={t("Wie stark der Hintergrund in der Mitte verschwimmt")} field="glassFrost" step={10} />
          <GlassSlider label={t("Licht am Rand")} hint={t("Wie hell der Rand des Glases leuchtet")} field="glassRim" step={10} />
        </>
      )}
      <Row label={<span className="whitespace-normal">{t("Farben und Thema gelten auch für die Taskleiste")}</span>}>
        <Button onClick={() => nav.set({ tabId: "settings", section: "themes" })}>{t("Themen")}</Button>
      </Row>
    </Group>
  );
}

/** A slider with its value in CSS px, in even steps: the icon then sits in the bar's middle on whole pixels. */
function PxRow({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <Row label={label}>
      <div className="flex w-52 items-center gap-2">
        <Slider label={label} value={value} min={min} max={max} step={2} onChange={onChange} />
        <span className="tabular w-14 shrink-0 text-end text-caption text-label-2">{value} px</span>
      </div>
    </Row>
  );
}
