import { barFeed } from "../features/taskbar/barStores";
import { sampleFeed } from "../features/taskbar/sampleFeed";
import { barStatus } from "../features/taskbar/status";
import { barWindows } from "../features/taskbar/store";
import { trayPictures, trayState } from "../features/taskbar/tray";
import { mockStatus } from "../platform/services";
import { settings, updateSettings } from "../settings/store";

const sampleTrayPicture = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#3b82f6"/><path d="M4 8l3 3 5-6" stroke="#fff" stroke-width="2" fill="none"/></svg>')}`;

/** Dev only, in the browser, where no notch feeds the bar: every widget's slice filled, so the widgets can be checked as they draw. */
export function fillSample(): void {
  // Two tray icons, one with a picture and one without, both kept visible.
  updateSettings((c) => ({ taskbar: { ...c.taskbar, trayShown: ["sample-sync", "sample-chat"] } }));
  trayState.set({ yielded: false, icons: [{ id: "sample-sync", key: "1", tip: "Sync: up to date", img: "sample-sync" }, { id: "sample-chat", key: "2", tip: "Chat: 2 new messages", img: null }] });
  trayPictures.set({ "sample-sync": sampleTrayPicture });
  // ?apps=N: N open apps, the last one in front and the one before it asking for attention.
  const apps = Number(new URLSearchParams(location.search).get("apps"));
  if (apps > 0)
    barWindows.set({
      groups: Array.from({ length: apps }, (_, i) => ({ key: `sample-${i}`, name: `App ${i}`, pins: [], windows: [{ id: i + 1, title: `App ${i}`, minimized: false, flashing: i === apps - 2 }] })),
      active: apps,
    });
  barStatus.set({ power: mockStatus.seed().power, network: { kind: "wireless", wifi: true, bars: 4, ssid: "Crest Lab" }, sound: { level: 40, muted: false } });
  barFeed.set(sampleFeed(settings.get().closed.readings));
}
