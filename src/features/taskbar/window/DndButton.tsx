import { BellSimpleSlash } from "../../../ui/iconset";
import { taskbar } from "../../../platform/services";
import { holdBriefly } from "./hold";
import { Item, type ItemProps } from "./Item";

/** Do not disturb: a click opens Windows' notification settings, where its switch is (decision W6); Crest changes no state itself. */
export function DndButton({ item, dragged }: { item: Omit<ItemProps, "onClick" | "children">; dragged: (e: { detail: number }) => boolean }) {
  return (
    <Item
      {...item}
      onClick={(e) => {
        if (dragged(e)) return;
        holdBriefly();
        void taskbar.settings("dnd").catch(() => {});
      }}
    >
      <BellSimpleSlash size={Math.round(item.size * 0.8)} weight="regular" />
    </Item>
  );
}
