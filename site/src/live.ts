import { useEffect, useState } from "react";

/** What /api/stats answers (site/stats-worker/src/handle.js). */
export interface Stats {
  day: string;
  today: { total: number; country: Record<string, number>; platform: Record<string, number>; version: Record<string, number>; channel: Record<string, number> };
  yesterday: number;
  days: { day: string; n: number }[];
  read: string;
}

/** Today's count, read now and again every five minutes, as fresh as the Worker keeps it. Undefined while reading, null once it fails. */
export function useStats() {
  const [s, setS] = useState<Stats | null | undefined>(undefined);
  useEffect(() => {
    const read = () =>
      fetch("/api/stats")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: Stats) => setS(d), () => setS((old) => old ?? null));
    read();
    const id = window.setInterval(read, 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);
  return s;
}

export const num = (n: number) => n.toLocaleString("en-GB");
