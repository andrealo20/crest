import { useEffect, useState } from "react";
import { shade, todayCount } from "../../../features/leetcode/submissions";
import { leetcode } from "../../../features/leetcode/store";
import { utcDate } from "../../../platform/services";
import { measureTabular } from "../measure";
import { t } from "../../../i18n";

/** Today's count and shade once the calendar has loaded (the LeetCode store polls while the part is on screen). */
export function useLeetcodeToday(): { count: number; level: number } | null {
  const { data } = leetcode.use();
  const [today, setToday] = useState(() => utcDate(new Date()));
  // The poll is hourly and the row stays up: moves on at UTC midnight (matching LeetCode's day rollover).
  useEffect(() => {
    const next = new Date();
    next.setUTCHours(24, 0, 1, 0);
    const id = window.setTimeout(
      () => setToday(utcDate(new Date())),
      next.getTime() - Date.now(),
    );
    return () => window.clearTimeout(id);
  }, [today]);
  if (!data) return null;
  return {
    count: todayCount(data.days, today),
    level: data.days.find((d) => d.date === today)?.level ?? 0,
  };
}

const SQUARE = 10,
  GAP = 5;

/** Room for the square and the count. */
export const leetcodeWidth = (count: number) =>
  SQUARE + GAP + measureTabular("8".repeat(String(count).length));

/** Today's LeetCode submissions: a square in today's shade and the count. */
export function LeetcodePart({
  count,
  level,
}: {
  count: number;
  level: number;
}) {
  return (
    <span
      className="flex items-center whitespace-nowrap text-footnote font-medium text-label"
      style={{ gap: GAP }}
      title={t("LeetCode-Einreichungen heute")}
    >
      <span
        className="shrink-0 rounded-[2.5px]"
        style={{
          width: SQUARE,
          height: SQUARE,
          background:
            count || level ? shade(Math.max(1, level)) : shade(0),
        }}
      />
      <span className="tabular">{count}</span>
    </span>
  );
}
