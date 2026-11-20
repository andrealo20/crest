import { motion } from "motion/react";
import { design } from "../../../design/design";
import { springs } from "../../../design/motion";
import { AppIcon } from "../../launcher/AppIcon";
import { marks } from "../itemLook";
import type { BarButton, Indicator } from "../model";
import { Mark } from "./Item";

/**
 * The apps behind "…" in the panel above the bar, sized by TRAY_SIZE: five to a row at the bar's icon size, scrolling past four rows,
 * each with its mark under it. The bar decides what a click and a right click do, as for its own buttons.
 */
export function AppsPanel(props: {
  apps: { b: BarButton; icon: string | null | undefined; mark: Indicator }[];
  size: number;
  markAt: number;
  onClick: (b: BarButton, cell: HTMLElement) => void;
  onMenu: (b: BarButton, cell: HTMLElement) => void;
}) {
  const appDesign = design.use();
  const material = appDesign === "material";
  return (
    <div className="grid h-full grid-cols-5 content-start overflow-y-auto p-3 [scrollbar-width:none]" style={{ gridAutoRows: props.size + 16 }}>
      {props.apps.map(({ b, icon, mark }) => (
        <button
          key={b.key}
          aria-label={b.name}
          title={b.name}
          onClick={(e) => props.onClick(b, e.currentTarget)}
          onContextMenu={(e) => {
            e.preventDefault();
            props.onMenu(b, e.currentTarget);
          }}
          className="relative flex items-center justify-center rounded-[8px] outline-none hover:bg-fill-2 focus-visible:bg-fill-2 material:rounded-full pressable-wide"
        >
          {/* Under Material the app in front has the bar's tonal pill in place of the long mark, as tall as an M3 indicator. */}
          {material && <motion.span aria-hidden data-front-pill className="absolute inset-1 rounded-full bg-secondary-container" initial={false} animate={{ opacity: marks(mark, appDesign).pill ? 1 : 0, transform: `scaleX(${marks(mark, appDesign).pill ? 1 : 0.6})` }} transition={springs.snappy} />}
          <span className="relative flex">
            <AppIcon src={icon} size={props.size} />
          </span>
          <Mark kind={mark} bottom={props.markAt} />
        </button>
      ))}
    </div>
  );
}
