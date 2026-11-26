// Fixed sample data for the bar in the dev server and the Widgets page's previews, never the real data. It imports nothing from
// src/dev, so the settings and notch bundles carry no showcase data.

import { t } from "../../i18n";
import type { Reading } from "../../notch/row/parts/Readings";
import type { ClosedSettings } from "../../notch/row/parts";
import type { NowPlaying } from "../../platform/media/types";
import type { BarFeed } from "./barStores";
import type { Market } from "./markets";
import { WHATSAPP } from "./unread";

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
/** Keep awake on for two hours, 1:05 of them left. */
export const SAMPLE_AWAKE = { minutes: 120, endsAt: SAMPLE_AT + 65 * 60_000 };

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
/** The stock over 5 sessions of 26 quarter hours, a dip on the third day, ending on its price. */
const STOCK_WEEK = Array.from({ length: 130 }, (_, i) => +(345 + i * 0.08 - 4 * Math.exp(-(((i - 65) / 12) ** 2)) + 1.2 * Math.sin(i / 4)).toFixed(2)).map((v, i, a) => (i === a.length - 1 ? 355.58 : v));
/** Today's performance of the Depot, every 2 minutes from the open: a slow rise. */
const PORTFOLIO_DAY = Array.from({ length: 40 }, (_, i) => Math.round(12380 + i * 2.6 + 18 * Math.sin(i / 3)));

/** The crypto widget's three versions with sample figures, for the bar in the dev server and the Widgets page, each drawing its own. */
export const SAMPLE_MARKETS: Record<Market["kind"], Market> = {
  coin: { kind: "coin", range: "1d", symbol: "BTC", base: "EUR", price: 84215, change: 2.41, line: COIN_WEEK, day: COIN_DAY.length },
  stock: { kind: "stock", range: "1d", symbol: "AAPL", name: "Apple Inc.", base: "USD", price: 355.58, change: 0.43, line: STOCK_WEEK, day: 26 },
  portfolio: { kind: "portfolio", range: "1d", symbol: "", base: "EUR", price: 12480, change: 0.82, line: PORTFOLIO_DAY, day: PORTFOLIO_DAY.length },
};

/** Today's Screen Time per hour, 3 h 05 min from 8 to 14:30. */
const SCREEN_HOURS = Array.from({ length: 24 }, (_, h) => [0, 0, 0, 0, 0, 0, 0, 0, 1800, 3000, 2400, 1500, 600, 1200, 600][h] ?? 0);
/** A time today, as the sample's day. */
const todayAt = (h: number, m = 0) => new Date(SAMPLE_AT).setHours(h, m, 0, 0);
/** The CPU's and the GPU's last 10 minutes, a point each 15 s: slow waves between 48 and 74 °C and between 40 and 62. */
const CPU_TEMPS = Array.from({ length: 40 }, (_, i) => Math.round(61 + 13 * Math.sin(i / 6)));
const GPU_TEMPS = Array.from({ length: 40 }, (_, i) => Math.round(51 + 11 * Math.sin(i / 7 + 1)));

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
    crypto: SAMPLE_MARKETS.coin,
    // The same three apps as the Top apps.
    screenTime: {
      total: 11100,
      apps: [
        { key: "code.exe", name: "Visual Studio Code", path: null, secs: 6000 },
        { key: "chrome.exe", name: "Google Chrome", path: null, secs: 3900 },
        { key: "spotify.exe", name: "Spotify", path: null, secs: 1200 },
      ],
      hours: SCREEN_HOURS,
    },
    timeline: {
      events: [
        { start: todayAt(11), end: todayAt(11, 30), color: "var(--color-blue)" },
        { start: todayAt(15), end: todayAt(16), color: "var(--color-green)" },
      ],
      hours: SCREEN_HOURS,
    },
    // Two apps with notifications waiting and one at zero, so the previews show both versions and the zero.
    unread: [
      { id: WHATSAPP, name: "WhatsApp", count: 3 },
      { id: "microsoft.windowscommunicationsapps_8wekyb3d8bbwe!microsoft.windowslive.mail", name: "Mail", count: 12 },
      { id: "msteams_8wekyb3d8bbwe!msteams", name: "Teams", count: 0 },
    ],
    // The mouse is the lowest and none is red.
    btDevices: [
      { id: "1", name: "WH-1000XM5", categories: ["Audio.Headphone"], connected: true, battery: 80 },
      { id: "2", name: "MX Master 3S", categories: ["Input.Mouse"], connected: true, battery: 35 },
      { id: "3", name: "Keychron K3", categories: ["Input.Keyboard"], connected: true, battery: 62 },
    ],
    temps: { cpu: 63, gpu: 51, cpuLine: CPU_TEMPS, gpuLine: GPU_TEMPS, fans: { cpu: 1240, gpu: 860, case: 720 } },
  };
}
