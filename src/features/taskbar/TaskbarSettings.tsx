import { useEffect, useState } from "react";
import { Reorder } from "motion/react";
import { AppWindow, DotsSixVertical } from "@phosphor-icons/react";
import { springs } from "../../design/motion";
import { t } from "../../i18n";
import { nav } from "../../notch/nav";
import { isMac, isNative } from "../../platform/native";
import { build, taskbar } from "../../platform/services";
import { settings, updateSettings } from "../../settings/store";
import { CrestMark } from "../../ui/CrestMark";
import { Button, Group, Row, Segmented, Select, Slider, Switch } from "../../ui/controls";
import { FavoriteList } from "../launcher/FavoriteList";
import { normalizeFavorites } from "../launcher/apps";
import { fitIcon, HEIGHT, ICON, moveItem, taskbarShown, type BarItem, type TaskbarSettings, type Zone } from "./model";

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

function setTaskbar(patch: Partial<TaskbarSettings> | ((cur: TaskbarSettings) => Partial<TaskbarSettings>)) {
  updateSettings((s) => ({ taskbar: { ...s.taskbar, ...(typeof patch === "function" ? patch(s.taskbar) : patch) } }));
}

/** The bar's zones, physical: left stays left in a right-to-left language. */
const ZONES: Zone[] = ["left", "center", "right"];
const ZONE_LABEL: Record<Zone, string> = { left: "Linke Seite", center: "Mitte", right: "Rechte Seite" };
/** What the bar draws for each item: the apps' buttons, and the button of the Crest menu. */
const ITEM_LABEL: Record<BarItem, string> = { apps: "Apps und Fenster", crest: "Crest-Menü" };

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

/** Taskbar → Items: what each zone of the bar holds, in order. A row's menu moves the item to the end of another zone. */
export function TaskbarItems() {
  const zones = settings.use().taskbar.zones;
  const [dragging, setDragging] = useState<BarItem | null>(null);
  const options = ZONES.map((z) => ({ value: z, label: t(ZONE_LABEL[z]) }));
  return (
    <Group id="settings-taskbar-items">
      {ZONES.map((zone) => (
        <div key={zone}>
          <Row label={t(ZONE_LABEL[zone])} hint={zones[zone].length > 1 ? t("Zum Sortieren ziehen") : undefined} />
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
                className={`group relative flex h-9 cursor-grab items-center gap-2.5 px-3 active:cursor-grabbing ${
                  dragging === id ? "z-10 rounded-[10px] bg-elevated shadow-[0_6px_18px_rgb(0_0_0/0.45)]" : ""
                }`}
              >
                <DotsSixVertical size={13} weight="bold" className="-ms-1 text-label-4 transition-colors group-hover:text-label-3" />
                {id === "crest" ? <CrestMark size={15} className="shrink-0 text-label-2" /> : <AppWindow size={15} weight="bold" className="shrink-0 text-label-2" />}
                <span className="min-w-0 flex-1 truncate text-body text-label select-none">{t(ITEM_LABEL[id])}</span>
                <div onPointerDown={(e) => e.stopPropagation()}>
                  {/* The menu also reports its current zone when picked again; moveItem would send the item to that zone's end. */}
                  <Select width="w-36" value={zone} options={options} onChange={(to) => to !== zone && setTaskbar((cur) => ({ zones: moveItem(cur.zones, id, to) }))} />
                </div>
              </Reorder.Item>
            ))}
          </Reorder.Group>
        </div>
      ))}
    </Group>
  );
}

/**
 * Taskbar → Apps and windows: the pinned apps in the bar's order. An app is pinned on the bar, from its right-click menu; Windows'
 * pinned apps replace the list from here, a list that is not empty only on a second click within 3 s.
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
        setTaskbar({ pinned: next });
        if (!next?.length) setOutcome("none");
      },
      () => setOutcome("failed"),
    );
  };

  return (
    <Group id="settings-taskbar-apps">
      <Row label={t("Angeheftete Apps")} hint={pinned.length ? t("Zum Sortieren ziehen") : t("Mit Rechtsklick auf eine App in der Taskleiste anheften")} />
      {pinned.length > 0 && <FavoriteList favorites={pinned} onChange={(next) => setTaskbar({ pinned: next })} />}
      <Row
        label={t("Apps der Windows-Taskleiste")}
        hint={
          outcome === "none"
            ? t("Auf der Windows-Taskleiste ist keine App angeheftet")
            : outcome === "failed"
              ? t("Die Apps von Windows lassen sich gerade nicht lesen")
              : t("Ersetzt die angehefteten Apps durch die der Windows-Taskleiste")
        }
      >
        <Button onClick={importPins}>{confirm ? t("Wirklich ersetzen?") : t("Von Windows übernehmen")}</Button>
      </Row>
    </Group>
  );
}

/** Taskbar → Appearance: the bar's height, its icons' size and its background. Colours and theme are the ones of Notch → Themes. */
export function TaskbarLook() {
  const { height, iconSize, surface } = settings.use().taskbar;
  return (
    <Group id="settings-taskbar-look">
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
