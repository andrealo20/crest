import { motion } from "motion/react";
import { ArrowClockwise, CalendarBlank, SlidersHorizontal, WarningCircle } from "@phosphor-icons/react";
import { content, spin } from "../../design/motion";
import { formatAgo, formatTime } from "../../lib/format";
import { HeaderActions, HeaderButton } from "../../notch/header";
import { navigate } from "../../notch/nav";
import type { CalendarEvent } from "../../platform/services";
import { settings } from "../../settings/store";
import { Button, Empty, Skeleton } from "../../ui/controls";
import { locale, t } from "../../i18n";
import { agenda, dayLabel } from "./model";
import { calendar, refreshCalendar, useCalendarViewer } from "./store";

const DAYS = 7;

/** Error codes from Rust (src-tauri/src/calendar.rs). */
export const calendarError: Record<string, string> = {
  "no-key": "Link oder Passwort fehlt",
  "bad-url": "Adresse ungültig",
  auth: "Anmeldung abgelehnt",
  "not-found": "Kalender nicht gefunden",
  offline: "Keine Verbindung",
  "too-large": "Kalender zu groß",
  parse: "Kalender nicht lesbar",
  "no-calendars": "Keine Kalender im Konto",
  failed: "Abruf fehlgeschlagen",
};

/** "09:30 - 10:00", or the start alone for an event without length; all-day events say so. */
export function eventTime(e: CalendarEvent): string {
  if (e.allDay) return t("Ganztägig");
  return e.end > e.start ? `${formatTime(e.start)} - ${formatTime(e.end)}` : formatTime(e.start);
}

/*
 *   TODAY · SUN 1 NOV
 *   ▍ 09:30 - 09:45   Standup
 *   ▍ 12:30 - 13:30   Lunch with Sam · Café Central
 *   TOMORROW · MON 2 NOV
 *   ▍ All day         Mum's birthday
 */
export function CalendarView() {
  useCalendarViewer();
  const sources = settings.use().calendar.sources;
  const { data, error, loading } = calendar.use();

  const actions = (
    <HeaderActions>
      <HeaderButton label={t("Aktualisieren")} disabled={!sources.length} onClick={() => void refreshCalendar(true)}>
        <motion.span className="flex" animate={{ rotate: loading ? 360 : 0 }} transition={loading ? spin : { duration: 0 }}>
          <ArrowClockwise size={14} weight="bold" />
        </motion.span>
      </HeaderButton>
      <HeaderButton label={t("Kalender-Einstellungen")} onClick={() => navigate("settings", "calendar")}>
        <SlidersHorizontal size={14} weight="bold" />
      </HeaderButton>
    </HeaderActions>
  );

  if (!sources.length) {
    return (
      <>
        {actions}
        <Empty
          icon={CalendarBlank}
          title={t("Kein Kalender verbunden")}
          text={t("Füge einen ICS-Link (Google, Outlook, iCloud) oder ein CalDAV-Konto hinzu. Crest liest nur.")}
          action={<Button onClick={() => navigate("settings", "calendar")}>{t("Kalender hinzufügen")}</Button>}
        />
      </>
    );
  }
  if (!data) {
    return (
      <>
        {actions}
        {error ? (
          <Empty icon={WarningCircle} title={t(calendarError[error] ?? "Abruf fehlgeschlagen")} action={<Button onClick={() => void refreshCalendar(true)}>{t("Erneut versuchen")}</Button>} />
        ) : (
          <div className="flex h-full flex-col gap-3 px-5 pt-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}
      </>
    );
  }

  const now = Date.now();
  const colors = new Map(data.calendars.map((c) => [c.id, c.color]));
  const names = new Map(data.calendars.map((c) => [c.id, c.name]));
  // Today always shows; later days only when something is on.
  const days = agenda(data.events, now, DAYS).filter((d, i) => i === 0 || d.events.length);
  const failing = data.sources.filter((s) => s.error);
  const label = (day: number) => {
    const date = new Date(day).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" });
    const word = dayLabel(day, now, { today: t("Heute"), tomorrow: t("Morgen") }, () => "");
    return word ? `${word} · ${date}` : date;
  };
  const failText = failing
    .map((f) => {
      const name = settings.get().calendar.sources.find((s) => s.id === f.id)?.name || t("Kalender");
      return `${name}: ${t(calendarError[f.error!] ?? "Abruf fehlgeschlagen")}`;
    })
    .join(" · ");

  return (
    <motion.div
      className="flex h-full flex-col px-5 pt-1 pb-2"
      initial={{ opacity: 0, filter: "blur(4px)" }}
      animate={{ opacity: 1, filter: "blur(0px)", transition: content.enter }}
    >
      {actions}
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 [scrollbar-width:none]" style={{ maskImage: "linear-gradient(180deg, #000 calc(100% - 20px), transparent)" }}>
        {days.map((d) => (
          <section key={d.day} className="pb-2">
            <h3 className="py-1 text-caption font-medium tracking-wide text-label-3 uppercase">{label(d.day)}</h3>
            {d.events.length === 0 && <div className="py-1 text-footnote text-label-4">{t("Keine Termine")}</div>}
            {d.events.map((e) => {
              const past = e.end <= now && !(e.end === e.start && e.start > now);
              return (
                <div key={`${d.day}:${e.id}`} className={`flex items-center gap-2.5 py-[3px] ${past ? "opacity-45" : ""}`} title={names.get(e.calendar)}>
                  <span className="h-4 w-[3px] shrink-0 rounded-full" style={{ background: colors.get(e.calendar) || "var(--color-link)" }} />
                  <span className="tabular w-[104px] shrink-0 text-footnote text-label-3">{eventTime(e)}</span>
                  <span className="min-w-0 flex-1 truncate text-footnote text-label">
                    {e.title || t("(Ohne Titel)")}
                    {e.location && <span className="text-label-3"> · {e.location}</span>}
                  </span>
                </div>
              );
            })}
          </section>
        ))}
      </div>
      <div className="truncate pt-1 text-caption text-label-4" title={failText || undefined}>
        {failing.length ? failText : formatAgo(now - data.fetchedAt)}
      </div>
    </motion.div>
  );
}
