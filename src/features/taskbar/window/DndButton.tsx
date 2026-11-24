import { useEffect, useState } from "react";
import { t } from "../../../i18n";
import { BellSimpleSlash } from "../../../ui/iconset";
import { systemControls, taskbar } from "../../../platform/services";
import { barShown } from "../store";
import { holdBriefly } from "./hold";
import { Item, type ItemProps } from "./Item";

/**
 * Do not disturb: the bell filled while it is on, as Crest already reads it (focus_get, the quick panel's chip), read when the bar shows
 * and when the pointer comes onto the button, never at intervals. A click opens Windows' notification settings, where its switch is;
 * Crest changes no state itself.
 */
export function DndButton({ item, dragged }: { item: Omit<ItemProps, "onClick" | "children">; dragged: (e: { detail: number }) => boolean }) {
  const [on, setOn] = useState<boolean | null>(null);
  const read = () => void systemControls.focus().then((f) => setOn(f.active), () => setOn(null));
  const shown = barShown.use();
  useEffect(() => {
    if (shown) read();
  }, [shown]);
  const name = on === null ? item.name : `${t("Nicht stören")}: ${t(on ? "An" : "Aus")}`;
  return (
    <Item
      {...item}
      name={name}
      hoverLabel={name}
      onEnter={(e) => {
        item.onEnter(e);
        read();
      }}
      onClick={(e) => {
        if (dragged(e)) return;
        holdBriefly();
        void taskbar.settings("dnd").catch(() => {});
      }}
    >
      <BellSimpleSlash size={Math.round(item.size * 0.8)} weight={on ? "fill" : "regular"} />
    </Item>
  );
}
