import { useEffect, useState } from "react";
import { livePosition, type NowPlaying } from "../../platform/media";
import { LEAD, cacheKey, lineAt, lyricsOf, pickRecord, searchTerms, untilNext, type LrclibRecord, type LyricLine, type Lyrics } from "./lrc";
import { createLyricsCache, type CacheEntry } from "./lyricsCache";

/*
 * Synced lyrics from LRCLIB (lrclib.net, free, no key). Only title, artist and length are sent, and only while a lyrics
 * surface is on: the panel in Now Playing or a lyric mode of the closed notch. Answers are cached in memory and on disk.
 */

const API = "https://lrclib.net/api";
/** LRCLIB asks clients to name themselves; browsers may not set User-Agent. */
const CLIENT = "Crest (https://github.com/andrealo20/crest)";

const cache = createLyricsCache(
  (() => {
    try {
      return localStorage;
    } catch {
      return null;
    }
  })(),
);
const pending = new Map<string, Promise<Lyrics | null>>();
/** After a 429, nothing is asked until then (LRCLIB requires honouring Retry-After). */
let blockedUntil = 0;

class Unavailable extends Error {}

async function ask(path: "get" | "search", params: Record<string, string>): Promise<unknown> {
  if (Date.now() < blockedUntil) throw new Unavailable();
  const r = await fetch(`${API}/${path}?${new URLSearchParams(params)}`, { headers: { "Lrclib-Client": CLIENT }, signal: AbortSignal.timeout(8000) });
  if (r.status === 404) return null;
  if (r.status === 429) {
    const wait = Number(r.headers.get("Retry-After"));
    blockedUntil = Date.now() + (Number.isFinite(wait) && wait > 0 ? wait : 60) * 1000;
    throw new Unavailable();
  }
  if (!r.ok) throw new Unavailable();
  return r.json();
}

/** The exact match first (LRCLIB allows 2 s of difference), then a search. */
async function fetchEntry(title: string, artist: string, duration: number): Promise<CacheEntry> {
  const q = searchTerms(title, artist);
  // The exact match needs an artist; without one only the search can help.
  if (!q.artist) return entryOf(pickRecord(await ask("search", { track_name: q.title }), duration));
  const base: Record<string, string> = { track_name: q.title, artist_name: q.artist };
  const exact = (await ask("get", duration > 0 ? { ...base, duration: String(Math.round(duration)) } : base)) as LrclibRecord | null;
  return entryOf(exact?.instrumental || exact?.syncedLyrics ? exact : pickRecord(await ask("search", base), duration));
}

const entryOf = (record: LrclibRecord | null): CacheEntry => ({ lrc: record?.syncedLyrics ?? null, instrumental: !!record?.instrumental, at: Date.now() });

const fromEntry = (e: CacheEntry): Lyrics => (e.instrumental ? { kind: "instrumental" } : lyricsOf({ syncedLyrics: e.lrc }));

/** Lyrics of a song; null when LRCLIB could not be reached (not cached, asked again next time). */
function lyricsFor(title: string, artist: string, duration: number): Promise<Lyrics | null> {
  const key = cacheKey(title, artist, duration);
  const known = cache.get(key);
  if (known) return Promise.resolve(fromEntry(known));
  let p = pending.get(key);
  if (!p) {
    p = fetchEntry(title, artist, duration)
      .then((e) => {
        cache.set(key, e);
        return fromEntry(e);
      })
      .catch(() => null)
      .finally(() => pending.delete(key));
    pending.set(key, p);
  }
  return p;
}

export type LyricsState = Lyrics | { kind: "loading" } | { kind: "offline" };

/** Lyrics of the shown song while `enabled`; nothing is fetched otherwise. */
export function useLyrics(np: NowPlaying | null, enabled: boolean): LyricsState | null {
  // Browser players report no artist for some videos; the title alone still finds many songs.
  const key = np && enabled && np.title.trim() ? cacheKey(np.title, np.artist, np.duration) : null;
  const [state, setState] = useState<{ key: string; value: LyricsState } | null>(null);
  useEffect(() => {
    if (!key || !np) return;
    let alive = true;
    setState({ key, value: { kind: "loading" } });
    void lyricsFor(np.title, np.artist, np.duration).then((l) => alive && setState({ key, value: l ?? { kind: "offline" } }));
    return () => {
      alive = false;
    };
  }, [key]);
  return key && state?.key === key ? state.value : key ? { kind: "loading" } : null;
}

/** The synced lines, if the state has them. */
export const linesOf = (l: LyricsState | null): LyricLine[] | null => (l?.kind === "synced" ? l.lines : null);

/**
 * Index of the line being sung (-1 before the first). Wakes once per line with a timeout, never polls; paused it stays.
 */
export function useLyricIndex(lines: LyricLine[] | null, np: NowPlaying | null): number {
  const [index, setIndex] = useState(-1);
  useEffect(() => {
    if (!lines?.length || !np) return setIndex(-1);
    let id = 0;
    const step = () => {
      const t = livePosition(np) + LEAD;
      const i = lineAt(lines, t);
      setIndex(i);
      const wait = untilNext(lines, i, t);
      if (np.isPlaying && wait !== Infinity) id = window.setTimeout(step, wait * 1000 + 20);
    };
    step();
    return () => window.clearTimeout(id);
  }, [lines, np]);
  return index;
}

/** Text of the current line; null before the first line, in a gap, or without lyrics. */
export function useLyricLine(np: NowPlaying | null, enabled: boolean): string | null {
  const lines = linesOf(useLyrics(np, enabled));
  const i = useLyricIndex(lines, np);
  return (lines && i >= 0 && lines[i].text) || null;
}
