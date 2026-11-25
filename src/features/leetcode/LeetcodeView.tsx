import { motion } from "motion/react";
import {
  ArrowClockwise,
  SlidersHorizontal,
  WarningCircle,
} from "../../ui/iconset";
import { content, spin } from "../../design/motion";
import { formatAgo } from "../../lib/format";
import { HeaderActions, HeaderButton } from "../../notch/header";
import { navigate } from "../../notch/nav";
import { openLeetcodeProfile, utcDate } from "../../platform/services";
import { settings } from "../../settings/store";
import { Button, Empty, Skeleton } from "../../ui/controls";
import { LeetcodeLogo } from "../../ui/brands";
import { locale, t } from "../../i18n";
import {
  shade,
  streaks,
  todayCount,
  weekColumns,
  type Day,
} from "./submissions";
import { leetcode, refreshLeetcode, useLeetcodeViewer } from "./store";

const WEEKS = 36;
const CELL = 10,
  GAP = 3;

export const leetcodeError: Record<string, string> = {
  "not-found": "Diesen LeetCode-Nutzer gibt es nicht",
  "rate-limited": "LeetCode drosselt gerade, später erneut",
  offline: "Keine Verbindung",
  parse: "LeetCode-Antwort nicht lesbar",
  failed: "Abruf fehlgeschlagen",
};

export function LeetcodeView() {
  useLeetcodeViewer();
  const user = settings.use().leetcode.user.trim();
  const { data, error, loading } = leetcode.use();

  const actions = (
    <HeaderActions>
      <HeaderButton
        label={t("Aktualisieren")}
        disabled={!user}
        onClick={() => void refreshLeetcode(true)}
      >
        <motion.span
          className="flex"
          animate={{ rotate: loading ? 360 : 0 }}
          transition={loading ? spin : { duration: 0 }}
        >
          <ArrowClockwise size={14} weight="bold" />
        </motion.span>
      </HeaderButton>
      <HeaderButton
        label={t("LeetCode-Einstellungen")}
        onClick={() => navigate("settings", "leetcode")}
      >
        <SlidersHorizontal size={14} weight="bold" />
      </HeaderButton>
    </HeaderActions>
  );

  if (!user) {
    return (
      <>
        {actions}
        <Empty
          icon={LeetcodeLogo}
          title={t("Kein LeetCode-Nutzer")}
          text={t(
            "Trage deinen LeetCode-Namen ein. Gelesen wird das öffentliche Profil, ohne Anmeldung.",
          )}
          action={
            <Button onClick={() => navigate("settings", "leetcode")}>
              {t("Nutzer eintragen")}
            </Button>
          }
        />
      </>
    );
  }

  if (!data) {
    return (
      <>
        {actions}
        {error ? (
          <Empty
            icon={WarningCircle}
            title={t(leetcodeError[error] ?? "Abruf fehlgeschlagen")}
            action={
              <Button onClick={() => void refreshLeetcode(true)}>
                {t("Erneut versuchen")}
              </Button>
            }
          />
        ) : (
          <div className="flex h-full flex-col gap-3 px-5 pt-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}
      </>
    );
  }

  const today = utcDate(new Date());
  const { current, longest } = streaks(data.days, today);
  const days = (n: number) => t(n === 1 ? "{n} Tag" : "{n} Tage", { n });

  return (
    <motion.div
      className="flex h-full flex-col gap-3 px-5 pt-1 pb-2"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: content.enter }}
    >
      {actions}
      <div
        className="grid items-baseline gap-x-5 gap-y-1 text-caption text-label-3"
        style={{ gridTemplateColumns: "repeat(5, max-content)" }}
      >
        <button
          title={t("Auf LeetCode öffnen")}
          onClick={() => openLeetcodeProfile(data.user)}
          className="pressable -mx-1 flex min-w-0 items-center gap-1.5 self-center rounded-full px-1 hover:bg-fill-1"
        >
          <LeetcodeLogo size={16} className="text-orange" />
          <span className="truncate text-footnote font-semibold text-label">
            {data.user}
          </span>
        </button>
        <Stat
          label={t("Gelöst")}
          value={data.solved.all.toLocaleString(locale())}
        />
        <DifficultyPills solved={data.solved} />
        <Stat label={t("Heute")} value={String(todayCount(data.days, today))} />
        <Stat label={t("Serie")} value={days(current)} />
        <div className="col-start-2 col-span-4">
          <Stat label={t("Längste")} value={days(longest)} />
        </div>
      </div>

      <Heatmap days={data.days} today={today} />

      <div className="mt-auto flex items-center justify-between text-caption text-label-4">
        <span title={error ? t(leetcodeError[error] ?? "") : undefined}>
          {error
            ? t("Stand {ago}", {
                ago: formatAgo(Date.now() - data.fetchedAt),
              })
            : formatAgo(Date.now() - data.fetchedAt)}
        </span>
        {typeof data.ranking === "number" && data.ranking > 0 && (
          <span>
            {t("Rang: #{n}", { n: data.ranking.toLocaleString(locale()) })}
          </span>
        )}
      </div>
    </motion.div>
  );
}

function DifficultyPills({
  solved,
}: {
  solved: { easy: number; medium: number; hard: number };
}) {
  return (
    <span className="flex items-center gap-1.5 text-caption font-medium">
      <span className="text-green">{solved.easy} {t("E")}</span>
      <span className="text-yellow">{solved.medium} {t("M")}</span>
      <span className="text-red">{solved.hard} {t("H")}</span>
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex shrink-0 items-baseline gap-1.5">
      {label}
      <span className="tabular font-semibold text-label">{value}</span>
    </span>
  );
}

function dayTitle(d: Day): string {
  const date = new Date(`${d.date}T12:00:00Z`).toLocaleDateString(locale(), {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  if (d.count === 0 && d.level === 0)
    return t("Keine Einreichungen am {date}", { date });
  if (d.count === 0) return date;
  return d.count === 1
    ? t("1 Einreichung am {date}", { date })
    : t("{n} Einreichungen am {date}", { n: d.count, date });
}

function Heatmap({ days, today }: { days: Day[]; today: string }) {
  const weeks = weekColumns(days, today, WEEKS);
  return (
    <div
      className="flex justify-center"
      style={{ gap: GAP }}
      role="img"
      aria-label={t("Einreichungen der letzten {n} Wochen", { n: WEEKS })}
    >
      {weeks.map((week, w) => (
        <div key={w} className="flex flex-col" style={{ gap: GAP }}>
          {week.map((d, i) =>
            d ? (
              <span
                key={i}
                title={dayTitle(d)}
                className="rounded-[2.5px]"
                style={{
                  width: CELL,
                  height: CELL,
                  background: shade(d.level),
                }}
              />
            ) : (
              <span key={i} style={{ width: CELL, height: CELL }} />
            ),
          )}
        </div>
      ))}
    </div>
  );
}
