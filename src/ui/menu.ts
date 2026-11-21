/*
 * The look of Crest's menus, shared by the Select menu (controls.tsx) and the taskbar's menus (src/features/taskbar/window/BarMenu.tsx).
 * A module of its own, so the taskbar's page gets the two classes without the controls.
 */

/** The panel: a raised card over everything, its rows scrolling inside. */
export const MENU_PANEL_CLASS =
  "pointer-events-auto fixed z-[60] overflow-y-auto rounded-[10px] bg-elevated p-1 shadow-[0_10px_30px_rgb(0_0_0/0.6)] ring-1 ring-separator [scrollbar-width:none] material:rounded-[16px] material:shadow-level2 material:ring-0";
/**
 * A row, 28 px tall (h-7, the MENU_ROW Select measures with). pressable-wide puts Material's focus ring inside the row: outside, the
 * panel's overflow would cut it and it would cover the next row. Without .pressable it brings no press scale.
 */
export const MENU_ROW_CLASS =
  "flex h-7 w-full min-w-0 items-center rounded-[6px] px-2 text-start text-footnote hover:bg-fill-2 material:rounded-[12px] pressable-wide";
