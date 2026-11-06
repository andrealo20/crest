import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDate } from "./dates.ts";

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const fmt = (ts: number | undefined) => (ts === undefined ? "none" : new Date(ts).toString());
/** Wednesday 4 November 2026, 10:30. */
const NOW = at(2026, 11, 4, 10, 30);

/** The due time of `text`, or undefined when nothing is proposed. */
const due = (text: string, now = NOW) => parseDate(text, now)?.due;
const title = (text: string, now = NOW) => parseDate(text, now)?.title;

/** [text, expected due] rows against one clock. */
function table(rows: [string, number][], now = NOW) {
  for (const [text, want] of rows) assert.equal(due(text, now), want, `${text}: got ${fmt(due(text, now))}, want ${fmt(want)}`);
}
function none(texts: string[], now = NOW) {
  for (const text of texts) assert.equal(parseDate(text, now), null, `${text}: got ${fmt(due(text, now))}`);
}

test("the clock used below is a Wednesday", () => {
  assert.equal(new Date(NOW).getDay(), 3);
});

test("English examples: phrase, due time and the title left behind", () => {
  const rows: [string, number, string][] = [
    ["call Marco tomorrow 9am", at(2026, 11, 5, 9), "call Marco"],
    ["pay rent on friday", at(2026, 11, 6, 9), "pay rent"],
    ["send report in 2 hours", at(2026, 11, 4, 12, 30), "send report"],
    ["gym tonight", at(2026, 11, 4, 20), "gym"],
    ["dentist next monday at 5pm", at(2026, 11, 9, 17), "dentist"],
    ["book flights 2 Dec", at(2026, 12, 2, 9), "book flights"],
  ];
  for (const [text, want, left] of rows) {
    const r = parseDate(text, NOW);
    assert.equal(r?.due, want, `${text}: got ${fmt(r?.due)}`);
    assert.equal(r?.title, left, text);
  }
});

test("Italian examples", () => {
  const rows: [string, number, string][] = [
    ["chiama Marco domani alle 9", at(2026, 11, 5, 9), "chiama Marco"],
    ["dopodomani", at(2026, 11, 6, 9), "dopodomani"],
    ["tra 2 ore", at(2026, 11, 4, 12, 30), "tra 2 ore"],
    ["venerdì alle 17", at(2026, 11, 6, 17), "venerdì alle 17"],
    ["lunedì prossimo", at(2026, 11, 9, 9), "lunedì prossimo"],
    ["stasera", at(2026, 11, 4, 20), "stasera"],
    ["il 3 dicembre", at(2026, 12, 3, 9), "il 3 dicembre"],
    ["pagare l'affitto il 3 dicembre", at(2026, 12, 3, 9), "pagare l'affitto"],
    ["palestra stasera", at(2026, 11, 4, 20), "palestra"],
    ["inviare il report tra 2 ore", at(2026, 11, 4, 12, 30), "inviare il report"],
  ];
  for (const [text, want, left] of rows) {
    const r = parseDate(text, NOW);
    assert.equal(r?.due, want, `${text}: got ${fmt(r?.due)}`);
    assert.equal(r?.title, left, text);
  }
});

test("the phrase and its position point into the original text", () => {
  const r = parseDate("pay rent on friday", NOW)!;
  assert.equal(r.phrase, "on friday");
  assert.equal("pay rent on friday".slice(r.start, r.end), "on friday");
  const s = "Chiama Marco  VENERDÌ alle ore 17:30 per il report";
  const i = parseDate(s, NOW)!;
  assert.equal(i.phrase, "VENERDÌ alle ore 17:30");
  assert.equal(s.slice(i.start, i.end), i.phrase);
  assert.equal(i.title, "Chiama Marco per il report");
  assert.equal(i.due, at(2026, 11, 6, 17, 30));
  // Accents typed as base letter plus combining mark shift nothing.
  const d = "call venerdì 5pm";
  const dr = parseDate(d, NOW)!;
  assert.equal(d.slice(dr.start, dr.end), "venerdì 5pm");
  assert.equal(dr.due, at(2026, 11, 6, 17));
});

test("weekdays: today, this, next, for every day of a week", () => {
  // Rows: today's day of November 2026 (Mon 2 to Sun 8), then the day of the month each phrase lands on.
  const rows: [number, Record<string, number>][] = [
    [2, { friday: 6, "next friday": 13, monday: 9, "next monday": 9, sunday: 8, "next sunday": 15 }],
    [3, { friday: 6, "next friday": 13, monday: 9, "next monday": 9, sunday: 8, "next sunday": 15 }],
    [4, { friday: 6, "next friday": 13, monday: 9, "next monday": 9, sunday: 8, "next sunday": 15 }],
    [5, { friday: 6, "next friday": 13, monday: 9, "next monday": 9, sunday: 8, "next sunday": 15 }],
    [6, { friday: 13, "next friday": 13, monday: 9, "next monday": 9, sunday: 8, "next sunday": 15 }],
    [7, { friday: 13, "next friday": 13, monday: 9, "next monday": 9, sunday: 8, "next sunday": 15 }],
    [8, { friday: 13, "next friday": 13, monday: 9, "next monday": 9, sunday: 15, "next sunday": 15 }],
  ];
  for (const [day, expect] of rows) {
    const now = at(2026, 11, day, 10, 30);
    for (const [phrase, d] of Object.entries(expect)) assert.equal(due(phrase, now), at(2026, 11, d, 9), `${phrase} on Nov ${day}: got ${fmt(due(phrase, now))}`);
  }
});

test("a weekday that is today counts while its time is ahead", () => {
  const fri = at(2026, 11, 6, 10, 30);
  assert.equal(due("friday 5pm", fri), at(2026, 11, 6, 17));
  assert.equal(due("this friday at 11:00", fri), at(2026, 11, 6, 11));
  assert.equal(due("friday 10:30", fri), at(2026, 11, 13, 10, 30), "the very minute is gone");
  assert.equal(due("friday 9am", fri), at(2026, 11, 13, 9));
  assert.equal(due("this monday", fri), at(2026, 11, 9, 9), "this monday from a Friday is the coming one");
  assert.equal(due("next friday 5pm", fri), at(2026, 11, 13, 17));
});

test("weekdays in Italian, with and without accents, and the modifiers around them", () => {
  table([
    ["venerdì", at(2026, 11, 6, 9)],
    ["venerdi", at(2026, 11, 6, 9)],
    ["VENERDÌ", at(2026, 11, 6, 9)],
    ["il venerdì", at(2026, 11, 6, 9)],
    ["questo venerdì", at(2026, 11, 6, 9)],
    ["venerdì prossimo", at(2026, 11, 13, 9)],
    ["il prossimo lunedì", at(2026, 11, 9, 9)],
    ["prossimo venerdì alle 18", at(2026, 11, 13, 18)],
    ["sabato alle 10:30", at(2026, 11, 7, 10, 30)],
    ["domenica", at(2026, 11, 8, 9)],
    ["martedì", at(2026, 11, 10, 9)],
    ["mercoledì", at(2026, 11, 11, 9)],
    ["giovedì sera", at(2026, 11, 5, 20)],
    ["giovedì sera alle 7", at(2026, 11, 5, 19)],
  ]);
  table([
    ["Monday", at(2026, 11, 9, 9)],
    ["on tuesday", at(2026, 11, 10, 9)],
    ["thursday", at(2026, 11, 5, 9)],
    ["by saturday", at(2026, 11, 7, 9)],
    ["before sunday", at(2026, 11, 8, 9)],
    ["until friday", at(2026, 11, 6, 9)],
    ["due friday", at(2026, 11, 6, 9)],
    ["entro venerdì", at(2026, 11, 6, 9)],
  ]);
});

test("short weekday names need a word in front, or a real time after", () => {
  table([
    ["on sat", at(2026, 11, 7, 9)],
    ["by fri", at(2026, 11, 6, 9)],
    ["next mon", at(2026, 11, 9, 9)],
    ["this thu", at(2026, 11, 5, 9)],
    ["due sun", at(2026, 11, 8, 9)],
    ["sat 5pm", at(2026, 11, 7, 17)],
    ["fri 17:30", at(2026, 11, 6, 17, 30)],
  ]);
  none(["he sat down", "sat", "the sun is out", "they wed", "sun", "mon", "wed", "fri", "she sat 5 minutes", "sat 5"]);
});

test("clock times: 12 h, 24 h and the odd ones", () => {
  const day = (h: number, m = 0) => at(2026, 11, 5, h, m);
  table([
    ["tomorrow 9am", day(9)],
    ["tomorrow 9 am", day(9)],
    ["tomorrow 9AM", day(9)],
    ["tomorrow 9 a.m.", day(9)],
    ["tomorrow 9pm", day(21)],
    ["tomorrow 5 p.m.", day(17)],
    ["tomorrow 9:30pm", day(21, 30)],
    ["tomorrow 9.30 pm", day(21, 30)],
    ["tomorrow 12am", day(0)],
    ["tomorrow 12pm", day(12)],
    ["tomorrow 12:30am", day(0, 30)],
    ["tomorrow 12:30pm", day(12, 30)],
    ["tomorrow 17:30", day(17, 30)],
    ["tomorrow 5:30", day(5, 30)],
    ["tomorrow 0:15", day(0, 15)],
    ["tomorrow 23:59", day(23, 59)],
    ["tomorrow at 9", day(9)],
    ["tomorrow at 17", day(17)],
    ["tomorrow at 9.30", day(9, 30)],
    ["domani alle 17", day(17)],
    ["domani alle ore 9", day(9)],
    ["domani ore 17:30", day(17, 30)],
    ["domani alle 9.30", day(9, 30)],
    ["domani per le 17", day(17)],
    ["domani entro le 18", day(18)],
    ["domani 9am, then", day(9)],
    ["tomorrow, 9am", day(9)],
    ["tomorrow @ 9am", day(9)],
    ["tomorrow noon", day(12)],
    ["tomorrow at midnight", day(0)],
    ["domani a mezzogiorno", at(2026, 11, 5, 9)],
    ["domani alle mezzogiorno", day(12)],
    ["domani all'una", day(1)],
    ["tomorrow midday", day(12)],
  ]);
});

test("things that look like a time but are not", () => {
  // The date is still found; the invalid time stays in the title.
  for (const bad of ["25:00", "9:60", "13pm", "0am", "9:5", "123:00", "at 24"]) {
    const r = parseDate(`tomorrow ${bad}`, NOW);
    assert.equal(r?.due, at(2026, 11, 5, 9), bad);
    assert.equal(r?.title, bad, bad);
  }
  none(["version 1.30", "ratio 3:1", "page 12", "room 101", "buy 5 apples", "chapter 9.30", "9", "17", "9.30", "1:5"]);
});

test("a time alone is the next one that comes", () => {
  table([
    ["call Marco at 9am", at(2026, 11, 5, 9)],
    ["call Marco at 5pm", at(2026, 11, 4, 17)],
    ["at 17:30", at(2026, 11, 4, 17, 30)],
    ["17:30 call Marco", at(2026, 11, 4, 17, 30)],
    ["call Marco alle 9", at(2026, 11, 5, 9)],
    ["chiama Marco alle 17", at(2026, 11, 4, 17)],
    ["chiama alle 10:30", at(2026, 11, 5, 10, 30)],
    ["lunch at noon", at(2026, 11, 4, 12)],
    ["ring at midnight", at(2026, 11, 5, 0)],
    ["chiama alle mezzanotte", at(2026, 11, 5, 0)],
  ]);
  // Ahead today, else tomorrow, with the exact minute counting as gone.
  assert.equal(due("call at 10:30", NOW), at(2026, 11, 5, 10, 30));
  assert.equal(due("call at 10:31", NOW), at(2026, 11, 4, 10, 31));
  // "noon" and "midnight" alone are just words.
  none(["noon", "midnight", "mezzogiorno", "chiama a mezzanotte"]);
});

test("a bare hour alone only counts at the end of the sentence", () => {
  assert.equal(due("call Marco at 9", NOW), at(2026, 11, 5, 9));
  assert.equal(due("call Marco at 9, thanks", NOW), at(2026, 11, 5, 9));
  assert.equal(due("chiama Marco alle 9.", NOW), at(2026, 11, 5, 9));
  none(["look at 5 candidates", "at 9 call Marco", "alle 9 chiama Marco", "meet at 6 sharp", "by 5", "per 9 persone"]);
  // With a day in the text it is clearly a time.
  assert.equal(due("tomorrow at 9 call Marco", NOW), at(2026, 11, 5, 9));
  assert.equal(title("tomorrow at 9 call Marco"), "call Marco");
  // A bare early hour is the afternoon one; with minutes or am it stays early.
  assert.equal(due("at 5 tomorrow", NOW), at(2026, 11, 5, 17));
  assert.equal(due("call mum at 5", NOW), at(2026, 11, 4, 17));
  assert.equal(due("meeting at 3 on friday", NOW), at(2026, 11, 6, 15));
  assert.equal(due("at 5am tomorrow", NOW), at(2026, 11, 5, 5));
  assert.equal(due("at 05:00 tomorrow", NOW), at(2026, 11, 5, 5));
  assert.equal(due("tomorrow at 8", NOW), at(2026, 11, 5, 8));
});

test("tonight, evening, afternoon, morning", () => {
  table([
    ["tonight", at(2026, 11, 4, 20)],
    ["Tonight", at(2026, 11, 4, 20)],
    ["tonight at 9", at(2026, 11, 4, 21)],
    ["tonight at 9pm", at(2026, 11, 4, 21)],
    ["tonight 8:30", at(2026, 11, 4, 20, 30)],
    ["tonight at 11", at(2026, 11, 4, 23)],
    ["tonight at 21:15", at(2026, 11, 4, 21, 15)],
    ["this evening", at(2026, 11, 4, 20)],
    ["this evening at 7", at(2026, 11, 4, 19)],
    ["this afternoon", at(2026, 11, 4, 15)],
    ["today afternoon at 5", at(2026, 11, 4, 17)],
    ["tomorrow morning", at(2026, 11, 5, 9)],
    ["tomorrow morning at 6", at(2026, 11, 5, 6)],
    ["tomorrow afternoon", at(2026, 11, 5, 15)],
    ["tomorrow afternoon at 3", at(2026, 11, 5, 15)],
    ["tomorrow evening", at(2026, 11, 5, 20)],
    ["tomorrow evening at 7", at(2026, 11, 5, 19)],
    ["tomorrow evening 7:30", at(2026, 11, 5, 19, 30)],
    ["tomorrow night", at(2026, 11, 5, 20)],
    ["friday evening", at(2026, 11, 6, 20)],
    ["stasera", at(2026, 11, 4, 20)],
    ["stasera alle 9", at(2026, 11, 4, 21)],
    ["stasera alle 21:30", at(2026, 11, 4, 21, 30)],
    ["questa sera", at(2026, 11, 4, 20)],
    ["questo pomeriggio", at(2026, 11, 4, 15)],
    ["domattina", at(2026, 11, 5, 9)],
    ["domani mattina alle 8", at(2026, 11, 5, 8)],
    ["domani pomeriggio alle 3", at(2026, 11, 5, 15)],
    ["domani sera", at(2026, 11, 5, 20)],
    ["domani sera alle 9", at(2026, 11, 5, 21)],
    ["oggi pomeriggio alle 5", at(2026, 11, 4, 17)],
    ["dopodomani sera", at(2026, 11, 6, 20)],
  ]);
  // A part of today that has gone by is not proposed.
  none(["stamattina", "this morning"], NOW);
  assert.equal(due("tonight", at(2026, 11, 4, 19, 59)), at(2026, 11, 4, 20));
  none(["tonight", "stasera"], at(2026, 11, 4, 20, 0));
  none(["tonight", "stasera"], at(2026, 11, 4, 23, 30));
});

test("today and tomorrow with the default time", () => {
  const early = at(2026, 11, 4, 7, 0);
  assert.equal(due("today", early), at(2026, 11, 4, 9));
  assert.equal(due("oggi", early), at(2026, 11, 4, 9));
  none(["today", "oggi"], NOW);
  assert.equal(due("today 5pm", NOW), at(2026, 11, 4, 17));
  none(["today 9am"], NOW);
  assert.equal(due("tomorrow", NOW), at(2026, 11, 5, 9));
  assert.equal(due("the day after tomorrow", NOW), at(2026, 11, 6, 9));
  assert.equal(title("meet the day after tomorrow"), "meet");
  assert.equal(due("day after tomorrow 4pm", NOW), at(2026, 11, 6, 16));
});

test("midnight: the day changes under the clock", () => {
  const lastMinute = at(2026, 12, 31, 23, 59);
  table(
    [
      ["tomorrow", at(2027, 1, 1, 9)],
      ["dopodomani", at(2027, 1, 2, 9)],
      ["9am", at(2027, 1, 1, 9)],
      ["call at 23:59", at(2027, 1, 1, 23, 59)],
      ["friday", at(2027, 1, 1, 9)], // 1 Jan 2027 is a Friday
      ["next friday", at(2027, 1, 8, 9)],
      ["in 2 minutes", at(2027, 1, 1, 0, 1)],
      ["in an hour", at(2027, 1, 1, 0, 59)],
      ["at midnight", at(2027, 1, 1, 0, 0)],
      ["1 jan", at(2027, 1, 1, 9)],
    ],
    lastMinute,
  );
  none(["tonight", "today", "stasera"], lastMinute);
  const justAfter = at(2027, 1, 1, 0, 0);
  assert.equal(due("tomorrow", justAfter), at(2027, 1, 2, 9));
  assert.equal(due("today", justAfter), at(2027, 1, 1, 9));
  assert.equal(due("tonight", justAfter), at(2027, 1, 1, 20));
  assert.equal(due("at midnight", justAfter), at(2027, 1, 2, 0, 0));
});

test("calendar dates, English and Italian", () => {
  const dec2 = at(2026, 12, 2, 9);
  table([
    ["2 Dec", dec2],
    ["2 dec", dec2],
    ["2 DEC", dec2],
    ["2nd December", dec2],
    ["2nd of December", dec2],
    ["December 2", dec2],
    ["December 2nd", dec2],
    ["dec 2", dec2],
    ["on 2 dec", dec2],
    ["by dec 2", dec2],
    ["02 dec", dec2],
    ["2 dec 6pm", at(2026, 12, 2, 18)],
    ["2 dec at 6pm", at(2026, 12, 2, 18)],
    ["6pm 2 dec", at(2026, 12, 2, 18)],
    ["dec 2 at 18:30", at(2026, 12, 2, 18, 30)],
    ["2 dec 2027", at(2027, 12, 2, 9)],
    ["Dec 2, 2027", at(2027, 12, 2, 9)],
    ["dec 2 2027 at 6pm", at(2027, 12, 2, 18)],
    ["3 dicembre", at(2026, 12, 3, 9)],
    ["il 3 dicembre", at(2026, 12, 3, 9)],
    ["il 3 di dicembre", at(2026, 12, 3, 9)],
    ["il 3 Dicembre alle 18:30", at(2026, 12, 3, 18, 30)],
    ["il 1° dicembre", at(2026, 12, 1, 9)],
    ["3 dic", at(2026, 12, 3, 9)],
    ["3 dicembre 2027", at(2027, 12, 3, 9)],
    ["entro il 15 novembre", at(2026, 11, 15, 9)],
    ["20 marzo 2027", at(2027, 3, 20, 9)],
    ["5 may 2027", at(2027, 5, 5, 9)],
    ["may 5th 2027", at(2027, 5, 5, 9)],
    ["on may 5", at(2027, 5, 5, 9)],
    ["5 maggio", at(2027, 5, 5, 9)],
    ["31 dec", at(2026, 12, 31, 9)],
    ["sept 9", at(2027, 9, 9, 9)],
    ["9 sep", at(2027, 9, 9, 9)],
  ]);
});

test("a date without a year: this year, next year, or not at all", () => {
  // From Wed 4 Nov 2026, 10:30.
  table([
    ["5 nov", at(2026, 11, 5, 9)],
    ["4 nov 5pm", at(2026, 11, 4, 17)],
    ["15 march", at(2027, 3, 15, 9)],
    ["10 oct", at(2027, 10, 10, 9)],
    ["27 oct", at(2027, 10, 27, 9)],
    ["1 jan", at(2027, 1, 1, 9)],
  ]);
  // Today with its time gone, and the last week: not next year.
  none(["4 nov", "4 nov 9am", "3 nov", "2 nov", "1 nov", "28 oct"]);
  // The year boundary.
  const dec31 = at(2026, 12, 31, 10, 0);
  assert.equal(due("1 jan", dec31), at(2027, 1, 1, 9));
  none(["31 dec"], dec31);
  assert.equal(due("31 dec 5pm", dec31), at(2026, 12, 31, 17));
  const jan2 = at(2027, 1, 2, 10, 0);
  none(["31 dec", "1 jan", "2 jan"], jan2);
  assert.equal(due("3 jan", jan2), at(2027, 1, 3, 9));
  assert.equal(due("9 jan", jan2), at(2027, 1, 9, 9));
  assert.equal(due("25 dec", jan2), at(2027, 12, 25, 9));
});

test("a date with a year in the past is not proposed", () => {
  none(["2 dec 2025", "3 nov 2026", "dec 2 2020", "4 nov 2026 9am"]);
  assert.equal(due("4 nov 2026 5pm", NOW), at(2026, 11, 4, 17));
  assert.equal(due("5 nov 2026", NOW), at(2026, 11, 5, 9));
});

test("dates that do not exist", () => {
  none(["31 apr", "30 feb", "31 nov", "31 jun", "32 dec", "0 dec", "dec 32", "29 feb 2027", "30 feb 2028", "31 sep 2027"]);
});

test("leap years", () => {
  assert.equal(due("29 feb 2028", NOW), at(2028, 2, 29, 9));
  assert.equal(due("29 feb", at(2027, 11, 4, 10, 30)), at(2028, 2, 29, 9), "next year's leap day, 3 months ahead");
  assert.equal(due("29 feb", at(2028, 1, 10, 10, 0)), at(2028, 2, 29, 9));
  none(["29 feb"], NOW); // 2028 is more than a year away
  none(["29 feb"], at(2028, 3, 1, 10, 0)); // a day ago
  none(["29 feb"], at(2028, 5, 1, 10, 0)); // 2029 has none
  assert.equal(due("tomorrow", at(2028, 2, 28, 10, 0)), at(2028, 2, 29, 9));
  assert.equal(due("tomorrow", at(2028, 2, 29, 10, 0)), at(2028, 3, 1, 9));
  assert.equal(due("tomorrow", at(2026, 2, 28, 10, 0)), at(2026, 3, 1, 9));
  assert.equal(due("in 2 days", at(2028, 2, 28, 10, 0)), at(2028, 3, 1, 9));
  assert.equal(due("in 2 days", at(2027, 2, 27, 10, 0)), at(2027, 3, 1, 9));
  assert.equal(due("in 1 week", at(2028, 2, 25, 10, 0)), at(2028, 3, 3, 9));
});

test("end of the month", () => {
  assert.equal(due("end of the month", NOW), at(2026, 11, 30, 9));
  assert.equal(due("by the end of month", NOW), at(2026, 11, 30, 9));
  assert.equal(due("fine mese", NOW), at(2026, 11, 30, 9));
  assert.equal(due("entro fine mese", NOW), at(2026, 11, 30, 9));
  assert.equal(due("a fine mese", NOW), at(2026, 11, 30, 9));
  assert.equal(due("alla fine del mese", NOW), at(2026, 11, 30, 9));
  assert.equal(due("end of the month at 5pm", NOW), at(2026, 11, 30, 17));
  assert.equal(title("send invoices by the end of the month"), "send invoices");
  // On the last day, after the time: the next month's end.
  assert.equal(due("end of month", at(2026, 11, 30, 8, 0)), at(2026, 11, 30, 9));
  assert.equal(due("end of month", at(2026, 11, 30, 10, 0)), at(2026, 12, 31, 9));
  assert.equal(due("end of month", at(2026, 12, 31, 10, 0)), at(2027, 1, 31, 9));
  assert.equal(due("end of month", at(2027, 1, 31, 10, 0)), at(2027, 2, 28, 9));
  assert.equal(due("end of month", at(2028, 1, 31, 10, 0)), at(2028, 2, 29, 9));
  assert.equal(due("tomorrow", at(2026, 1, 31, 10, 0)), at(2026, 2, 1, 9));
  assert.equal(due("in 3 days", at(2026, 4, 29, 10, 0)), at(2026, 5, 2, 9));
  none(["month end report", "the end", "end of day", "fine settimana"]);
});

test("in so long", () => {
  const m = (h: number, mi: number) => at(2026, 11, 4, h, mi);
  table([
    ["in 2 hours", m(12, 30)],
    ["in 2h", m(12, 30)],
    ["in 2 hrs", m(12, 30)],
    ["in 2 hour", m(12, 30)],
    ["IN 2 HOURS", m(12, 30)],
    ["in 30 min", m(11, 0)],
    ["in 30 minutes", m(11, 0)],
    ["in 30min", m(11, 0)],
    ["in 1 minute", m(10, 31)],
    ["in a minute", m(10, 31)],
    ["in an hour", m(11, 30)],
    ["in half an hour", m(11, 0)],
    ["in half hour", m(11, 0)],
    ["in two hours", m(12, 30)],
    ["in ten minutes", m(10, 40)],
    ["in 90 minutes", m(12, 0)],
    ["in 14 hours", at(2026, 11, 5, 0, 30)],
    ["tra 2 ore", m(12, 30)],
    ["tra 10 minuti", m(10, 40)],
    ["fra 2 ore", m(12, 30)],
    ["tra un'ora", m(11, 30)],
    ["tra un ora", m(11, 30)],
    ["tra mezz'ora", m(11, 0)],
    ["tra due ore", m(12, 30)],
    ["tra cinque minuti", m(10, 35)],
    ["tra un minuto", m(10, 31)],
    // Days and weeks: the day moves, the time is the default or the one given.
    ["in 1 day", at(2026, 11, 5, 9)],
    ["in 3 days", at(2026, 11, 7, 9)],
    ["in 3 days at 5pm", at(2026, 11, 7, 17)],
    ["in a week", at(2026, 11, 11, 9)],
    ["in 2 weeks", at(2026, 11, 18, 9)],
    ["tra 2 giorni", at(2026, 11, 6, 9)],
    ["tra tre giorni alle 17", at(2026, 11, 7, 17)],
    ["tra una settimana", at(2026, 11, 11, 9)],
    // Hours and minutes together.
    ["in 1 hour 30 minutes", m(12, 0)],
    ["in 1 hour and 30 minutes", m(12, 0)],
    ["in 1h 30min", m(12, 0)],
    ["in 1 hour, 15 min", m(11, 45)],
    ["in an hour and half an hour", m(12, 0)],
    ["tra 1 ora e 30 minuti", m(12, 0)],
  ]);
  assert.equal(title("call in 1 hour 30 minutes please"), "call please");
  assert.equal(title("call in 1 hour and Marco"), "call and Marco");
  assert.equal(title("send report in 2 hours please"), "send report please");
  assert.equal(due("in 2 hours", NOW + 45_000), at(2026, 11, 4, 12, 31), "rounded to the minute");
  assert.equal(due("in 2 hours", NOW + 20_000), at(2026, 11, 4, 12, 30));
  none(["in 1h30min", "in 0 minutes","in 2 seconds", "in a second", "in a sec", "in 2 months", "in 2", "in", "tra 2", "in 1000 hours", "in the morning", "in 5 apples"]);
});

test("DST: wall-clock time holds, an hour is an hour", () => {
  // US and EU changes of 2026, 20:00 the evening before and on each: whatever the zone of this machine, the
  // phrase reads the same on the clock on the wall.
  const days: [number, number][] = [[3, 7], [3, 8], [3, 28], [3, 29], [10, 24], [10, 25], [10, 31], [11, 1]];
  for (const [mo, d] of days) {
    const now = at(2026, mo, d, 20, 0);
    const tomorrow = new Date(due("tomorrow 9am", now)!);
    assert.deepEqual([tomorrow.getMonth() + 1, tomorrow.getDate(), tomorrow.getHours(), tomorrow.getMinutes()], [...next(mo, d), 9, 0], `tomorrow ${mo}/${d}`);
    const in2 = new Date(due("in 2 days at 7:30", now)!);
    assert.deepEqual([in2.getHours(), in2.getMinutes()], [7, 30], `in 2 days ${mo}/${d}`);
    const week = new Date(due("next monday 8am", now)!);
    assert.deepEqual([week.getDay(), week.getHours(), week.getMinutes()], [1, 8, 0], `next monday ${mo}/${d}`);
    const stamp = due("tomorrow", now)!;
    assert.equal(new Date(stamp).getHours(), 9);
    // An hour is an hour, even on a day with a missing or doubled one (rounded to the minute: no seconds here).
    assert.equal(due("in 5 hours", now), now + 5 * 3_600_000, `5 hours ${mo}/${d}`);
  }
  // From the early hours of the change itself.
  for (const [mo, d] of days) {
    const now = at(2026, mo, d, 0, 30);
    assert.equal(due("in 2 hours", now), now + 2 * 3_600_000);
    assert.equal(new Date(due("today 11pm", now)!).getHours(), 23);
    assert.equal(new Date(due("tonight", now)!).getHours(), 20);
  }
});
/** The day after month/day in 2026. */
function next(mo: number, d: number): [number, number] {
  const t = new Date(2026, mo - 1, d + 1);
  return [t.getMonth() + 1, t.getDate()];
}

test("words that are only words", () => {
  none([
    "I may call Marco",
    "may",
    "maybe",
    "march",
    "march on the office",
    "the second draft",
    "second",
    "the second of may",
    "month",
    "monitor the money",
    "decide what to do",
    "the decision",
    "marching band practice",
    "mayor",
    "august",
    "sept",
    "janet 5",
    "a decimal point",
    "mondays",
    "monday's meeting",
    "tomorrow's meeting",
    "domanial",
    "oggigiorno",
    "sabatox",
    "constructor",
    "__proto__",
    "toString",
    "hasOwnProperty",
    "valueOf tomorrowx",
    "staseras",
    "this",
    "next",
    "next week",
    "next month",
    "the day after",
    "in",
    "at",
    "on",
    "alle",
    "dom",
    "lun",
    "sab",
    "ven",
  ]);
  none(["", " ", "   \n", ",", "...", "5", "12:", ":30", "a.m.", "p.m."]);
});

test("upper and lower case give the same answer", () => {
  const cases = ["call Marco tomorrow 9am", "pay rent on friday", "dentist next monday at 5pm", "book flights 2 Dec", "chiama Marco domani alle 9", "venerdì alle 17", "il 3 dicembre", "tra 2 ore", "tonight at 9"];
  for (const c of cases) {
    const base = due(c);
    assert.notEqual(base, undefined, c);
    assert.equal(due(c.toUpperCase()), base, c.toUpperCase());
    assert.equal(due(c.toLowerCase()), base, c.toLowerCase());
    assert.equal(due(c.replace(/\b(\w)/g, (m) => m.toUpperCase())), base, "title case");
    assert.equal(title(c.toUpperCase()), title(c)?.toUpperCase());
  }
});

test("the title after cutting the phrase", () => {
  const rows: [string, string][] = [
    ["call Marco tomorrow 9am about the report", "call Marco about the report"],
    ["tomorrow 9am call Marco", "call Marco"],
    ["call Marco, tomorrow 9am", "call Marco"],
    ["Call Marco (tomorrow 9am)", "Call Marco"],
    ["buy milk - friday", "buy milk"],
    ["buy milk  on   friday  ", "buy milk"],
    ["Pay Rent On Friday", "Pay Rent"],
    ["remind me to call Marco tomorrow at 9am", "remind me to call Marco"],
    ["call the dentist tomorrow", "call the dentist"],
    ["tomorrow", "tomorrow"],
    ["tomorrow 9am", "tomorrow 9am"],
    ["  tomorrow  ", "tomorrow"],
    ["gym @ 5pm", "gym"],
    ["dentist 5pm friday", "dentist"],
    ["dentist friday, 5pm", "dentist"],
    ["finish slides by friday 5pm", "finish slides"],
    ["finish slides for friday", "finish slides"],
    ["scadenza: venerdì", "scadenza"],
    ["compra il latte domani", "compra il latte"],
    ["compra il latte il 3 dicembre per Anna", "compra il latte per Anna"],
  ];
  for (const [text, want] of rows) assert.equal(title(text), want, text);
});

test("only the first phrase counts", () => {
  const r = parseDate("call Marco tomorrow, pay rent friday", NOW)!;
  assert.equal(r.due, at(2026, 11, 5, 9));
  assert.equal(r.title, "call Marco, pay rent friday");
  // A phrase that is understood but not proposed is skipped whole, and the next one is used.
  const s = parseDate("stamattina chiama Marco venerdì", NOW)!;
  assert.equal(s.due, at(2026, 11, 6, 9));
  assert.equal(s.title, "stamattina chiama Marco");
  // Its own time must not be picked up on its own: "today 9am" from 10:30 is not tomorrow 9am.
  none(["today 9am", "oggi alle 9", "tonight at 8pm", "this morning at 9"], at(2026, 11, 4, 20, 30));
  assert.equal(due("today 9am", NOW), undefined);
});

test("time before date, and a date with a lead that is not a date", () => {
  table([
    ["9am tomorrow", at(2026, 11, 5, 9)],
    ["5pm friday", at(2026, 11, 6, 17)],
    ["5pm on friday", at(2026, 11, 6, 17)],
    ["at 5pm on friday", at(2026, 11, 6, 17)],
    ["alle 17 venerdì", at(2026, 11, 6, 17)],
    ["17:30 il 3 dicembre", at(2026, 12, 3, 17, 30)],
    ["at 5 tomorrow", at(2026, 11, 5, 17)],
    ["call tomorrow 5", at(2026, 11, 5, 9)],
  ]);
  assert.equal(title("call tomorrow 5"), "call 5");
  assert.equal(title("at 5pm on friday call Marco"), "call Marco");
});

test("a date and time typed with odd spacing and punctuation", () => {
  table([
    ["tomorrow    9am", at(2026, 11, 5, 9)],
    ["tomorrow\t9am", at(2026, 11, 5, 9)],
    ["tomorrow,9am", at(2026, 11, 5, 9)],
    ["tomorrow, at 9am", at(2026, 11, 5, 9)],
    ["buy milk. tomorrow", at(2026, 11, 5, 9)],
    ["venerdi' alle 17", at(2026, 11, 6, 17)],
    ["venerdì’ alle 17", at(2026, 11, 6, 17)],
    ["(friday)", at(2026, 11, 6, 9)],
    ["friday!", at(2026, 11, 6, 9)],
    ["\"tomorrow\"", at(2026, 11, 5, 9)],
  ]);
});

test("a phrase stuck to other characters is not a date", () => {
  none(["tomorrow-ish", "pre-friday", "tomorrow.9am", "friday.txt", "notes_friday", "friday_notes", "#friday", "tomorrow/friday", "3pm-4pm", "9am-5pm", "http://x.com/friday", "see x.com/tomorrow", "2026-12-03", "a-sat", "dec-5", "5pm5", "x9am"]);
  // Around it, punctuation is fine.
  table([
    ["(friday)", at(2026, 11, 6, 9)],
    ["friday.", at(2026, 11, 6, 9)],
    ["friday:", at(2026, 11, 6, 9)],
    ["friday; ok", at(2026, 11, 6, 9)],
    ["'friday'", at(2026, 11, 6, 9)],
    ["«venerdì»", at(2026, 11, 6, 9)],
    ["meet @5pm", at(2026, 11, 4, 17)],
    ["Dr. Smith, friday.", at(2026, 11, 6, 9)],
  ]);
});

test("a date written two ways at once", () => {
  // "mar" is March in English and Italian shorthand; the 5 belongs to the month that follows it.
  assert.equal(due("riunione mar 5 dic", NOW), at(2026, 12, 5, 9));
  assert.equal(title("riunione mar 5 dic"), "riunione mar");
  assert.equal(due("mar 5", NOW), at(2027, 3, 5, 9));
});

test("long and odd input does not hang or throw", () => {
  const long = "word ".repeat(20_000);
  assert.equal(parseDate(long, NOW), null);
  assert.equal(parseDate(`${long}tomorrow`, NOW)?.due, at(2026, 11, 5, 9));
  assert.equal(parseDate("9".repeat(5000), NOW), null);
  assert.equal(parseDate("a.m.".repeat(2000), NOW), null);
  assert.equal(parseDate("'".repeat(5000) + "a".repeat(5000), NOW), null);
  assert.equal(parseDate("😀 tomorrow 😀", NOW)?.title, "😀 😀");
  assert.equal(parseDate("明日 tomorrow", NOW)?.title, "明日");
  assert.doesNotThrow(() => parseDate("\u0000\ud800 tomorrow", NOW));
});

test("seconds and milliseconds of the clock do not leak into the answer", () => {
  const now = at(2026, 11, 4, 10, 30) + 47_123;
  assert.equal(due("tomorrow 9am", now), at(2026, 11, 5, 9));
  assert.equal(due("friday", now), at(2026, 11, 6, 9));
  assert.equal(due("2 dec", now), at(2026, 12, 2, 9));
});
