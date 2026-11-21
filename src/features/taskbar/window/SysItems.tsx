import { useEffect } from "react";
import { Copy, MagnifyingGlass, Monitor, SquaresFour, Translate, type Icon } from "../../../ui/iconset";
import { t } from "../../../i18n";
import { taskbar } from "../../../platform/services";
import { inputLang, startInput } from "../input";
import type { SysId } from "../model";
import { holdBriefly } from "./hold";
import { Item, type ItemProps } from "./Item";

/** Each of Windows' buttons the bar holds (model.ts SYS_IDS): its name (a key for t()) and its icon, which the settings and the drag's ghost show too. */
export const SYS_INFO: Record<SysId, { label: string; icon: Icon }> = {
  search: { label: "Suchen", icon: MagnifyingGlass },
  taskview: { label: "Aufgabenansicht", icon: Copy },
  widgets: { label: "Windows-Widgets", icon: SquaresFour },
  desktop: { label: "Desktop anzeigen", icon: Monitor },
  input: { label: "Eingabesprache", icon: Translate },
};

/** As the clock's lines (BarClock), two of them in the bar's height. */
const LINE = "block whitespace-nowrap text-center text-footnote leading-tight font-medium text-label";

/**
 * One of Windows' buttons. Search, Task view and Windows widgets are an icon each, grown as Start is; Show desktop is a narrow sliver
 * with a 1 px line on its leading edge, as Windows' corner, without magnifying and without a name above it (a screen reader still
 * reads it). A click opens Windows' own (start.rs `taskbar_shell`), the bar held up while it comes to the front; Windows may refuse,
 * and nothing changes then. `dragged` says the click is a drag's release.
 */
export function SysButton({ id, item, dragged }: { id: SysId; item: Omit<ItemProps, "onClick" | "children">; dragged: (e: { detail: number }) => boolean }) {
  if (id === "input") return <InputButton item={item} dragged={dragged} />;
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

/**
 * The input language, as Windows' indicator by the tray: the language over the region ("ITA" over "IT"), nothing while Windows has
 * one keyboard layout. It follows the window in front (taskbar/input.rs); a click opens Windows' switcher, as Win+Space.
 */
function InputButton({ item, dragged }: { item: Omit<ItemProps, "onClick" | "children">; dragged: (e: { detail: number }) => boolean }) {
  useEffect(() => startInput(), []);
  const lang = inputLang.use();
  if (!lang) return null;
  return (
    <Item
      {...item}
      name={t("Eingabesprache: {lang}", { lang: lang.lang })}
      magnify={undefined}
      onClick={(e) => {
        if (dragged(e)) return;
        holdBriefly();
        void taskbar.shell("input").catch(() => {});
      }}
    >
      <span aria-hidden className="block">
        <span className={LINE}>{lang.lang}</span>
        <span className={LINE}>{lang.region}</span>
      </span>
    </Item>
  );
}
