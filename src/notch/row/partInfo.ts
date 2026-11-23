import {
  AppWindow, ArrowsLeftRight, BatteryFull, Bluetooth, CalendarBlank, ChartDonut, ChartLineUp, ChatCircle, CheckCircle, Clock, ClockClockwise, CloudSun, Coffee, Cpu, DownloadSimple, Gauge,
  GlobeHemisphereWest, HardDrives, GithubLogo, Hourglass, ImageSquare, Microphone, MusicNote, NotePencil, NumberSquareOne, SunHorizon, TerminalWindow, Thermometer, Timer, Waveform,
  type Icon,
} from "../../ui/iconset";
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
  processes: { label: "Top-Apps", icon: AppWindow, hue: "rose" },
  battery: { label: "Akku", icon: BatteryFull, hue: "green" },
  mic: { label: "Mikrofon", icon: Microphone, hue: "red" },
  stopwatch: { label: "Stoppuhr", icon: ClockClockwise, hue: "amber" },
  todo: { label: "Nächstes To-do", icon: CheckCircle, hue: "green" },
  note: { label: "Notizvorschau", icon: NotePencil, hue: "yellow" },
  progress: { label: "Zeitfortschritt", icon: Gauge, hue: "blue" },
  date: { label: "Datum", icon: NumberSquareOne, hue: "orange" },
  world: { label: "Weltzeit", icon: GlobeHemisphereWest, hue: "indigo" },
  currency: { label: "Wechselkurs", icon: ArrowsLeftRight, hue: "cyan" },
  crypto: { label: "Krypto", icon: ChartLineUp, hue: "emerald" },
  temps: { label: "Temperaturen", icon: Thermometer, hue: "orange" },
  bluetooth: { label: "Geräteakkus", icon: Bluetooth, hue: "blue" },
  keepawake: { label: "Wach halten", icon: Coffee, hue: "amber" },
  unread: { label: "Ungelesen", icon: ChatCircle, hue: "red" },
  screentime: { label: "Bildschirmzeit", icon: Hourglass, hue: "purple" },
  timeline: { label: "Tagesverlauf", icon: SunHorizon, hue: "amber" },
  wallpaper: { label: "Hintergrundbild", icon: ImageSquare, hue: "sky" },
};
