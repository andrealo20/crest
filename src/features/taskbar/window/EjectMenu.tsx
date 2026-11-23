import { useEffect, useLayoutEffect, useState } from "react";
import { t } from "../../../i18n";
import { createStore } from "../../../lib/store";
import { taskbar } from "../../../platform/services";
import type { DiskDrive } from "../disks";
import { ejectNote } from "../toggles";
import { ROWS, Row } from "./BarMenu";

/** The drives that plug in as the bar read them last, for the Eject button's look and its menu; null until read. In memory only. */
export const removables = createStore<DiskDrive[] | null>(null);

/** A drive's name and letter, as the disk panel and this menu list it. */
export const diskName = (d: DiskDrive) => `${d.name || (d.removable ? t("USB-Laufwerk") : t("Lokaler Datenträger"))} (${d.letter})`;

/** Reads the drives again; while another read is under way (taskbar_disks gives null) the last list stays. */
export const readRemovables = (): Promise<void> => taskbar.disks().then((d) => void (d && removables.set(d.filter((x) => x.removable))));

/**
 * Ejects a drive and says how it went (toggles.ts ejectNote): first that it is under way, then that it can be removed, or what
 * holds it. True once it can go.
 */
export function ejectDrive(d: DiskDrive, say: (text: string, failed: boolean) => void): Promise<boolean> {
  const name = diskName(d);
  say(t("Wird ausgeworfen …"), false);
  return taskbar.eject(d.letter).then(
    () => {
      say(ejectNote(null, name, t), false);
      return true;
    },
    (code) => {
      say(ejectNote(String(code), name, t), true);
      return false;
    },
  );
}

/**
 * The Eject button's menu: the drives that plug in, read as it opens (disks.rs `taskbar_eject` ejects only these), one row each,
 * named as in the disk panel. A row closes the menu and ejects; the answer shows above the button. There is a menu even with one
 * drive, so a click on the button alone never ejects anything.
 */
export function EjectMenu({ close, say }: { close: () => void; say: (text: string, failed: boolean) => void }) {
  const [read, setRead] = useState(false);
  useEffect(() => {
    let live = true;
    void readRemovables().finally(() => live && setRead(true));
    return () => {
      live = false;
    };
  }, []);
  const all = removables.use();
  const list = read ? (all ?? []) : [];
  // The rows come after BarMenu's focus on opening found only the disabled reading row, as in RecentMenu.
  useLayoutEffect(() => {
    if (list.length) document.querySelector<HTMLElement>(`[role=menu]:not([inert]) ${ROWS}`)?.focus({ preventScroll: true });
  }, [list.length > 0]);
  if (!list.length) return <Row label={read ? t("Kein USB-Laufwerk") : t("Wird gelesen …")} disabled onClick={() => {}} />;
  return list.map((d) => (
    <Row
      key={d.letter}
      label={diskName(d)}
      onClick={() => {
        close();
        void ejectDrive(d, say);
      }}
    />
  ));
}
