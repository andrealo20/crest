// The counts in D1 (schema.sql). One row per day, kind and key: kind 'total' with key '', or a breakdown by country, platform,
// version or channel. Breakdowns live for their day only; prune() keeps the daily totals and nothing else.

export const KINDS = ['country', 'platform', 'version', 'channel'];

const ADD = `INSERT INTO counts (day, kind, key, n) VALUES (?1, ?2, ?3, 1)
  ON CONFLICT (day, kind, key) DO UPDATE SET n = n + 1`;

export function d1Store(db) {
  return {
    // One ping: the total and each breakdown go up by one, in one batch
    async add(day, fields) {
      const add = db.prepare(ADD);
      await db.batch([add.bind(day, 'total', ''), ...KINDS.map((kind) => add.bind(day, kind, fields[kind]))]);
    },
    async read(today, since) {
      const rows = (await db.prepare('SELECT kind, key, n FROM counts WHERE day = ?1 AND kind != ?2').bind(today, 'total').all()).results;
      const totals = (await db.prepare('SELECT day, n FROM counts WHERE kind = ?1 AND day >= ?2 ORDER BY day').bind('total', since).all()).results;
      const breakdown = Object.fromEntries(KINDS.map((kind) => [kind, {}]));
      for (const r of rows) if (breakdown[r.kind]) breakdown[r.kind][r.key] = r.n;
      return { breakdown, totals };
    },
    // Run by the cron just after midnight UTC: yesterday's countries, systems and versions go, its total stays
    async prune(today) {
      await db.prepare('DELETE FROM counts WHERE kind != ?1 AND day < ?2').bind('total', today).run();
    },
  };
}
