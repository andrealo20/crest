// Fixed sample data for the bar in the dev server and the Widgets page's previews, never the real data. It imports nothing from
// src/dev, so the settings and notch bundles carry no showcase data.

import { t } from "../../i18n";
import type { Reading } from "../../notch/row/parts/Readings";
import type { ClosedSettings } from "../../notch/row/parts";
import type { BarFeed } from "./barStores";

/** 14:30 today: the time the sample's clocks show, which never tick. */
export const SAMPLE_AT = new Date().setHours(14, 30, 0, 0);
/** A focus timer at 18:44 of 25:00, never ticking. */
export const SAMPLE_TIMER = { remaining: 18 * 60 + 44, duration: 25 * 60, mode: "focus" as const };

const day = (() => {
  const d = new Date(SAMPLE_AT);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();

/** A coloured initial, as the showcase's avatars. */
const avatar = (name: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="hsl(150 55% 48%)"/><text x="32" y="43" font-size="30" font-family="sans-serif" fill="#fff" text-anchor="middle">${name.slice(0, 1).toUpperCase()}</text></svg>`)}`;

/** CPU % over the last 30 s, the mockup's line. */
const SPARK = [12, 15, 14, 22, 30, 26, 18, 16, 20, 34, 41, 28, 22, 19, 17, 24, 21, 15, 13, 18, 25, 23, 19, 16, 14, 17, 20, 18, 16, 18];

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
    script: [{ id: "deploy", source: "deploy.sh", text: "Deploy 3/5", icon: "rocket", progress: 60, open: null, expires: null, at: Date.now() }],
  };
}
