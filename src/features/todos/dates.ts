// Dates in plain words for the new-task field ("call Marco tomorrow 9am", "venerdì alle 17"), English and Italian.
// Pure: the clock is a parameter and every day is built from calendar fields, never by adding 24 h of milliseconds,
// so month ends, leap years and DST changes behave. The parser would rather miss a date than guess: a miss costs
// typing it again, a wrong guess is a task due at the wrong time. The word lists below are the only place a
// language is added.
//
// The rules (all covered by dates.test.ts):
// - A day without a time is due at 09:00. "tonight", "stasera" and an evening are 20:00, an afternoon 15:00.
// - A time without a day is the next one that comes, today while it is ahead, else tomorrow (like an alarm clock).
// - A bare hour ("at 9", "alle 9") is read on the 24 h clock, unless a day part says otherwise ("tonight at 9" = 21:00).
// - "friday" and "this friday" are the next one (today counts while its time is ahead). "next friday" is the one
//   in the following Monday to Sunday week.
// - Not proposed: today with its time already gone, a date with a year that is past, a date that does not exist
//   ("31 apr"). A date without a year that went by more than a week ago means next year; one from the last
//   week is more likely a past event than next year's, so it is left alone.
// - Only the first phrase in the text counts.

import { dayDiff, defaultDay, dueAt } from "./schedule.ts";

export interface ParsedDate {
  /** The text without the phrase ("call Marco"); the whole text when nothing else would be left. */
  title: string;
  /** When it is due: a local timestamp, like `Task.due`. */
  due: number;
  /** What was recognised, as typed, with its "on" or "alle" ("on friday"): `text.slice(start, end)`. */
  phrase: string;
  start: number;
  end: number;
}

type Part = "morning" | "afternoon" | "evening";
type DateSpec =
  | { k: "days"; n: number; part?: Part } // today = 0, tomorrow = 1, "in 3 days"
  | { k: "wd"; wd: number; next: boolean }
  | { k: "cal"; d: number; mo: number; y?: number }
  | { k: "eom" }
  | { k: "in"; ms: number }; // "in 2 hours": an instant, no time of day follows
interface TimeSpec {
  /** Null for a day part alone ("tomorrow evening"). */
  h: number | null;
  m: number;
  /** am/pm was written, so the hour is final. */
  mer: boolean;
  /** Just an hour ("at 9"). */
  bare: boolean;
  /** "noon", "midnight". */
  word: boolean;
  /** Had "at", "alle" or similar in front. */
  lead: boolean;
  part?: Part;
}
interface Tok {
  /** Lowercase, no accents. */
  w: string;
  start: number;
  end: number;
  /** Leading number of "9", "17:30", "9.30pm", "2nd", and what follows it. */
  num: string | null;
  sfx: string;
  /** Only spaces, commas and the like between this token and the one before. */
  joined: boolean;
  comma: boolean;
}
interface Hit<T> {
  v: T;
  /** One past the last token. */
  to: number;
  /** An everyday word that is also a date ("sat"): only valid with a time that is clearly one. */
  weak?: boolean;
}

const DEFAULT_HOUR = 9;
const PART_HOUR: Record<Part, number> = { morning: 9, afternoon: 15, evening: 20 };
/** A date without a year that went by this many days ago or fewer is not moved to next year. */
const RECENT_DAYS = 7;

// Maps, not objects: a typed word like "constructor" must not find anything.
const lex = <T>(o: Record<string, T>): ReadonlyMap<string, T> => new Map(Object.entries(o));
const words = (...list: string[]): ReadonlySet<string> => new Set(list);

const WEEKDAYS = lex({ sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, domenica: 0, lunedi: 1, martedi: 2, mercoledi: 3, giovedi: 4, venerdi: 5, sabato: 6 });
const SHORT_WEEKDAYS = lex({ sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 });
// "set" and "ago" are left out of the Italian short forms: they are English words too.
const MONTHS = lex({
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
  gennaio: 1, gen: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, mag: 5, giugno: 6, giu: 6, luglio: 7, lug: 7, agosto: 8,
  settembre: 9, ottobre: 10, ott: 10, novembre: 11, dicembre: 12, dic: 12,
});
const DAY_WORDS = lex<{ n: number; part?: Part }>({
  today: { n: 0 }, tomorrow: { n: 1 }, tonight: { n: 0, part: "evening" },
  oggi: { n: 0 }, domani: { n: 1 }, dopodomani: { n: 2 }, stasera: { n: 0, part: "evening" }, stamattina: { n: 0, part: "morning" }, domattina: { n: 1, part: "morning" },
});
const PARTS = lex<Part>({ morning: "morning", afternoon: "afternoon", evening: "evening", night: "evening", mattina: "morning", mattino: "morning", pomeriggio: "afternoon", sera: "evening" });
/** The interface languages whose words the parser knows; in the others "le 12" or "mar 5" would be misread, so it stays off. */
export const DATE_LANGUAGES: readonly string[] = ["en", "it"];

const WORD_TIMES = lex({ noon: 12, midday: 12, mezzogiorno: 12, midnight: 0, mezzanotte: 0, "all'una": 1 });
const MERIDIEM = lex({ am: 0, pm: 1, "a.m": 0, "a.m.": 0, "p.m": 1, "p.m.": 1 });
const NEXT = words("next", "prossimo", "prossima");
const THIS = words("this", "questo", "questa");
const TRAIL_NEXT = words("prossimo", "prossima"); // "lunedì prossimo"
const OF = words("of", "di", "del");
const ORDINAL = words("", "st", "nd", "rd", "th");
const DAY_AFTER = ["day", "after", "tomorrow"];
const MONTH_END = [["end", "of", "the", "month"], ["end", "of", "month"], ["fine", "del", "mese"], ["fine", "mese"], ["alla", "fine", "del", "mese"], ["a", "fine", "mese"]];
// In front of a date or a time, and part of the recognised phrase. The cues also allow a bare hour ("at 9").
const LEADS = words("on", "at", "by", "before", "until", "till", "due", "for", "the", "il", "entro", "per", "alle", "ore", "le");
const CUES = words("at", "alle", "ore", "le");
const FILLERS = words("the", "le");

// "in 2 hours", "tra 10 minuti".
const DURATION_LEADS = words("in", "tra", "fra");
const AND = words("and", "e");
const UNITS = lex<{ ms?: number; days?: number }>({
  minute: { ms: 60_000 }, minutes: { ms: 60_000 }, min: { ms: 60_000 }, mins: { ms: 60_000 }, minuto: { ms: 60_000 }, minuti: { ms: 60_000 },
  hour: { ms: 3_600_000 }, hours: { ms: 3_600_000 }, hr: { ms: 3_600_000 }, hrs: { ms: 3_600_000 }, h: { ms: 3_600_000 }, ora: { ms: 3_600_000 }, ore: { ms: 3_600_000 },
  day: { days: 1 }, days: { days: 1 }, giorno: { days: 1 }, giorni: { days: 1 },
  week: { days: 7 }, weeks: { days: 7 }, settimana: { days: 7 }, settimane: { days: 7 },
});
const NUMBER_WORDS = lex({
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30,
  un: 1, uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, dodici: 12, quindici: 15, venti: 20, trenta: 30,
});
const SPECIAL_DURATIONS: [string[], number][] = [[["half", "an", "hour"], 1_800_000], [["half", "hour"], 1_800_000], [["mezz'ora"], 1_800_000], [["mezzora"], 1_800_000], [["un'ora"], 3_600_000]];

// a.m. and p.m. are one token; then words (with an apostrophe inside); then numbers with their suffix.
const TOKEN = /[ap]\.m\.?(?!\p{L})|\d+(?:[:.]\d+)?\p{L}*|\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*/giu;
const GAP = /^[\s,@°'’]+$/;
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/’/g, "'");

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  let prev = 0;
  for (const m of text.matchAll(TOKEN)) {
    const gap = text.slice(prev, m.index);
    const w = norm(m[0]);
    const n = /^(\d+(?:[:.]\d+)?)(\p{L}*)$/u.exec(w);
    out.push({ w, start: m.index, end: m.index + m[0].length, num: n?.[1] ?? null, sfx: n?.[2] ?? "", joined: out.length > 0 && GAP.test(gap), comma: gap.includes(",") });
    prev = m.index + m[0].length;
  }
  return out;
}

// Every reader looks at the tokens from `i`. `free` = it starts the phrase, so the token needs no link to the one before.
const linked = (ts: Tok[], i: number, free: boolean) => free || !!ts[i]?.joined;
/** Do the tokens from `p` spell `seq`, one gap apart? */
const spells = (ts: Tok[], p: number, seq: string[]) => seq.every((w, k) => ts[p + k]?.w === w && (k === 0 || ts[p + k].joined));
/** The last token of a clause: the end of the text, or a comma or other break follows. */
const clauseEnd = (ts: Tok[], k: number) => k === ts.length - 1 || ts[k + 1].comma || !ts[k + 1].joined;

function readLeads(ts: Tok[], i: number, free: boolean) {
  let p = i, cue = false, prep = false;
  while (p < ts.length && p - i < 3 && LEADS.has(ts[p].w) && linked(ts, p, free && p === i)) {
    cue ||= CUES.has(ts[p].w);
    prep ||= !FILLERS.has(ts[p].w);
    p++;
  }
  return { to: p, cue, prep };
}

const dayNumber = (t?: Tok) => {
  const n = t?.num && /^\d{1,2}$/.test(t.num) && ORDINAL.has(t.sfx) ? Number(t.num) : 0;
  return n >= 1 && n <= 31 ? n : 0;
};
const yearAt = (t?: Tok) => (t?.joined && t.num && /^20\d\d$/.test(t.num) && !t.sfx ? Number(t.num) : undefined);

function readDate(ts: Tok[], i: number, free: boolean): Hit<DateSpec> | null {
  const L = readLeads(ts, i, free);
  const p = L.to;
  const k = ts[p];
  if (!k || !linked(ts, p, free && p === i)) return null;
  const hit = (v: DateSpec, to: number, weak = false): Hit<DateSpec> => ({ v, to, weak });

  for (const seq of MONTH_END) if (spells(ts, p, seq)) return hit({ k: "eom" }, p + seq.length);
  if (spells(ts, p, DAY_AFTER)) return hit({ k: "days", n: 2 }, p + DAY_AFTER.length);
  const dw = DAY_WORDS.get(k.w);
  if (dw) return hit({ k: "days", ...dw }, p + 1);

  // "this evening", "next friday", "venerdì prossimo".
  const mod = NEXT.has(k.w) ? "next" : THIS.has(k.w) ? "this" : null;
  const q = mod ? p + 1 : p;
  const n = ts[q];
  if (n && (q === p || n.joined)) {
    const part = mod === "this" ? PARTS.get(n.w) : undefined;
    if (part) return hit({ k: "days", n: 0, part }, q + 1);
    const full = WEEKDAYS.get(n.w);
    const wd = full ?? SHORT_WEEKDAYS.get(n.w);
    if (wd !== undefined) {
      const trail = !mod && ts[q + 1]?.joined && TRAIL_NEXT.has(ts[q + 1].w);
      return hit({ k: "wd", wd, next: mod === "next" || !!trail }, q + (trail ? 2 : 1), full === undefined && !mod && !L.prep);
    }
  }

  // "3 dec", "3rd of december", "il 3 dicembre 2027".
  let d = dayNumber(k), r = p + 1;
  if (d && ts[r]?.joined && OF.has(ts[r].w)) r++;
  const mo = d && ts[r]?.joined ? MONTHS.get(ts[r].w) : undefined;
  if (d && mo) {
    const y = yearAt(ts[r + 1]);
    return hit({ k: "cal", d, mo, y }, r + (y ? 2 : 1));
  }
  // "dec 3", "december 3rd 2027".
  // Not when another month follows: in "mar 5 dic" the 5 belongs to dic.
  const mo2 = MONTHS.get(k.w);
  d = dayNumber(ts[p + 1]);
  if (mo2 && d && ts[p + 1].joined && !(ts[p + 2]?.joined && MONTHS.has(ts[p + 2].w))) {
    const y = yearAt(ts[p + 2]);
    return hit({ k: "cal", d, mo: mo2, y }, p + (y ? 3 : 2));
  }
  return null;
}

/** "2 hours", "2h", "an hour", "half an hour": minutes or hours as `ms`, days or weeks as `days`. */
function readAmount(ts: Tok[], q: number): { ms?: number; days?: number; to: number } | null {
  const k = ts[q];
  if (!k?.joined) return null;
  for (const [seq, ms] of SPECIAL_DURATIONS) if (spells(ts, q, seq)) return { ms, to: q + seq.length };
  const n = k.num && /^\d+$/.test(k.num) ? Number(k.num) : NUMBER_WORDS.get(k.w);
  if (!n || n > 999) return null;
  const inline = !!k.num && !!k.sfx; // "2h"
  const u = UNITS.get(inline ? k.sfx : ts[q + 1]?.joined ? ts[q + 1].w : "");
  if (!u) return null;
  return { ms: u.ms && n * u.ms, days: u.days && n * u.days, to: q + (inline ? 1 : 2) };
}

/** "in 2 hours", "in 1 hour 30 minutes", "tra 3 giorni". */
function readDuration(ts: Tok[], i: number): Hit<DateSpec> | null {
  if (!DURATION_LEADS.has(ts[i].w)) return null;
  const a = readAmount(ts, i + 1);
  if (!a) return null;
  if (a.days) return { v: { k: "days", n: a.days }, to: a.to };
  let ms = a.ms!, to = a.to;
  for (;;) {
    const q = ts[to]?.joined && AND.has(ts[to].w) ? to + 1 : to;
    const more = readAmount(ts, q);
    if (!more?.ms) break;
    ms += more.ms;
    to = more.to;
  }
  return { v: { k: "in", ms }, to };
}

/** "9:30", "5pm", "9 am", and with "at" or "alle" also a bare hour or "9.30". */
function readClock(ts: Tok[], p: number, free: boolean, cue: boolean): Hit<TimeSpec> | null {
  const k = ts[p];
  if (!k?.num || !linked(ts, p, free)) return null;
  const [hs, ms] = k.num.split(/[:.]/);
  if (hs.length > 2 || (ms !== undefined && ms.length !== 2)) return null;
  let h = Number(hs), to = p + 1;
  const m = ms === undefined ? 0 : Number(ms);
  let mer = k.sfx ? MERIDIEM.get(k.sfx) : undefined;
  if (k.sfx && mer === undefined) return null;
  if (!k.sfx && ts[p + 1]?.joined) {
    mer = MERIDIEM.get(ts[p + 1].w);
    if (mer !== undefined) to = p + 2;
  }
  if (m > 59) return null;
  if (mer !== undefined) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + 12 * mer;
  } else {
    if (h > 23) return null;
    // "9" and "9.30" are numbers; "9:30" is a time.
    if (!cue && (ms === undefined || k.num.includes("."))) return null;
  }
  return { v: { h, m, mer: mer !== undefined, bare: mer === undefined && ms === undefined, word: false, lead: cue }, to };
}

/** A time of day. After a date (`free` false) it can also be a day part, alone or with an hour: "evening", "evening at 7". */
function readTime(ts: Tok[], i: number, free: boolean): Hit<TimeSpec> | null {
  let p = i;
  let part: Part | undefined;
  if (!free && linked(ts, p, false)) {
    part = ts[p] && PARTS.get(ts[p].w);
    if (part) p++;
  }
  const L = readLeads(ts, p, free && p === i);
  const at = L.to;
  const c = readClock(ts, at, free && at === i, L.cue);
  if (c) return { v: { ...c.v, part, lead: L.prep || L.cue }, to: c.to };
  const wh = ts[at] && linked(ts, at, free && at === i) ? WORD_TIMES.get(ts[at].w) : undefined;
  if (wh !== undefined) return { v: { h: wh, m: 0, mer: true, bare: false, word: true, lead: L.prep || L.cue || ts[at].w === "all'una", part }, to: at + 1 };
  if (part) return { v: { h: null, m: 0, mer: false, bare: false, word: false, lead: false, part }, to: p };
  return null;
}

interface Phrase { date: DateSpec | null; time: TimeSpec | null; to: number }

function phraseAt(ts: Tok[], i: number): Phrase | null {
  const dur = readDuration(ts, i);
  if (dur?.v.k === "in") return { date: dur.v, time: null, to: dur.to };
  const d = dur ?? readDate(ts, i, true);
  if (d) {
    const t = readTime(ts, d.to, false);
    if (d.weak && !(t && !t.v.bare)) return null;
    return { date: d.v, time: t?.v ?? null, to: t?.to ?? d.to };
  }
  const t = readTime(ts, i, true);
  if (!t) return null;
  const d2 = readDate(ts, t.to, false);
  if (d2 && !(d2.weak && t.v.bare)) return { date: d2.v, time: t.v, to: d2.to };
  // A time alone must be sure: "look at 5 candidates" is not 5 o'clock.
  if ((t.v.word && !t.v.lead) || (t.v.bare && !clauseEnd(ts, t.to - 1))) return null;
  return { date: null, time: t.v, to: t.to };
}

const atDate = (y: number, mo: number, d: number, h: number, m: number): number | null => {
  const t = new Date(y, mo - 1, d, h, m);
  return t.getMonth() === mo - 1 && t.getDate() === d ? t.getTime() : null; // 31 apr rolls over to 1 may: not a date
};

/** The moment, or null when it is not one to propose (see the rules at the top). */
function resolve(date: DateSpec | null, time: TimeSpec | null, now: number): number | null {
  if (date?.k === "in") return Math.round((now + date.ms) / 60_000) * 60_000;
  const part = time?.part ?? (date?.k === "days" ? date.part : undefined);
  let h = DEFAULT_HOUR, m = 0;
  if (time && time.h !== null) {
    h = time.h;
    m = time.m;
    if (!time.mer && h >= 1 && h <= 11 && (part === "afternoon" || part === "evening")) h += 12;
    // A bare early hour is the afternoon one: "call mum at 5" is 17:00, not 05:00. "at 05:00" or "5am" stays early.
    else if (time.bare && !part && h >= 1 && h <= 7) h += 12;
  } else if (part) h = PART_HOUR[part];
  if (!date) return dueAt(now, defaultDay(now, h, m), h, m);

  const future = (t: number | null) => (t !== null && t > now ? t : null);
  const today = new Date(now);
  switch (date.k) {
    case "days":
      return future(dueAt(now, date.n, h, m));
    case "wd": {
      const monday = (x: number) => (x + 6) % 7;
      let off = date.next ? 7 - monday(today.getDay()) + monday(date.wd) : (date.wd - today.getDay() + 7) % 7;
      if (off === 0 && dueAt(now, 0, h, m) <= now) off = 7;
      return dueAt(now, off, h, m);
    }
    case "cal": {
      if (date.y) return future(atDate(date.y, date.mo, date.d, h, m));
      const y = today.getFullYear();
      const cur = atDate(y, date.mo, date.d, h, m);
      // Within the last week, this year's or last year's: a past event, not next year's.
      const recent = (t: number | null) => t !== null && t <= now && dayDiff(now, t) >= -RECENT_DAYS;
      if (recent(cur) || recent(atDate(y - 1, date.mo, date.d, h, m))) return null;
      if (cur !== null && cur > now) return cur;
      return atDate(y + 1, date.mo, date.d, h, m); // null when it does not exist next year either (29 feb)
    }
    case "eom": {
      for (let k = 0; k < 2; k++) {
        const last = new Date(today.getFullYear(), today.getMonth() + k + 1, 0);
        const t = future(new Date(last.getFullYear(), last.getMonth(), last.getDate(), h, m).getTime());
        if (t !== null) return t;
      }
      return null;
    }
    default:
      return null;
  }
}

/** Is [start, end) stuck to what is around it: "tomorrow-ish", "fri_notes.txt", "#friday", "3pm-4pm", "friday.txt"? */
function glued(text: string, start: number, end: number): boolean {
  const word = /[\p{L}\p{N}_\-/\\#]/u;
  const before = text[start - 1], after = text[end];
  if (before !== undefined && (word.test(before) || (before === "." && word.test(text[start - 2] ?? "")))) return true;
  return after !== undefined && (word.test(after) || (after === "." && word.test(text[end + 1] ?? "")));
}

/** The text with [start, end) cut out and the seams tidied. */
function cut(text: string, start: number, end: number, due: number): ParsedDate {
  const title = `${text.slice(0, start)} ${text.slice(end)}`
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/\s+/g, " ")
    .replace(/ ([,;])/g, "$1")
    .replace(/^[\s,;:@-]+|[\s,;:@-]+$/g, "");
  return { title: title || text.trim(), due, phrase: text.slice(start, end), start, end };
}

/** The first date or time in `text` ("call Marco tomorrow 9am"), or null. `now` is a timestamp. */
export function parseDate(text: string, now: number): ParsedDate | null {
  const ts = tokenize(text);
  for (let i = 0; i < ts.length; ) {
    const hit = phraseAt(ts, i);
    if (!hit) {
      i++;
      continue;
    }
    const start = ts[i].start, end = ts[hit.to - 1].end;
    const due = glued(text, start, end) ? null : resolve(hit.date, hit.time, now);
    if (due !== null) return cut(text, start, end, due);
    // Understood but not one to propose ("today 9am" at 3 pm): skip it whole, so its time is not read on its own.
    i = hit.to;
  }
  return null;
}
