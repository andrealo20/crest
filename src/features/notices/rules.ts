// Which notices pop up in the closed notch, which only go to the history, which are dropped. Pure.
import { noticeSounds, type NoticeSound } from "../../lib/sound.ts";

/** Crest's own sound for a notice that pops up: off, one of its sounds, or the user's file. */
export type NoticeSoundSetting = "off" | NoticeSound | "file";

/** show: pops up; mute: history only; hide: dropped. */
export type NoticeRule = "show" | "mute" | "hide";
export type Route = "pop" | "history" | "drop";

export interface NoticeSettings {
  /** Master switch; off by default, since it reads every app's notifications. */
  enabled: boolean;
  /** Sources: Windows toast notifications and crest-notify. */
  windows: boolean;
  cli: boolean;
  /** Windows' own banners off for the apps seen, so a notice pops up only in the notch. */
  hideBanners: boolean;
  /** A notice with a one-time code shows a Copy code button (otp.ts). It only shows when there is a code, so it is on by default. */
  copyCodes: boolean;
  /** Crest's own sound when a notice pops up; Windows' sound is muted for those apps meanwhile (banners.rs). */
  sound: NoticeSoundSetting;
  /** The picked file's own name, for the settings; the copy is in Crest's data folder (notice_sound.rs). */
  soundFile: string;
  /** A daily window ("HH:MM", may cross midnight) in which notices only go to the history, as in presentation mode. */
  quiet: { on: boolean; from: string; to: string };
  /** Keyed by lower-case app id. */
  rules: Record<string, NoticeRule>;
  /** Apps seen so far (lower-case id → name), so a rule can be set before the app's next notice. */
  apps: Record<string, string>;
}

export const NOTICE_DEFAULTS: NoticeSettings = {
  enabled: false,
  windows: true,
  cli: true,
  hideBanners: false,
  copyCodes: true,
  sound: "off",
  soundFile: "",
  quiet: { on: false, from: "22:00", to: "07:00" },
  rules: {},
  apps: {},
};

/** Apps kept in the list; the oldest entries go first. */
export const MAX_APPS = 100;

const RULES: readonly NoticeRule[] = ["show", "mute", "hide"];
const SOUNDS: readonly string[] = ["off", ...noticeSounds.map((s) => s.value), "file"];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

/** "HH:MM" as minutes after midnight, or null. */
export function minutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

const time = (v: unknown, d: string) => (typeof v === "string" && minutes(v) !== null ? v : d);

export function normalizeNotices(saved: unknown): NoticeSettings {
  const s = isObj(saved) ? saved : {}, d = NOTICE_DEFAULTS;
  const q = isObj(s.quiet) ? s.quiet : {};
  const rules: Record<string, NoticeRule> = {};
  if (isObj(s.rules)) for (const [k, v] of Object.entries(s.rules)) if (RULES.includes(v as NoticeRule) && v !== "show") rules[k.toLowerCase()] = v as NoticeRule;
  const apps: Record<string, string> = {};
  if (isObj(s.apps)) for (const [k, v] of Object.entries(s.apps).slice(-MAX_APPS)) if (typeof v === "string") apps[k.toLowerCase()] = v;
  return {
    enabled: bool(s.enabled, d.enabled),
    windows: bool(s.windows, d.windows),
    cli: bool(s.cli, d.cli),
    hideBanners: bool(s.hideBanners, d.hideBanners),
    copyCodes: bool(s.copyCodes, d.copyCodes),
    sound: SOUNDS.includes(s.sound as string) ? (s.sound as NoticeSoundSetting) : d.sound,
    soundFile: typeof s.soundFile === "string" ? s.soundFile.slice(0, 260) : d.soundFile,
    quiet: { on: bool(q.on, d.quiet.on), from: time(q.from, d.quiet.from), to: time(q.to, d.quiet.to) },
    rules,
    apps,
  };
}

export function ruleFor(rules: Record<string, NoticeRule>, appId: string): NoticeRule {
  return rules[appId.toLowerCase()] ?? "show";
}

/** Whether `now` (minutes after midnight) falls in [from, to). A window that crosses midnight wraps; from = to is empty. */
export function inQuiet(now: number, from: string, to: string): boolean {
  const a = minutes(from), b = minutes(to);
  if (a === null || b === null || a === b) return false;
  return a < b ? now >= a && now < b : now >= a || now < b;
}

/** `fullscreen`: an app fills the notch's screen; `focus`: Windows focus or Do Not Disturb is on. Both keep notices quiet. */
export function route(appId: string, s: NoticeSettings, ctx: { presenting: boolean; now: number; fullscreen?: boolean; focus?: boolean }): Route {
  if (!s.enabled) return "drop";
  const rule = ruleFor(s.rules, appId);
  if (rule === "hide") return "drop";
  if (rule === "mute" || ctx.presenting || ctx.fullscreen || ctx.focus || (s.quiet.on && inQuiet(ctx.now, s.quiet.from, s.quiet.to))) return "history";
  return "pop";
}

/** Records an app as seen; returns the same object when nothing changed, so settings are not written for every notice. */
export function rememberApp(apps: Record<string, string>, appId: string, name: string): Record<string, string> {
  const key = appId.toLowerCase();
  if (apps[key] === name) return apps;
  const { [key]: _, ...rest } = apps;
  const kept = Object.entries(rest).slice(-(MAX_APPS - 1));
  return { ...Object.fromEntries(kept), [key]: name };
}

/** Sets a rule; "show" is the default and is stored as no entry. */
export function setRule(rules: Record<string, NoticeRule>, appId: string, rule: NoticeRule): Record<string, NoticeRule> {
  const { [appId.toLowerCase()]: _, ...rest } = rules;
  return rule === "show" ? rest : { ...rest, [appId.toLowerCase()]: rule };
}
