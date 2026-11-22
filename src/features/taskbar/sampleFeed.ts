// Fixed sample data for the bar in the dev server and the Widgets page's previews, never the real data. It imports nothing from
// src/dev, so the settings and notch bundles carry no showcase data.

import { t } from "../../i18n";
import type { Reading } from "../../notch/row/parts/Readings";
import type { ClosedSettings } from "../../notch/row/parts";
import type { NowPlaying } from "../../platform/media/types";
import type { BarFeed } from "./barStores";

/** 14:30 today: the time the sample's clocks show, which never tick. */
export const SAMPLE_AT = new Date().setHours(14, 30, 0, 0);
/** A focus timer at 18:44 of 25:00, never ticking. */
export const SAMPLE_TIMER = { remaining: 18 * 60 + 44, duration: 25 * 60, mode: "focus" as const };
/** A stopwatch at 12:34 with two laps, running, never ticking. */
export const SAMPLE_STOPWATCH = { elapsed: 12 * 60_000 + 34_000, running: true, laps: 2 };
/** The next to-do of the sample's project, two of five done. Built at call time, so its text follows the language. */
export const sampleTodo = () => ({ id: "sample", text: t("Einkaufen gehen"), done: 2, total: 5 });
/** The note's first line. */
export const sampleNote = () => t("Ideen fürs Wochenende");

/** The sample's day n days after today, as the forecast writes it. */
const dayAt = (n: number) => {
  const d = new Date(SAMPLE_AT);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const day = dayAt(0);

/** A coloured initial, as the showcase's avatars. */
const avatar = (name: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="hsl(150 55% 48%)"/><text x="32" y="43" font-size="30" font-family="sans-serif" fill="#fff" text-anchor="middle">${name.slice(0, 1).toUpperCase()}</text></svg>`)}`;

/** CPU % over the last 30 s, the mockup's line. */
const SPARK = [12, 15, 14, 22, 30, 26, 18, 16, 20, 34, 41, 28, 22, 19, 17, 24, 21, 15, 13, 18, 25, 23, 19, 16, 14, 17, 20, 18, 16, 18];
/** Download and upload over the last 30 s, bytes/s: two bursts and a quiet stretch. */
const NET_DOWN = [120, 140, 160, 900, 2100, 1800, 1300, 600, 300, 200, 180, 160, 700, 1500, 1800, 1200, 500, 250, 200, 180, 160, 150, 400, 1100, 1600, 1000, 450, 260, 900, 2400].map((k) => k * 1000);
const NET_UP = [20, 25, 30, 60, 150, 140, 90, 40, 30, 25, 20, 20, 50, 110, 140, 90, 40, 25, 20, 20, 18, 18, 35, 80, 120, 70, 35, 25, 60, 180].map((k) => k * 1000);
/** The coin's last day, hourly, ending on its price. */
const COIN_DAY = [82100, 82350, 82200, 82600, 82900, 82750, 83100, 83400, 83250, 83600, 83500, 83900, 84200, 84050, 83800, 83950, 84300, 84600, 84400, 84150, 84350, 84500, 84250, 84100, 84215];
/** The coin over 7 days, hourly: six days climbing in waves, then its last day. */
const COIN_WEEK = [...Array.from({ length: 168 - COIN_DAY.length }, (_, i) => Math.round(78400 + i * 26 + 600 * Math.sin(i / 9))), ...COIN_DAY];

/** A cover for the song's versions: a diagonal gradient under a ring, as a disc. */
const SAMPLE_COVER = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(330 70% 58%)"/><stop offset="1" stop-color="hsl(250 60% 42%)"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><circle cx="32" cy="32" r="12" fill="none" stroke="white" stroke-opacity=".7" stroke-width="3"/></svg>')}`;
/** The song the title's versions draw on the Widgets page, 1:23 into 3:34, playing. */
export const SAMPLE_TRACK: NowPlaying = {
  title: "Neon Harbour (Extended Night Mix)",
  artist: "Lumen Drift",
  artwork: SAMPLE_COVER,
  accent: "#ffffff",
  isPlaying: true,
  position: 83,
  duration: 214,
  canSeek: true,
  updatedAt: 0,
  appId: "Spotify.exe",
  shuffle: null,
  repeat: null,
  sources: [],
};

/** Every widget's slice filled, the readings kept to the switches `on` as useReadings keeps them, so the sample draws what the bar would. Built at call time, so its one string follows the language. */
export function sampleFeed(on: ClosedSettings["readings"]): BarFeed {
  const readings: Reading[] = [];
  if (on.cpu) readings.push({ id: "cpu", value: 18, level: 0 });
  if (on.ram) readings.push({ id: "ram", value: 64, level: 0 });
  if (on.gpu) readings.push({ id: "gpu", value: 7, level: 0 });
  if (on.net) readings.push({ id: "down", value: 2_400_000, level: 0 }, { id: "up", value: 180_000, level: 0 });
  if (on.temp) readings.push({ id: "temp", value: 54, level: 0, source: "cpu" });
  return {
    weather: { temp: 12, feels: 10, code: 2, wind: 9, day: true },
    weatherHours: [
      { time: `${day}T15:00`, temp: 13, code: 0, day: true },
      { time: `${day}T16:00`, temp: 12, code: 3, day: true },
      { time: `${day}T17:00`, temp: 10, code: 61, day: true },
    ],
    // Wider than the title's 160 px, so it scrolls.
    title: { text: "Neon Harbour (Extended Night Mix) · Lumen Drift", lyric: false },
    playing: true,
    rings: [
      { id: "openrouter", value: 42, label: "OpenRouter 42%" },
      { id: "deepseek", value: 76, label: "DeepSeek 76%" },
    ],
    readings,
    spark: SPARK,
    github: { count: 7, level: 2 },
    leetcode: { count: 2, level: 1 },
    next: { text: `14:30 ${t("Besprechung")}`, color: "var(--color-link)" },
    downloads: [{ name: "ubuntu-24.04-desktop-amd64.iso", size: 1_240_000_000, speed: 8_400_000 }],
    call: {
      channelId: "1",
      channelName: "Launch Prep",
      guildName: "Pixel Forge",
      guildIcon: null,
      mute: false,
      deaf: false,
      speaking: false,
      members: [{ id: "2", name: "mira.codes", avatar: avatar("mira.codes"), speaking: true, muted: false }],
    },
    disks: [
      { letter: "C:", name: "Windows", total: 953 * 1024 ** 3, free: 214 * 1024 ** 3, removable: false, system: true },
      { letter: "D:", name: "Data", total: 1863 * 1024 ** 3, free: 140 * 1024 ** 3, removable: false, system: false },
      { letter: "E:", name: "USB", total: 58 * 1024 ** 3, free: 31 * 1024 ** 3, removable: true, system: false },
    ],
    script: [{ id: "deploy", source: "deploy.sh", text: "Deploy 3/5", icon: "rocket", progress: 60, open: null, expires: null, at: Date.now() }],
    netSpark: { down: NET_DOWN, up: NET_UP },
    topApps: [
      { id: "code.exe", name: "Visual Studio Code", path: null, share: 12, mem: 1536 * 1024 ** 2 },
      { id: "chrome.exe", name: "Google Chrome", path: null, share: 7.4, mem: 3174 * 1024 ** 2 },
      { id: "spotify.exe", name: "Spotify", path: null, share: 1.8, mem: 412 * 1024 ** 2 },
    ],
    power: { ac: false, percent: 72, battery: true, charging: false, saver: false },
    // No offset: the sample's times read in the PC's zone.
    weatherDays: {
      daily: [
        { date: day, code: 2, max: 14, min: 6, rain: 40, mm: 1.2, sunrise: `${day}T07:12`, sunset: `${day}T16:40` },
        { date: dayAt(1), code: 61, max: 11, min: 5, rain: 80, mm: 4.6, sunrise: `${dayAt(1)}T07:14`, sunset: `${dayAt(1)}T16:38` },
        { date: dayAt(2), code: 3, max: 10, min: 4, rain: 20, mm: 0, sunrise: `${dayAt(2)}T07:15`, sunset: `${dayAt(2)}T16:37` },
        { date: dayAt(3), code: 0, max: 13, min: 3, rain: 0, mm: 0, sunrise: `${dayAt(3)}T07:17`, sunset: `${dayAt(3)}T16:35` },
      ],
    },
    currency: { from: "GBP", to: "EUR", rate: 1.1835 },
    crypto: { symbol: "BTC", base: "EUR", price: 84215, change: 2.41, line: COIN_WEEK },
  };
}
