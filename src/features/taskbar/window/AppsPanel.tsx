import type { PointerEvent as ReactPointerEvent } from "react";
import { motion } from "motion/react";
import { design } from "../../../design/design";
import { springs } from "../../../design/motion";
import { t } from "../../../i18n";
import { AppIcon } from "../../launcher/AppIcon";
import { folderGrid, gridKey } from "../folderModel";
import { marks } from "../itemLook";
import type { BarButton, ClickMods, Indicator } from "../model";
import { Mark } from "./Item";
import { pressDragged } from "./press";

/** A cell's icon: an app's picture, or for a folder the pictures of its first four apps (FolderIcon). */
export type CellIcon = string | null | undefined;

/**
 * Apps in the panel above the bar, `cols` to a row (five by default, as the tray panel's) at the bar's icon size, each with its mark
 * under it: the apps behind "…" (TRAY_SIZE, scrolling past four rows) and a folder's apps (FOLDER_SIZE). The bar decides what a click,
 * a middle click and a right click do, as for its own buttons; the arrows go from cell to cell (mirrored right to left), Enter and
 * Space are the cells' own clicks. With `onPress` a cell drags (a folder's apps); a drag's release clicks nothing. A folder behind "…"
 * shows its first four apps.
 */
export function AppsPanel(props: {
  apps: { b: BarButton; icon: CellIcon; minis?: CellIcon[]; mark: Indicator }[];
  size: number;
  markAt: number;
  cols?: number;
  /** `keyboard`: Enter or Space, which opens a folder with the keyboard on its first app. */
  onClick: (b: BarButton, cell: HTMLElement, mods: ClickMods, keyboard: boolean) => void;
  /** `shift`: Shift+right-click, the window or group menu. */
  onMenu: (b: BarButton, cell: HTMLElement, shift: boolean) => void;
  onPress?: (b: BarButton, e: ReactPointerEvent<HTMLElement>) => void;
}) {
  const appDesign = design.use();
  const material = appDesign === "material";
  const cols = props.cols ?? 5;
  return (
    <div
      className="grid h-full content-start overflow-y-auto p-3 [scrollbar-width:none]"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: props.size + 16 }}
      onKeyDown={(e) => {
        const cells = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-app-cell]")];
        const at = cells.indexOf(e.target as HTMLElement);
        const to = at < 0 ? undefined : gridKey(e.key, at, cells.length, cols, document.documentElement.dir === "rtl");
        if (to === undefined) return;
        e.preventDefault();
        cells[to].focus({ preventScroll: true });
      }}
    >
      {props.apps.map(({ b, icon, minis, mark }) => (
        <button
          key={b.key}
          data-app-cell
          aria-label={b.title ?? b.name}
          title={b.title ?? b.name}
          // A folder says it is one, as on the bar.
          aria-description={b.folder && (b.folder.apps.length === 1 ? t("Ordner, 1 App") : t("Ordner, {n} Apps", { n: b.folder.apps.length }))}
          onClick={(e) => {
            if (props.onPress && e.detail > 0 && pressDragged()) return;
            props.onClick(b, e.currentTarget, { shift: e.shiftKey, ctrl: e.ctrlKey }, e.detail === 0);
          }}
          onAuxClick={(e) => {
            if (e.button === 1) props.onClick(b, e.currentTarget, { middle: true }, false);
          }}
          // The middle button would start WebView2's autoscroll circle, as on the bar.
          onPointerDown={(e) => {
            if (e.button === 1) e.preventDefault();
            else props.onPress?.(b, e);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            props.onMenu(b, e.currentTarget, e.shiftKey);
          }}
          className="relative flex items-center justify-center rounded-[8px] outline-none hover:bg-fill-2 focus-visible:bg-fill-2 material:rounded-full pressable-wide"
          // A cell that drags keeps touch for the drag, as the bar's buttons do.
          style={props.onPress ? { touchAction: "none" } : undefined}
        >
          {/* Under Material the app in front has the bar's tonal pill in place of the long mark, as tall as an M3 indicator. */}
          {material && <motion.span aria-hidden data-front-pill className="absolute inset-x-0 inset-y-1 rounded-full bg-secondary-container" initial={false} animate={{ opacity: marks(mark, appDesign).pill ? 1 : 0, transform: `scaleX(${marks(mark, appDesign).pill ? 1 : 0.6})` }} transition={springs.snappy} />}
          {minis ? (
            <span className="relative flex">
              <FolderIcon icons={minis} size={props.size} />
            </span>
          ) : (
            <span className="relative flex">
              <AppIcon src={icon} size={props.size} />
            </span>
          )}
          <Mark kind={mark} at={props.markAt} />
        </button>
      ))}
    </div>
  );
}

/**
 * A folder's icon, on the bar, behind "…" and under a dragged folder: a square as big as an app's icon, its corners at 28 %, holding its
 * first four apps two by two (folderGrid); fewer leave their places empty. The fill is the cells' hover fill, which Liquid Glass +'s ink
 * turns light on the glass.
 */
export function FolderIcon({ icons, size }: { icons: CellIcon[]; size: number }) {
  const { mini, pad } = folderGrid(size);
  return (
    <span
      aria-hidden
      className="grid shrink-0 content-center justify-center bg-fill-2"
      style={{ width: size, height: size, borderRadius: size * 0.28, gap: pad, gridTemplateColumns: `repeat(2, ${mini}px)`, gridAutoRows: mini }}
    >
      {icons.slice(0, 4).map((src, i) => (
        <AppIcon key={i} src={src} size={mini} />
      ))}
    </span>
  );
}
