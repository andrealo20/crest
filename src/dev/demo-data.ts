import type { Found } from "../features/now-playing/lrc";
import type { Forecast, Place } from "../features/weather/store";
import { t } from "../i18n";

/*
 * Sample data for the try-it demo (src/dev/demo.ts). Loaded on demand, so it never reaches the app.
 * The songs and their lyrics are made up for the demo.
 */

// ---------- Lyrics ----------

type Line = [time: number, text: string, translation?: string];

const NEON_HARBOUR: Line[] = [
  [8, "Streetlights hum along the water"],
  [15, "Every window holds a different night"],
  [22, "I count the ferries leaving slowly"],
  [29, "Chasing a little borrowed light"],
  [38, "Neon harbour, take me out tonight"],
  [46, "Where the tide keeps all the time"],
  [54, "Neon harbour, leave the engine running"],
  [62, "We don't need a map to know the line"],
  [72, "Salt on the glass and the city turning blue"],
  [80, "Every rooftop signal says come through"],
  [88, "Hold the rail, the bridge is lifting"],
  [96, "Somebody laughs two streets away"],
  [106, "Neon harbour, take me out tonight"],
  [114, "Where the tide keeps all the time"],
  [122, "Neon harbour, leave the engine running"],
  [130, "Morning's just a rumour on the pier"],
  [142, "Let the radio go quiet"],
  [152, "Let the water do the talking"],
  [164, "Neon harbour, stay a little while"],
  [176, "Neon harbour, stay a little while"],
];

const SLOW_ORANGE: Line[] = [
  [6, "Sunday afternoon is leaning on the door"],
  [13, "Coffee going cold beside the radio"],
  [20, "Nothing on the list and nowhere I should be"],
  [28, "Just the light across the floor"],
  [38, "Slow orange, slow orange"],
  [45, "Let the whole day melt away"],
  [53, "Slow orange, slow orange"],
  [60, "Tell the evening it can wait"],
  [72, "Curtains breathing in and out"],
  [80, "A neighbour's piano finds a tune"],
  [88, "I could stay like this for hours"],
  [96, "Under a half-forgotten moon"],
  [108, "Slow orange, slow orange"],
  [115, "Let the whole day melt away"],
  [123, "Slow orange, slow orange"],
  [130, "Tell the evening it can wait"],
  [145, "Nothing left to carry"],
  [155, "Nothing left to say"],
];

const PAPEL_Y_LUZ: Line[] = [
  [8, "Escribo tu nombre en papel y luz", "I write your name on paper and light"],
  [16, "Lo dejo en la ventana a secar", "I leave it on the window to dry"],
  [24, "La ciudad se despierta despacio", "The city wakes up slowly"],
  [32, "Y yo sigo sin ganas de hablar", "And I still don't feel like talking"],
  [44, "Papel y luz, papel y luz", "Paper and light, paper and light"],
  [52, "Todo lo que queda es tu voz", "All that is left is your voice"],
  [60, "Papel y luz, papel y luz", "Paper and light, paper and light"],
  [68, "Cruzamos el río sin hacer ruido", "We cross the river without a sound"],
  [80, "Una canción en el autobús", "A song on the bus"],
  [88, "Dos estaciones y un solo abrigo", "Two stations and a single coat"],
  [96, "El sol se esconde detrás del humo", "The sun hides behind the smoke"],
  [108, "Papel y luz, papel y luz", "Paper and light, paper and light"],
  [116, "Todo lo que queda es tu voz", "All that is left is your voice"],
  [128, "Mañana vuelvo a empezar", "Tomorrow I start again"],
  [140, "Mañana vuelvo a empezar", "Tomorrow I start again"],
];

const stamp = (t: number) => `[${String(Math.floor(t / 60)).padStart(2, "0")}:${(t % 60).toFixed(2).padStart(5, "0")}]`;

/** Enhanced LRC: each word of a line gets its own stamp, spread evenly up to the next line. */
function withWords(lines: Line[]): string {
  return lines
    .map(([t, text], i) => {
      const end = Math.min((lines[i + 1]?.[0] ?? t + 6) - 0.4, t + 5);
      const words = text.split(" ");
      const step = (end - t) / words.length;
      return `${stamp(t)}${words.map((w, k) => `<${stamp(t + k * step).slice(1, -1)}>${w}`).join(" ")}`;
    })
    .join("\n");
}

const plain = (lines: Line[]) => lines.map(([t, text]) => `${stamp(t)}${text}`).join("\n");
const translated = (lines: Line[]) => lines.map(([t, , tr]) => `${stamp(t)}${tr ?? ""}`).join("\n");

/** What the lyric sources would have answered, by song title; word timing on the first, a translation on the third. */
export function demoLyrics(title: string): Found | null {
  if (title === "Neon Harbour") return { lrc: withWords(NEON_HARBOUR), instrumental: false };
  if (title === "Slow Orange") return { lrc: plain(SLOW_ORANGE), instrumental: false };
  if (title === "Papel y Luz") return { lrc: plain(PAPEL_Y_LUZ), instrumental: false, translation: translated(PAPEL_Y_LUZ) };
  return null;
}

// ---------- Weather ----------

const PLACES: Place[] = [
  { name: "Amsterdam", detail: "North Holland, Netherlands", lat: 52.37, lon: 4.89 },
  { name: "London", detail: "England, United Kingdom", lat: 51.51, lon: -0.13 },
  { name: "Berlin", detail: "Berlin, Germany", lat: 52.52, lon: 13.41 },
  { name: "Paris", detail: "Île-de-France, France", lat: 48.85, lon: 2.35 },
  { name: "Rome", detail: "Lazio, Italy", lat: 41.89, lon: 12.51 },
  { name: "Madrid", detail: "Madrid, Spain", lat: 40.42, lon: -3.7 },
  { name: "New York", detail: "New York, United States", lat: 40.71, lon: -74.01 },
  { name: "Tokyo", detail: "Tokyo, Japan", lat: 35.69, lon: 139.69 },
  { name: "Sydney", detail: "New South Wales, Australia", lat: -33.87, lon: 151.21 },
];

export const searchDemoPlaces = (q: string): Place[] => PLACES.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 4);

const pad = (n: number) => String(n).padStart(2, "0");
const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hour = (d: Date) => `${day(d)}T${pad(d.getHours())}:00`;

/** A made-up week for any place: a grey, mild day first, a clearing and a little rain after. Nothing is fetched. */
export function demoForecast(lat: number, lon: number): Forecast {
  const now = new Date();
  // Warmer towards the equator, a little different per place.
  const base = 9 + (52 - Math.abs(lat)) * 0.35 + (Math.round(lon) % 3);
  const codes = [3, 61, 3, 2, 1, 0, 80];
  const daily = codes.map((code, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const max = Math.round((base + 2 + Math.sin(i * 1.3) * 2.2) * 10) / 10;
    const rain = code >= 61 ? 70 : code === 3 ? 20 : 5;
    return {
      date: day(d),
      code,
      max,
      min: Math.round((max - 4.5 - (i % 3) * 0.6) * 10) / 10,
      rain,
      mm: code >= 61 ? 2.4 + i * 0.3 : 0,
      sunrise: `${day(d)}T07:${pad(30 + i)}`,
      sunset: `${day(d)}T16:${pad(48 - i)}`,
    };
  });
  const swing = (h: number) => Math.sin(((h - 9) / 24) * Math.PI * 2) * 2.5;
  const hourly = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + i);
    const h = d.getHours();
    const isDay = h >= 8 && h < 17;
    return { time: hour(d), temp: Math.round((base + swing(h) - swing(now.getHours())) * 10) / 10, code: i > 6 && i < 11 ? 61 : 3, day: isDay, rain: i > 6 && i < 11 ? 55 : 15 };
  });
  const h = now.getHours();
  return {
    current: { temp: Math.round(base * 10) / 10, feels: Math.round((base - 2.4) * 10) / 10, code: 3, wind: 17.6, day: h >= 8 && h < 17, humidity: 82, windDir: 230, precip: 0 },
    daily,
    hourly,
  };
}

// ---------- Capture ----------

/** Lines "read" on the screens for Find on screen: what a busy desktop might say. */
export const FOUND_LINES = [
  { text: "Quarterly report: revenue up 12 %", monitor: 0, rect: { x: 220, y: 200, w: 420, h: 30 } },
  { text: "Café opening hours 8:00 to 18:00", monitor: 0, rect: { x: 220, y: 260, w: 380, h: 30 } },
  { text: "Invoice number 2026-1104", monitor: 0, rect: { x: 900, y: 140, w: 300, h: 28 } },
  { text: "Meeting notes: launch checklist", monitor: 0, rect: { x: 220, y: 330, w: 360, h: 28 } },
  { text: "Flight AMS to LHR departs 07:45", monitor: 1, rect: { x: 160, y: 180, w: 400, h: 30 } },
  { text: "Reset your password within 24 hours", monitor: 1, rect: { x: 160, y: 240, w: 440, h: 30 } },
  { text: "Invoice paid, thank you", monitor: 1, rect: { x: 700, y: 400, w: 280, h: 28 } },
];

// ---------- Ask ----------

/** Canned answers, picked by a word in the question; the demo calls no model. */
export function demoAnswer(question: string): string {
  const q = question.toLowerCase();
  // The quick buttons send their prompt in the UI language, so they are matched by the start of that text.
  const asked = (key: string) => q.startsWith(t(key).split("{")[0].trim().toLowerCase());
  if (asked("Fasse kurz zusammen: {x}") || /summar/.test(q)) return "In short:\n\nCrest puts music, timers, notes and more in the notch, one hover away.\n\nDemo answer: in the app this comes from your own model.";
  if (asked("Formuliere klarer um: {x}") || /(rephrase|rewrite|polish)/.test(q)) return "A clearer version:\n\nCrest keeps your tools one hover away: music, timers, notes and more, without another window.\n\nDemo answer: in the app this comes from your own model.";
  if (asked("Übersetze auf {lang}: {x}") || /(translate|übersetz|traduc)/.test(q)) return "Here is a translation:\n\n\"The notch is a small place for big things.\"\n\nThis is a demo answer: in the app Ask sends your question to the model you set up, with your own key.";
  if (/(regex|code|function|bug|rust|python|typescript|javascript)/.test(q)) return "A small example:\n\nconst clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));\n\nIn the app Ask can read what you copied and answer about it. This reply is canned for the demo.";
  return "This is a demo reply: no model is called and nothing you type leaves this page.\n\nIn the app, Ask streams answers from Claude, ChatGPT, OpenRouter or any OpenAI-compatible endpoint, using your own API key, with adjustable reasoning effort. The clipboard buttons above summarize, rephrase or translate what you copied.";
}
