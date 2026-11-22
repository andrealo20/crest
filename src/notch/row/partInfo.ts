import { CalendarBlank, ChartDonut, Clock, CloudSun, Cpu, DownloadSimple, HardDrives, GithubLogo, MusicNote, TerminalWindow, Timer, Waveform, type Icon } from "../../ui/iconset";
import type { Hue } from "../../features/themes/hues";
import { DiscordLogo, LeetcodeLogo } from "../../ui/brands";
import type { PartId } from "./parts";

/** Each part's name (a key for t()), icon and hue, as the settings list them; Crest's bar shows a resting widget as its icon. */
export const partInfo: Record<PartId, { label: string; icon: Icon; hue: Hue }> = {
  timer: { label: "Timer", icon: Timer, hue: "orange" },
  discord: { label: "Discord", icon: DiscordLogo, hue: "indigo" },
  rings: { label: "AI-Nutzung", icon: ChartDonut, hue: "purple" },
  title: { label: "Songtitel", icon: MusicNote, hue: "pink" },
  readings: { label: "Auslastung", icon: Cpu, hue: "red" },
  equalizer: { label: "Equalizer", icon: Waveform, hue: "pink" },
  clock: { label: "Uhrzeit", icon: Clock, hue: "blue" },
  github: { label: "GitHub heute", icon: GithubLogo, hue: "violet" },
  leetcode: { label: "LeetCode heute", icon: LeetcodeLogo, hue: "amber" },
  calendar: { label: "Nächster Termin", icon: CalendarBlank, hue: "red" },
  script: { label: "Skript-Anzeigen (crest-notify)", icon: TerminalWindow, hue: "slate" },
  downloads: { label: "Downloads", icon: DownloadSimple, hue: "teal" },
  weather: { label: "Wetter", icon: CloudSun, hue: "sky" },
  disk: { label: "Speicherplatz", icon: HardDrives, hue: "slate" },
};
