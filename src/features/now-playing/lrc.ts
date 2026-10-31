// Synced lyrics, the pure part: LRC parsing, the line at a time, the LRCLIB query and which record to take.
// Parts of the query cleanup and the search fallback follow L4-Notchbar PR #13 by mhmmdazizy.

export interface LyricLine {
  /** Seconds from the start of the song. */
  time: number;
  /** Empty for an instrumental gap. */
  text: string;
}

export type Lyrics = { kind: "synced"; lines: LyricLine[] } | { kind: "instrumental" } | { kind: "none" };

/** Lines show this much before their stamp, so they appear as they are sung rather than after. */
export const LEAD = 0.25;

const STAMP = /^\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/;
const OFFSET = /^\[offset:\s*([+-]?\d+)\s*\]$/i;
/** Word stamps of enhanced LRC (`<00:12.34>`), not shown. */
const WORD_STAMP = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;

/**
 * Lines of an LRC text, sorted by time. A line may carry several stamps (a repeated chorus); `[offset:ms]` moves every
 * line (positive = earlier, as in the format); tags like `[ar:…]` and lines without a stamp are skipped.
 */
export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  let offset = 0;
  for (const raw of text.split(/\r?\n/)) {
    let rest = raw.trim();
    const off = OFFSET.exec(rest);
    if (off) {
      offset = Number(off[1]) / 1000;
      continue;
    }
    const stamps: number[] = [];
    for (let m = STAMP.exec(rest); m; m = STAMP.exec(rest)) {
      stamps.push(Number(m[1]) * 60 + Number(m[2].replace(":", ".")));
      rest = rest.slice(m[0].length).trimStart();
    }
    const words = rest.replace(WORD_STAMP, "").replace(/\s+/g, " ").trim();
    for (const time of stamps) lines.push({ time, text: words });
  }
  return lines.map((l) => ({ time: Math.max(0, l.time - offset), text: l.text })).sort((a, b) => a.time - b.time);
}

/** Index of the line sung at `t` seconds: the last one that started; -1 before the first. */
export function lineAt(lines: LyricLine[], t: number): number {
  let lo = 0, hi = lines.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Seconds from `t` until the line after `index` starts; Infinity after the last one. */
export function untilNext(lines: LyricLine[], index: number, t: number): number {
  const next = lines[index + 1];
  return next ? Math.max(0, next.time - t) : Infinity;
}

const NOISE = /\s*[([](?:official|lyrics?|audio|video|music|visuali[sz]er|hd|hq|4k|mv|m\/v)\b[^)\]]*[)\]]/gi;
const NOT_AN_ARTIST = /^(?:google chrome|chrome|microsoft edge|edge|brave|firefox|opera|vivaldi|youtube)$/i;

/**
 * Title and artist for the query. Browser players often report a video title ("Artist - Song (Official Video)") with
 * the channel or no artist: the extras go, and the title is split when the artist is missing or not a person.
 */
export function searchTerms(title: string, artist: string): { title: string; artist: string } {
  let t = title.replace(NOISE, "").trim() || title.trim();
  let a = artist.trim();
  const channel = /\s+-\s+topic$/i.test(a) || /vevo$/i.test(a);
  a = a.replace(/\s+-\s+topic$/i, "").replace(/vevo$/i, "").trim();
  const dash = t.indexOf(" - ");
  if (dash > 0 && (!a || NOT_AN_ARTIST.test(a) || channel)) {
    a = t.slice(0, dash).trim();
    t = t.slice(dash + 3).trim();
  }
  return { title: t, artist: a };
}

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** Cache key of a song: the cleaned query and the length in whole seconds (0 = unknown). */
export function cacheKey(title: string, artist: string, duration: number): string {
  const q = searchTerms(title, artist);
  return `${norm(q.artist)}\n${norm(q.title)}\n${duration > 0 ? Math.round(duration) : 0}`;
}

export interface LrclibRecord {
  duration?: number;
  instrumental?: boolean;
  syncedLyrics?: string | null;
}

/** A search result may be another recording; beyond this its lines would drift. */
export const MAX_DRIFT = 5;

/** Best search result: synced, and with a known length the closest one within MAX_DRIFT. */
export function pickRecord(records: unknown, duration: number): LrclibRecord | null {
  if (!Array.isArray(records)) return null;
  const synced = records.filter((r): r is LrclibRecord => !!r && typeof r === "object" && typeof r.syncedLyrics === "string" && r.syncedLyrics.trim() !== "");
  if (duration <= 0) return synced[0] ?? null;
  let best: LrclibRecord | null = null, gap = Infinity;
  for (const r of synced) {
    const d = typeof r.duration === "number" ? Math.abs(r.duration - duration) : Infinity;
    if (d <= MAX_DRIFT && d < gap) {
      best = r;
      gap = d;
    }
  }
  return best;
}

/** What a record means for the notch. */
export function lyricsOf(record: LrclibRecord | null): Lyrics {
  if (record?.instrumental) return { kind: "instrumental" };
  const lines = typeof record?.syncedLyrics === "string" ? parseLrc(record.syncedLyrics) : [];
  return lines.some((l) => l.text) ? { kind: "synced", lines } : { kind: "none" };
}
