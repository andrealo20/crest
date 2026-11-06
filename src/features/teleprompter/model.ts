// The Prompter's maths, kept free of the DOM and of storage so it can be tested on its own.

/** The longest script: what the field accepts and the store keeps. */
export const MAX_CHARS = 50_000;

/** Reading speed in words per minute, and the text size in px. */
export const WPM = { min: 60, max: 300, def: 140, step: 10 } as const;
export const SIZE = { min: 16, max: 72, def: 24, step: 2 } as const;

/** One frame never moves the text by more than this long a step, so a stalled window does not make it jump. */
const MAX_STEP_S = 0.1;

export interface PrompterState {
  text: string;
  wpm: number;
  size: number;
  mirror: boolean;
}

export const PROMPTER_DEFAULTS: PrompterState = { text: "", wpm: WPM.def, size: SIZE.def, mirror: false };

/** Cuts a script to the limit, without leaving half of an emoji at the end. */
export function clampText(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  const last = text.charCodeAt(MAX_CHARS - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? MAX_CHARS - 1 : MAX_CHARS);
}

const clampNumber = (v: unknown, min: number, max: number, def: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def);

/** Whatever was stored (older or damaged data included) as a valid state. */
export function normalizePrompter(raw: unknown): PrompterState {
  const s = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<Record<keyof PrompterState, unknown>>;
  return {
    text: typeof s.text === "string" ? clampText(s.text) : PROMPTER_DEFAULTS.text,
    wpm: clampNumber(s.wpm, WPM.min, WPM.max, WPM.def),
    size: clampNumber(s.size, SIZE.min, SIZE.max, SIZE.def),
    mirror: s.mirror === true,
  };
}

/** The speed one step up (+1) or down (-1), kept within its range. */
export const stepWpm = (wpm: number, dir: 1 | -1) => clampNumber(wpm + dir * WPM.step, WPM.min, WPM.max, WPM.def);

// Han, Hiragana and Katakana (with the long-vowel mark) have no spaces between words.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]/gu;
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
/** Two such characters count as one word: about how fast Chinese and Japanese are read aloud at the same words-per-minute. */
const CJK_PER_WORD = 2;

/** Words in a script: runs of letters and digits, plus the Han and kana characters of mixed text (Hangul is spaced like Latin). */
export function countWords(text: string): number {
  let cjk = 0;
  const rest = text.replace(CJK, () => {
    cjk++;
    return " ";
  });
  return (rest.match(WORD)?.length ?? 0) + Math.ceil(cjk / CJK_PER_WORD);
}

/**
 * Words per minute as px per second for the text as laid out: `textHeight` is the height of the whole script at the
 * current size and width, so size, width, line breaks and any script are already in it. 0 when there is nothing to read.
 */
export function pxPerSecond(wpm: number, words: number, textHeight: number): number {
  if (!(words > 0) || !(textHeight > 0)) return 0;
  return ((wpm / 60) * textHeight) / words;
}

/** Where the text stands after `dt` seconds at `speed` px per second, between 0 and `max`. */
export function advance(pos: number, dt: number, speed: number, max: number): number {
  return clamp(pos + speed * Math.min(Math.max(dt, 0), MAX_STEP_S), max);
}

export function clamp(pos: number, max: number): number {
  return Math.min(Math.max(max, 0), Math.max(0, Number.isFinite(pos) ? pos : 0));
}

/** How far into the script, 0 to 1. */
export const progress = (pos: number, max: number) => (max > 0 ? clamp(pos, max) / max : 0);

/** Seconds left at the current speed; 0 when it cannot move. */
export function remainingSeconds(pos: number, max: number, speed: number): number {
  return speed > 0 ? Math.max(0, max - pos) / speed : 0;
}

/** 2:05, or 1:02:05 from an hour; rounded up so it never shows 0:00 while something is left. */
export function formatClock(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}
