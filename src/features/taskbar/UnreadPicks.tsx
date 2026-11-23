import { t } from "../../i18n";
import { settings } from "../../settings/store";
import { Row, SubSwitch } from "../../ui/controls";
import { setTaskbar } from "./store";
import { MAX_UNREAD, unreadChoices } from "./unread";

/**
 * Settings, Taskbar, Widgets: the apps the Unread widget counts, up to three, under its versions. WhatsApp first, then the apps Live
 * notices has seen; a fourth switched on does nothing, as the last reading switched off does nothing (WidgetRows).
 */
export function UnreadPicks() {
  const s = settings.use();
  const picks = s.taskbar.unread;
  const pick = (id: string, on: boolean) => {
    if (on && picks.length >= MAX_UNREAD) return;
    setTaskbar((cur) => ({ unread: on ? [...cur.unread.filter((x) => x !== id), id] : cur.unread.filter((x) => x !== id) }));
  };
  return (
    <Row icon="apps" label={t("Apps")} hint={t("Bis zu drei. Gezählt wird, was noch im Benachrichtigungscenter liegt")}>
      <div onPointerDown={(e) => e.stopPropagation()} className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
        {unreadChoices(s.notices.apps, picks).map((c) => (
          <SubSwitch key={c.id} label={c.name} checked={picks.includes(c.id)} onChange={(on) => pick(c.id, on)} />
        ))}
      </div>
    </Row>
  );
}
