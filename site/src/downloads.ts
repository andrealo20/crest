/**
 * The download total of the GitHub releases, read once when the site is built (vite.config.ts) so the stats page makes no request
 * of its own to GitHub. It is the figure of the README's downloads badge: every file of every release, added up.
 */
export interface Downloads {
  read: string;
  total: number;
}

export interface Release {
  assets: { download_count: number }[];
}

export function summarize(list: Release[], read: Date): Downloads {
  return { read: read.toISOString(), total: list.reduce((s, r) => s + r.assets.reduce((t, a) => t + a.download_count, 0), 0) };
}
