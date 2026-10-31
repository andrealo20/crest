import { useEffect, useState } from "react";
import { livePosition, media, type NowPlaying } from "../../platform/media";
import { LEAD, cacheKey, lineAt, lookupAllowed, lyricsOf, pickRecord, searchTerms, untilNext, type LrclibRecord, type LyricLine, type Lyrics } from "./lrc";
import { createLyricsCache, type CacheEntry } from "./lyricsCache";

/*
 * Synced lyrics from LRCLIB (lrclib.net, free, no key). Only title, artist and length are sent, and only while a lyrics
 * surface is on (the panel in Now Playing or a lyric mode of the closed notch) and only for sessions with a known length
 * up to 20 minutes. Answers are cached in memory and on disk.
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
/** After a 429, nothing is asked until then. */
let blockedUntil = 0;
/** Cleared if a request only goes through without the custom header (a refused CORS preflight). */
let identify = true;

class Unavailable extends Error {}

async function ask(path: "get" | "search", params: Record<string, string>): Promise<unknown> {
  if (Date.now() < blockedUntil) throw new Unavailable();
  const url = `${API}/${path}?${new URLSearchParams(params)}`;
  const send = (named: boolean) => fetch(url, { headers: named ? { "Lrclib-Client": CLIENT } : {}, signal: AbortSignal.timeout(8000) });
  let r: Response;
  try {
    r = await send(identify);
  } catch (e) {
    // fetch reports a refused preflight as a TypeError, like being offline; one try without the header tells them apart.
    if (!(e instanceof TypeError) || !identify) throw e;
    r = await send(false);
    identify = false;
  }
  if (r.status === 404) return null;
  if (r.status === 429) {
    // Retry-After is not CORS-safelisted, so the page usually can't read it and the 60 s default applies.
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
  const exact = (await ask("get", { ...base, duration: String(Math.round(duration)) })) as LrclibRecord | null;
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

export type LyricsState = Lyrics | { kind: "loading" } | { kind: "offline" } | { kind: "skipped" };

/** An unreachable LRCLIB is asked once more, when the network is back or after this. */
const OFFLINE_RETRY_MS = 60_000;

/** Lyrics surfaces on screen; while there is one, Rust refreshes the position every few seconds. */
let shown = 0;

/** Lyrics of the shown song while `enabled`; nothing is fetched otherwise. */
export function useLyrics(np: NowPlaying | null, enabled: boolean): LyricsState | null {
  // Browser players report no artist for some videos; the title alone still finds many songs.
  const wanted = !!np && enabled && np.title.trim() !== "";
  // Streams, podcasts and other long or open-ended sessions are not looked up, so their titles stay on the PC.
  const allowed = wanted && lookupAllowed(np.duration);
  const key = allowed ? cacheKey(np.title, np.artist, np.duration) : null;
  const [state, setState] = useState<{ key: string; value: LyricsState } | null>(null);
  useEffect(() => {
    if (!key || !np) return;
    let alive = true, retried = false, timer = 0;
    const again = () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", again);
      if (alive) load();
    };
    const load = () =>
      void lyricsFor(np.title, np.artist, np.duration).then((l) => {
        if (!alive) return;
        setState({ key, value: l ?? { kind: "offline" } });
        if (l || retried) return;
        retried = true;
        window.addEventListener("online", again);
        timer = window.setTimeout(again, OFFLINE_RETRY_MS);
      });
    setState({ key, value: { kind: "loading" } });
    load();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.removeEventListener("online", again);
    };
  }, [key]);
  useEffect(() => {
    if (!key) return;
    if (++shown === 1) media.lyricsShown(true);
    return () => {
      if (--shown === 0) media.lyricsShown(false);
    };
  }, [!!key]);
  if (wanted && !allowed) return { kind: "skipped" };
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
