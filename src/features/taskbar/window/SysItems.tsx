import { Copy, MagnifyingGlass, Monitor, SquaresFour, type Icon } from "../../../ui/iconset";
import { taskbar } from "../../../platform/services";
import type { SysId } from "../model";
import { holdBriefly } from "./hold";
import { Item, type ItemProps } from "./Item";

/** Each of Windows' buttons the bar holds (model.ts SYS_IDS): its name (a key for t()) and its icon, which the settings and the drag's ghost show too. */
export const SYS_INFO: Record<SysId, { label: string; icon: Icon }> = {
  search: { label: "Suchen", icon: MagnifyingGlass },
  taskview: { label: "Aufgabenansicht", icon: Copy },
  widgets: { label: "Windows-Widgets", icon: SquaresFour },
  desktop: { label: "Desktop anzeigen", icon: Monitor },
};

/**
 * One of Windows' buttons. Search, Task view and Windows widgets are an icon each, grown as Start is; Show desktop is a narrow sliver
 * with a 1 px line on its leading edge, as Windows' corner, without magnifying and without a name above it (a screen reader still
 * reads it). A click opens Windows' own (start.rs `taskbar_shell`), the bar held up while it comes to the front; Windows may refuse,
 * and nothing changes then. `dragged` says the click is a drag's release.
 */
export function SysButton({ id, item, dragged }: { id: SysId; item: Omit<ItemProps, "onClick" | "children">; dragged: (e: { detail: number }) => boolean }) {
  const I = SYS_INFO[id].icon;
  const narrow = Math.round(item.size / 2);
  return (
    <Item
      {...item}
      {...(id === "desktop" && { label: null, magnify: undefined, width: narrow })}
      onClick={(e) => {
        if (dragged(e)) return;
        holdBriefly();
        void taskbar.shell(id).catch(() => {});
      }}
    >
      {id === "desktop" ? <span aria-hidden className="border-s border-separator" style={{ width: narrow, height: Math.round(item.size * 0.75) }} /> : <I size={Math.round(item.size * 0.8)} weight="regular" />}
    </Item>
  );
}
