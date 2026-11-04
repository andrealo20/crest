import { CheckCircle, FolderOpen, Tray } from "@phosphor-icons/react";
import { NOTICE_BUTTON as BUTTON, NoticeButton } from "../../notch/row/NoticeButton";
import { noticeCard } from "../../notch/row/NoticeCard";
import { revealFile, type DownloadFinished } from "../../platform/services";
import { addToShelf } from "../shelf/ShelfView";
import { t } from "../../i18n";
import { dismissDownload } from "./store";

/** A finished download as a card: the file, "Downloaded", Show in folder and Add to Shelf. */
export function downloadNotice(d: DownloadFinished & { at: number }, max: number) {
  return noticeCard(
    {
      key: `download:${d.at}`,
      icon: <CheckCircle size={16} weight="fill" />,
      hue: "green",
      title: d.name,
      text: t("Heruntergeladen"),
      actionsWidth: 2 * BUTTON + 6,
      actions: (
        <>
          <NoticeButton label={t("Im Ordner zeigen")} onClick={() => { revealFile(d.path); dismissDownload(); }}>
            <FolderOpen size={12} weight="fill" />
          </NoticeButton>
          <NoticeButton label={t("Zur Ablage hinzufügen")} onClick={() => { addToShelf([d.path]); dismissDownload(); }}>
            <Tray size={12} weight="fill" />
          </NoticeButton>
        </>
      ),
    },
    max,
  );
}
