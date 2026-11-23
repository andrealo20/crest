// The faces of the bar's Unread widget, what its click opens and its menu's rows. It counts, for the apps picked in the settings, the
// notifications each still has in Windows' notification centre, as Live notices reads them (notices.rs): notifications, not messages.

import { AnimatePresence, motion } from "motion/react";
import { fade } from "../../../design/motion";
import { t } from "../../../i18n";
import { settingsWindow } from "../../../platform/native";
import { noticeSource, taskbar } from "../../../platform/services";
import { ChatCircle } from "../../../ui/iconset";
import { useNoticeIcon } from "../../system/AppIcon";
import { barFeed } from "../barStores";
import { countBadge, variantOf } from "../model";
import { UNREAD, unreadLead, type UnreadApp } from "../unread";
import { Row } from "./BarMenu";
import { holdBriefly } from "./hold";
import type { Body, WidgetContext } from "./Widget";

const fades = { initial: { opacity: 0 }, animate: { opacity: 1, transition: fade }, exit: { opacity: 0, transition: fade } };

/** An app's icon, 16 px; ChatCircle where there is none, and in the previews, which ask for nothing. */
function AppGlyph({ id }: { id: string | null }) {
  const src = useNoticeIcon(id);
  return src ? <img src={src} width={16} height={16} alt="" draggable={false} className="shrink-0" /> : <ChatCircle size={16} weight="regular" className="shrink-0 text-label-2" />;
}

/**
 * One app's cell, as tall as the closed row: its icon in the middle and the count in a pill over the icon's top end, none at zero.
 * Another app taking the cell fades over the one leaving it, and so does the pill; the number changes in place.
 */
function AppBadge({ id, count, sample }: { id: string; count: number; sample: boolean }) {
  const badge = countBadge(count);
  return (
    <span className="relative grid h-[30px] shrink-0" style={{ width: UNREAD.slot }}>
      <AnimatePresence initial={false}>
        <motion.span key={id} className="col-start-1 row-start-1 flex items-center justify-center" {...fades}>
          <AppGlyph id={sample ? null : id} />
        </motion.span>
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {badge && (
          // 12 px in a 16 px pill: inside the face's zoom, so still 9 px at the smallest widget size.
          <motion.span
            key="badge"
            className="tabular absolute end-0 top-[3px] flex h-4 min-w-4 items-center justify-center rounded-full bg-label px-[3px] text-[12px] font-semibold leading-none text-notch"
            {...fades}
          >
            {badge}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** The picked apps with their counts, as one icon with the total or each app on its own; null without data or picks. */
export function unreadPart(ctx: WidgetContext): Body | null {
  const apps = ctx.feed.unread;
  if (!apps?.length) return null;
  // The apps' names are not translated, as the Top apps' are not.
  const spoken = apps.map((a) => `${a.name} ${a.count}`).join(", ");
  const sample = !!ctx.sample;
  if (variantOf(ctx.variants, "unread") === "each") {
    return {
      node: (
        <span role="img" aria-label={spoken} className="flex shrink-0 items-center" style={{ gap: UNREAD.gap }}>
          {apps.map((a) => <AppBadge key={a.id} id={a.id} count={a.count} sample={sample} />)}
        </span>
      ),
      width: apps.length * UNREAD.slot + (apps.length - 1) * UNREAD.gap,
      tip: spoken,
    };
  }
  const lead = unreadLead(apps) as UnreadApp;
  return {
    node: (
      <span role="img" aria-label={spoken} className="flex shrink-0">
        <AppBadge id={lead.id} count={apps.reduce((n, a) => n + a.count, 0)} sample={sample} />
      </span>
    ),
    width: UNREAD.slot,
    tip: spoken,
  };
}

/**
 * Opens the app at `slot` of the version with each app, else the one in front; Windows' notification centre, where those
 * notifications are, when Windows has no app by that id. Without data the settings open on Notices, without picks on Widgets.
 */
export function openUnread(slot: number | null): void {
  const apps = barFeed.get().unread;
  if (!apps?.length) return void settingsWindow.open(apps ? "taskbar-widgets" : "notices").catch(() => {});
  const app = (slot !== null ? apps[slot] : undefined) ?? (unreadLead(apps) as UnreadApp);
  // The bar stays up while it comes to the front; Windows may refuse, and nothing changes then.
  holdBriefly();
  void noticeSource
    .openApp(app.id)
    .then((opened) => (opened ? undefined : taskbar.calendar()))
    .catch(() => {});
}

/** A row for each picked app and one for Windows' notification centre, over the widget's Crest menu rows. */
export function UnreadRows({ close }: { close: () => void; openTool: (tool: string) => void }) {
  const apps = barFeed.use().unread ?? [];
  const run = (action: () => void) => () => {
    close();
    action();
  };
  return (
    <>
      {apps.map((a, i) => (
        <Row key={a.id} label={t("{name} öffnen", { name: a.name })} onClick={run(() => openUnread(i))} />
      ))}
      <Row
        label={t("{name} öffnen", { name: t("Benachrichtigungscenter") })}
        onClick={run(() => {
          holdBriefly();
          void taskbar.calendar().catch(() => {});
        })}
      />
      <div className="h-px bg-separator my-1" />
    </>
  );
}
