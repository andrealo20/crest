import { barFeed } from "../features/taskbar/barStores";
import { sampleAvatar } from "./showcase-data";

/** Dev only, in the browser, where no notch feeds the bar: every widget's slice filled, so the widgets can be checked as they draw. */
export function fillSample(): void {
  barFeed.set({
    weather: { temp: 12, feels: 10, code: 2, wind: 9, day: true },
    // Wider than the title's 160 px, so it scrolls.
    title: { text: "Neon Harbour (Extended Night Mix) · Lumen Drift", lyric: false },
    playing: true,
    rings: [
      { id: "openrouter", value: 42, label: "OpenRouter 42%" },
      { id: "deepseek", value: 76, label: "DeepSeek 76%" },
    ],
    readings: [
      { id: "cpu", value: 18, level: 0 },
      { id: "ram", value: 64, level: 0 },
      { id: "gpu", value: 7, level: 0 },
    ],
    github: { count: 7, level: 2 },
    leetcode: { count: 2, level: 1 },
    next: { text: "14:30 Standup", color: "var(--color-link)" },
    downloads: [{ name: "ubuntu-24.04-desktop-amd64.iso", size: 1_240_000_000, speed: 8_400_000 }],
    call: {
      channelId: "1",
      channelName: "Launch Prep",
      guildName: "Pixel Forge",
      guildIcon: null,
      mute: false,
      deaf: false,
      speaking: false,
      members: [{ id: "2", name: "mira.codes", avatar: sampleAvatar("mira.codes", 1), speaking: true, muted: false }],
    },
    script: [{ id: "deploy", source: "deploy.sh", text: "Deploy 3/5", icon: "rocket", progress: 60, open: null, expires: null, at: Date.now() }],
  });
}
