import { barFeed } from "../features/taskbar/barStores";
import { barStatus } from "../features/taskbar/status";
import { trayPictures, trayState } from "../features/taskbar/tray";
import { mockStatus } from "../platform/services";
import { updateSettings } from "../settings/store";
import { sampleAvatar } from "./showcase-data";

const sampleTrayPicture = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#3b82f6"/><path d="M4 8l3 3 5-6" stroke="#fff" stroke-width="2" fill="none"/></svg>')}`;

/** Dev only, in the browser, where no notch feeds the bar: every widget's slice filled, so the widgets can be checked as they draw. */
export function fillSample(): void {
  // Two tray icons, one with a picture and one without, both kept visible.
  updateSettings((c) => ({ taskbar: { ...c.taskbar, trayShown: ["sample-sync", "sample-chat"] } }));
  trayState.set({ yielded: false, icons: [{ id: "sample-sync", key: "1", tip: "Sync: up to date", img: "sample-sync" }, { id: "sample-chat", key: "2", tip: "Chat: 2 new messages", img: null }] });
  trayPictures.set({ "sample-sync": sampleTrayPicture });
  barStatus.set({ power: mockStatus.seed().power, network: { kind: "wireless", wifi: true, bars: 4, ssid: "Crest Lab" }, sound: { level: 40, muted: false } });
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
