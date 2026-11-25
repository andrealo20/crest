import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { livePosition, media, type NowPlaying } from "../../platform/media";
import { isNative } from "../../platform/native";
import { isNotchWindow } from "../../lib/windowKind";
import { demo } from "../../dev/showcase-data";
import { settings } from "../../settings/store";
import { barShows, onBarShows } from "../taskbar/barPanels";
import { LEAD, cacheKey, closedIndex, closedLine, foundOf, lineAt, lookupAllowed, lyricsOf, pickRecord, searchTerms, untilNext, withExtra, type Found, type LrclibRecord, type LyricLine, type Lyrics } from "./lrc";
import { CACHE_PREFIX, createLyricsCache, type CacheEntry } from "./lyricsCache";
import { enabledSources, firstFound, type LyricSourceId } from "./lyricSources";
import { lang } from "../../i18n";
import { detectLanguage, pairsFor, targetOf, translationLrc } from "./offline";
import { hasPair, offlineStatus, translateOffline } from "./offlineEngine";

/*
 * Synced lyrics from the sources the user turned on, in their order (lyricSources.ts): LRCLIB (lrclib.net, free, no key)
 * from the webview, Kugou and NetEase from Rust (src-tauri/src/lyrics.rs). Only title, artist and length are sent, and only
 * while a lyrics surface is on (the panel in Now Playing, the notch's or a bar's, or a lyric mode of the closed notch) and only
 * for sessions with a known length up to 20 minutes. Answers are cached in memory and on disk. Only the notch asks the sources:
 * a bar's window shows what the notch cached for it.
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
/** Cleared once requests have twice only gone through without the custom header (a refused CORS preflight). */
let identify = true;
let headerless = 0;

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
    // One lost connection must not stop Crest from introducing itself to LRCLIB.
    if (++headerless >= 2) identify = false;
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

/** LRCLIB: the exact match first (it allows 2 s of difference), then a search. */
async function fromLrclib(title: string, artist: string, duration: number): Promise<Found> {
  // The exact match needs an artist; without one only the search can help.
  if (!artist) return foundOf(pickRecord(await ask("search", { track_name: title }), duration, title));
  const base: Record<string, string> = { track_name: title, artist_name: artist };
  const exact = (await ask("get", { ...base, duration: String(Math.round(duration)) })) as LrclibRecord | null;
  // The search finds a crossfading player's song too, whose length the exact match turns down (pickRecord).
  return foundOf(exact?.instrumental || exact?.syncedLyrics ? exact : pickRecord(await ask("search", base), duration, title));
}

function fromSource(id: LyricSourceId, title: string, artist: string, duration: number): Promise<Found | null> {
  const q = searchTerms(title, artist);
  // Demo: the made-up songs come with their lyrics; no source is asked.
  if (demo) return import("../../dev/demo-data").then((m) => m.demoLyrics(q.title));
  if (id === "lrclib") return fromLrclib(q.title, q.artist, duration);
  // The other sources are asked from Rust; the browser preview has none.
  return isNative ? invoke<Found | null>("lyrics_fetch", { source: id, title: q.title, artist: q.artist, duration }) : Promise.resolve(null);
}

/** Cache key of a song for these sources; LRCLIB alone keeps the key of the versions before more sources. */
const songKey = (np: NowPlaying, order: LyricSourceId[]) => {
  const key = cacheKey(np.title, np.artist, np.duration);
  return order.join(",") === "lrclib" ? key : `${key}\n${order.join(",")}`;
};

/**
 * The song's cache key while its lyrics may be looked up, else null. Browser players report no artist for some videos; the title
 * alone still finds many songs. Streams, podcasts and other long or open-ended sessions are not looked up, so their titles stay on
 * the PC.
 */
const lookupKey = (np: NowPlaying | null, order: LyricSourceId[]) =>
  np && np.title.trim() !== "" && lookupAllowed(np.duration) && order.length > 0 ? songKey(np, order) : null;

const fromEntry = (e: CacheEntry): Lyrics => lyricsOf(e);

/** Lyrics of a song; null when a source could not be reached and none had it (not cached, asked again next time). */
function lyricsFor(key: string, np: NowPlaying, order: LyricSourceId[]): Promise<Lyrics | null> {
  const known = cache.get(key);
  if (known) return Promise.resolve(fromEntry(known));
  let p = pending.get(key);
  if (!p) {
    p = firstFound(order, (id) => fromSource(id, np.title, np.artist, np.duration))
      .then((r) => {
        if (!r) return null;
        const e: CacheEntry = { ...r.found, at: Date.now() };
        cache.set(key, e);
        return fromEntry(e);
      })
      .catch(() => null)
      .finally(() => pending.delete(key));
    pending.set(key, p);
  }
  return p;
}

export type LyricsState = Lyrics | { kind: "loading" } | { kind: "offline" } | { kind: "skipped" } | { kind: "nosource" };

/** An unreachable source is asked once more, when the network is back or after this. */
const OFFLINE_RETRY_MS = 60_000;

/** Lyrics surfaces on screen; while there is one, Rust refreshes the position every few seconds. */
let shown = 0;
/** Counts a surface in or out: the first in turns the refresh on, the last out turns it off (only the notch's count reaches Rust, native.ts). */
const count = (on: boolean) => {
  if (on ? ++shown === 1 : --shown === 0) media.lyricsShown(on);
};

/**
 * Passes the song's lyrics to `done`, or the offline state when no source could be reached; such a song is asked once more, when the
 * network is back or after OFFLINE_RETRY_MS. The bar's window asks no source: it passes what the cache holds, which the notch fills for
 * a bar's panel (followBar), and on a miss reads it again when the notch writes the song there. Returns the stop.
 */
function loadLyrics(key: string, np: NowPlaying, order: LyricSourceId[], done: (l: LyricsState) => void): () => void {
  if (!isNotchWindow) {
    const read = (e?: StorageEvent) => {
      const known = (!e || e.key === CACHE_PREFIX + key) && cache.get(key);
      if (known) done(fromEntry(known));
    };
    // Offline the notch gives up on a song it has not cached and says so: the bar says it too, and waits again once back online.
    const net = () => {
      if (!cache.get(key)) done({ kind: navigator.onLine ? "loading" : "offline" });
    };
    read();
    if (!navigator.onLine) net();
    window.addEventListener("storage", read);
    window.addEventListener("online", net);
    window.addEventListener("offline", net);
    return () => {
      window.removeEventListener("storage", read);
      window.removeEventListener("online", net);
      window.removeEventListener("offline", net);
    };
  }
  let alive = true, retried = false, timer = 0;
  const again = () => {
    window.clearTimeout(timer);
    window.removeEventListener("online", again);
    if (alive) load();
  };
  const load = () =>
    void lyricsFor(key, np, order).then((l) => {
      if (!alive) return;
      done(l ?? { kind: "offline" });
      if (l || retried) return;
      retried = true;
      window.addEventListener("online", again);
      timer = window.setTimeout(again, OFFLINE_RETRY_MS);
    });
  load();
  return () => {
    alive = false;
    window.clearTimeout(timer);
    window.removeEventListener("online", again);
  };
}

/** Lyrics of the shown song while `enabled`; nothing is fetched otherwise. */
export function useLyrics(np: NowPlaying | null, enabled: boolean): LyricsState | null {
  const order = enabledSources(settings.use().music.lyricSources);
  const wanted = !!np && enabled && np.title.trim() !== "";
  const key = wanted ? lookupKey(np, order) : null;
  const [state, setState] = useState<{ key: string; value: LyricsState } | null>(null);
  useEffect(() => {
    if (!key || !np) return;
    setState({ key, value: { kind: "loading" } });
    return loadLyrics(key, np, order, (value) => setState({ key, value }));
  }, [key]);
  useEffect(() => {
    if (!key) return;
    count(true);
    return () => count(false);
  }, [!!key]);
  if (wanted && !order.length) return { kind: "nosource" };
  if (wanted && !key) return { kind: "skipped" };
  return key && state?.key === key ? state.value : key ? { kind: "loading" } : null;
}

/*
 * In the notch, for a bar's panel that shows Now playing with its lyrics open: the bar asks no source, so the notch loads the playing
 * song's lyrics as its own panel would, which fills the cache the bar reads, and counts the bar's lyrics as one more surface.
 */
let barSong: string | null = null;
let stopBar = () => {};

/** Runs on whatever can change the song a bar's lyrics need (the panel, the settings, the song) and acts only when that song changes. */
function followBar() {
  const np = media.get();
  const music = settings.get().music;
  const order = enabledSources(music.lyricSources);
  const key = barShows("media") && music.lyricsOpen ? lookupKey(np, order) : null;
  if (key === barSong) return;
  if (!key !== !barSong) count(!!key);
  barSong = key;
  stopBar();
  stopBar = np && key ? loadLyrics(key, np, order, () => {}) : () => {};
}

if (isNotchWindow) {
  onBarShows("media", followBar);
  settings.subscribe(followBar);
  media.subscribe(followBar);
}

/** The synced lines, if the state has them. */
export const linesOf = (l: LyricsState | null): LyricLine[] | null => (l?.kind === "synced" ? l.lines : null);

/**
 * Index of the line (or word, given a line's words) being sung, -1 before the first. Wakes once per line with a timeout,
 * never polls; paused it stays.
 */
export function useLyricIndex(lines: { time: number }[] | null | undefined, np: NowPlaying | null): number {
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

/**
 * Text of the current line, for the closed notch: in a short pause the line before it (closedIndex); null before the
 * first line, in a pause of SHORT_GAP or more, after the last line, or without lyrics. With `show.translation` the line
 * comes translated where its source has a translation, with `show.roman` in Latin letters where it has a
 * romanisation; otherwise as sung.
 */
export function useLyricLine(np: NowPlaying | null, enabled: boolean, show: { roman: boolean; translation: boolean } = { roman: false, translation: false }): string | null {
  const offline = settings.use().music.offlineTranslation === true;
  const translated = useOfflineTranslation(np, linesOf(useLyrics(np, enabled)), enabled && show.translation && offline);
  const lines = useRomanized(translated, enabled && show.roman);
  const i = useLyricIndex(lines, np);
  return closedLine(lines && i >= 0 ? lines[closedIndex(lines, i)] : null, show);
}

const CJK = /[ぁ-ゖァ-ヺ㐀-䶿一-鿿가-힣]/;

/** The lines with romanisation (from the source, else made in Rust for Japanese, Chinese and Korean) while `on`. */
/** Songs being translated, by cache key: the panel and the closed notch asking at once share one run. */
const translating = new Map<string, Promise<string | null>>();

/**
 * The lines translated on this computer into Crest's language while `on`, when the song's language has its models
 * downloaded (Settings, Music). The translation replaces the source's own, which is mostly in Chinese. Each song is
 * translated once: the answer is kept in the lyrics cache, and a run started is finished even if the lyrics close.
 */
export function useOfflineTranslation(np: NowPlaying | null, lines: LyricLine[] | null, on: boolean): LyricLine[] | null {
  const status = offlineStatus.use();
  const target = targetOf(settings.use().music.offlineTarget, lang());
  const [made, setMade] = useState<{ from: LyricLine[]; lines: LyricLine[] } | null>(null);
  useEffect(() => {
    if (!on || !np || !lines || !status.engine) return;
    const texts = lines.map((l) => l.text);
    const from = detectLanguage(texts);
    const pairs = from ? pairsFor(from, target) : [];
    if (pairs.length === 0 || !pairs.every((p) => hasPair(status, p))) return;
    const key = `offline:${target}\n${cacheKey(np.title, np.artist, np.duration)}`;
    const apply = (lrc: string | null) => lrc && setMade({ from: lines, lines: withExtra(lines.map(({ translation: _, ...l }) => l), lrc, "translation") });
    const known = cache.get(key);
    if (known) return void apply(known.translation ?? null);
    let alive = true;
    let run = translating.get(key);
    if (!run) {
      const filled = texts.map((t, i) => [t.trim(), i] as const).filter(([t]) => t);
      run = translateOffline(pairs, filled.map(([t]) => t))
        .then((out) => {
          const byLine: (string | null)[] = texts.map(() => null);
          filled.forEach(([, i], k) => (byLine[i] = out[k] || null));
          const lrc = translationLrc(lines, byLine);
          if (lrc) cache.set(key, { lrc: null, instrumental: false, translation: lrc, at: Date.now() });
          return lrc;
        })
        .catch(() => null)
        .finally(() => translating.delete(key));
      translating.set(key, run);
    }
    void run.then((lrc) => alive && apply(lrc));
    return () => {
      alive = false;
    };
  }, [lines, on, target, status]);
  return made?.from === lines ? made.lines : lines;
}

export function useRomanized(lines: LyricLine[] | null, on: boolean): LyricLine[] | null {
  const [made, setMade] = useState<{ from: LyricLine[]; lines: LyricLine[] } | null>(null);
  useEffect(() => {
    if (!on || !lines || !isNative || !lines.some((l) => !l.roman && CJK.test(l.text))) return;
    let alive = true;
    void invoke<string[]>("lyrics_romanize", { lines: lines.map((l) => l.text) })
      .then((r) => alive && setMade({ from: lines, lines: lines.map((l, i) => (l.roman || !r[i] || r[i] === l.text ? l : { ...l, roman: r[i] })) }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [lines, on]);
  return made?.from === lines ? made.lines : lines;
}
