import { useEffect, useState } from "react";
import { t } from "../../../i18n";
import { taskbar } from "../../../platform/services";
import type { JumpList } from "../model";
import { Row } from "./BarMenu";

/** The rows the menu lists at most, as Rust reads them (jumplist.rs RECENT_ITEMS). */
const RECENT_ROWS = 12;

/**
 * The Recently opened button's menu: the files and folders Windows recorded as opened last, newest first, read once as it opens
 * (jumplist.rs `taskbar_recent`), nothing in between. A row opens with the app Windows opens it with. One disabled row says why
 * there is none: still reading, nothing opened, or Windows keeping no list ("Show recently opened items" off).
 */
export function RecentMenu({ close }: { close: () => void }) {
  const [list, setList] = useState<JumpList | "off" | "none" | null>(null);
  useEffect(() => {
    let live = true;
    taskbar.recent().then(
      (l) => live && setList(l),
      (e) => live && setList(e === "off" ? "off" : "none"),
    );
    return () => {
      live = false;
    };
  }, []);
  const rows = typeof list === "object" && list ? list.groups.flatMap((g) => g.items).filter((i) => !i.separator).slice(0, RECENT_ROWS) : [];
  if (typeof list !== "object" || !list || !rows.length) {
    const why = list === null ? t("Wird geladen …") : list === "off" ? t("Windows merkt sich keine geöffneten Elemente") : t("Nichts zuletzt geöffnet");
    return <Row label={why} disabled onClick={() => {}} />;
  }
  return rows.map((item) => (
    <Row
      key={item.id}
      label={item.title}
      icon={item.icon}
      onClick={() => {
        close();
        // A file deleted since opens nothing; Windows says nothing either.
        void taskbar.jumpOpen(list.token, item.id).catch(() => {});
      }}
    />
  ));
}
