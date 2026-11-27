// Translated from BrimDeck (Apache-2.0, github.com/MoFeng2223/BrimDeck), src/BrimDeck.Core/Settings.cs (window rules) and ScreenPolicy.cs (rule keys).
// The window behaviour settings group: its shape, defaults and the repair of saved values. Pure.
// The rules themselves are resolved in Rust (src-tauri/src/screen_policy.rs), which reads the same shape.

import { normalize, type HotkeyKind } from "./hotkeys.ts";
import { fitScale, normalizeSizes, normalizeTextSizes, type PanelScale, type Size } from "./panelSize.ts";

/** What the notch does in a context: keep its style, switch to the line, or hide. */
export type Behavior = "normal" | "line" | "hide";
export type ScreenContext = "maximized" | "borderless" | "exclusive";
export const CONTEXTS: ScreenContext[] = ["maximized", "borderless", "exclusive"];

/** One app's own answers by executable; null follows the global rule. */
export interface AppRule {
  name: string;
  path: string;
  maximized: Behavior | null;
  borderless: Behavior | null;
  exclusive: Behavior | null;
}

export type CloseDelay = "fast" | "normal" | "patient";
export const closeDelayMs: Record<CloseDelay, number> = { fast: 180, normal: 400, patient: 800 };

export interface WindowSettings {
  rules: Record<ScreenContext, Behavior> & { background: boolean };
  apps: AppRule[];
  hotkeys: Record<HotkeyKind, string>;
  /** A shortcut per tool id that opens the notch on that tool; tools without one are not listed. */
  toolHotkeys: Record<string, string>;
  /** Open size per tool id, dragged at the panel's edges; missing = the tool's default. */
  sizes: Record<string, Size>;
  /** Text size per tool id in %, set with Ctrl + and Ctrl - in the tool (Notes, Calc); missing = 100. */
  textSizes: Record<string, number>;
  scale: PanelScale;
  closeDelay: CloseDelay;
  rightClickSettings: boolean;
  wheelTools: boolean;
  /** Grips at the open panel's edges that set each tool's size. */
  resizeEdges: boolean;
  /** With Open on hover, the closed-row part under the pointer picks the tool; a click on a part always does. */
  hoverParts: boolean;
  /** The open panel's tool bar: at its bottom, or under the header (#76). */
  toolBar: "bottom" | "top";
  /** The tool bar's capsule behind the icons: its fill, or its glass over the glass (#76). */
  toolBarFill: boolean;
  /** The selected tool's icon grows and its name shows beside it in the tool bar. */
  toolNames: boolean;
  /** The tool an open without a target lands on: "live" (the live activity's, as before), "last" (the tool open last) or a tool's id (#87). */
  openOn: string;
  /** "Behind other windows": the notch rests on the desktop under every window, and comes on top only while opened with the shortcut, the
   *  tray or the Launcher and not kept open, or while an indicator shows (display.rs `rests_below`). */
  behind: boolean;
}

export const MAX_APP_RULES = 32;

/** What display.rs reads as `rules` (screen_policy.rs Rules). */
export type RulesPayload = WindowSettings["rules"] & { apps: AppRule[] };

export const WINDOW_DEFAULTS: WindowSettings = {
  rules: { maximized: "normal", borderless: "normal", exclusive: "normal", background: true },
  apps: [],
  hotkeys: { open: "Ctrl+Alt+Space", hide: "", resize: "", find: "Ctrl+Alt+Shift+KeyF", mic: "", search: "" },
  toolHotkeys: {},
  sizes: {},
  textSizes: {},
  scale: 100,
  closeDelay: "fast",
  rightClickSettings: true,
  wheelTools: true,
  resizeEdges: true,
  hoverParts: true,
  toolBar: "bottom",
  toolBarFill: true,
  toolNames: true,
  openOn: "live",
  behind: false,
};

const BEHAVIORS: Behavior[] = ["normal", "line", "hide"];
const behavior = (v: unknown, fallback: Behavior): Behavior => (BEHAVIORS.includes(v as Behavior) ? (v as Behavior) : fallback);
const follow = (v: unknown): Behavior | null => (BEHAVIORS.includes(v as Behavior) ? (v as Behavior) : null);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** More tool shortcuts than this are dropped when saved settings are read. */
export const MAX_TOOL_HOTKEYS = 64;

/** Tool ids with a usable shortcut (the open shortcut's rules); anything else is left out. */
function toolHotkeys(saved: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return out;
  for (const [id, keys] of Object.entries(saved)) {
    const text = typeof keys === "string" ? normalize("open", keys) : "";
    if (text && id.length > 0 && id.length <= 200 && Object.keys(out).length < MAX_TOOL_HOTKEYS) out[id] = text;
  }
  return out;
}

/** "C:\Games\Foo.exe" → "Foo". */
export function exeName(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  return file.replace(/\.exe$/i, "");
}

/** The list's identity: the path when known, the name otherwise; case and slashes don't make a second entry. */
export function ruleKey(rule: Pick<AppRule, "name" | "path">): string {
  const path = rule.path.trim().replaceAll("/", "\\").toLowerCase();
  return path ? `path:${path}` : `name:${rule.name.trim().replace(/\.exe$/i, "").toLowerCase()}`;
}

/** A new rule keeps the style everywhere: the usual reason to add an app is that it should leave Crest alone. */
export function newRule(name: string, path = ""): AppRule {
  return { name: name.trim().replace(/\.exe$/i, ""), path: path.trim(), maximized: "normal", borderless: "normal", exclusive: "normal" };
}

/** Adds a rule unless one for the same app exists or the list is full. */
export function addRule(apps: AppRule[], rule: AppRule): AppRule[] {
  if (!rule.name && !rule.path) return apps;
  if (apps.length >= MAX_APP_RULES || apps.some((a) => ruleKey(a) === ruleKey(rule))) return apps;
  return [...apps, rule];
}

/**
 * Saved settings repaired. Without a saved group the rules come from the old `display.visibility`:
 * "hide-fullscreen" hid borderless and exclusive full screen and left maximized windows alone.
 */
export function normalizeWindow(saved: unknown, legacyVisibility?: string): WindowSettings {
  const d = WINDOW_DEFAULTS;
  if (!saved || typeof saved !== "object") {
    const hide = legacyVisibility === "hide-fullscreen";
    // The old setting only looked at the window in front; an F11 browser behind another app didn't hide the notch.
    return { ...d, rules: { ...d.rules, borderless: hide ? "hide" : "normal", exclusive: hide ? "hide" : "normal", background: !hide } };
  }
  const s = saved as Partial<Record<keyof WindowSettings, unknown>>;
  const r = (s.rules ?? {}) as Record<string, unknown>;
  const h = (s.hotkeys ?? {}) as Record<string, unknown>;
  let apps: AppRule[] = [];
  for (const a of Array.isArray(s.apps) ? (s.apps as Record<string, unknown>[]) : []) {
    if (!a || typeof a !== "object") continue;
    const rule = { name: text(a.name), path: text(a.path), maximized: follow(a.maximized), borderless: follow(a.borderless), exclusive: follow(a.exclusive) };
    apps = addRule(apps, rule);
  }
  return {
    rules: {
      maximized: behavior(r.maximized, d.rules.maximized),
      borderless: behavior(r.borderless, d.rules.borderless),
      exclusive: behavior(r.exclusive, d.rules.exclusive),
      background: bool(r.background, d.rules.background),
    },
    apps,
    hotkeys: {
      // A saved empty text is "unset" on purpose; only a missing one takes the default.
      open: typeof h.open === "string" ? normalize("open", h.open) : d.hotkeys.open,
      hide: normalize("hide", text(h.hide)),
      resize: normalize("resize", text(h.resize)),
      find: typeof h.find === "string" ? normalize("find", h.find) : d.hotkeys.find,
      mic: normalize("mic", text(h.mic)),
      // Unset unless asked for: the offer in the bar's search panel sets Alt+Space, which Windows and PowerToys Run use too.
      search: normalize("search", text(h.search)),
    },
    toolHotkeys: toolHotkeys(s.toolHotkeys),
    sizes: normalizeSizes(s.sizes),
    textSizes: normalizeTextSizes(s.textSizes),
    scale: fitScale(s.scale),
    closeDelay: (Object.keys(closeDelayMs) as CloseDelay[]).includes(s.closeDelay as CloseDelay) ? (s.closeDelay as CloseDelay) : d.closeDelay,
    rightClickSettings: bool(s.rightClickSettings, d.rightClickSettings),
    wheelTools: bool(s.wheelTools, d.wheelTools),
    resizeEdges: bool(s.resizeEdges, d.resizeEdges),
    hoverParts: bool(s.hoverParts, d.hoverParts),
    toolBar: s.toolBar === "top" ? "top" : "bottom",
    toolBarFill: bool(s.toolBarFill, d.toolBarFill),
    toolNames: bool(s.toolNames, d.toolNames),
    openOn: typeof s.openOn === "string" && /^[A-Za-z0-9:_-]{1,64}$/.test(s.openOn) ? s.openOn : d.openOn,
    behind: bool(s.behind, d.behind),
  };
}

/**
 * The tool an open with no target of its own (a tray entry, a clicked part, the part under the pointer) navigates to, or null to
 * stay on the tool shown last: `choice` is `openOn`, `live` the live activity's tool, `tools` the tool bar's, and `resumed` an open
 * within a minute of a close, which the live activity leaves where it was. A chosen tool wins every time; one that left the tool
 * bar counts as "live".
 */
export function startTool(choice: string, live: string | null, tools: string[], resumed: boolean): string | null {
  if (choice === "last") return null;
  if (choice !== "live" && tools.includes(choice)) return choice;
  return !resumed && live && tools.includes(live) ? live : null;
}

/** The tool `step` places away from `current` in the dock, wrapping; null when there is nothing to switch to. */
export function cycle(ids: string[], current: string, step: 1 | -1): string | null {
  if (ids.length < 2) return null;
  const i = ids.indexOf(current);
  if (i < 0) return ids[0];
  return ids[(i + step + ids.length) % ids.length];
}

/**
 * How far a wheel moves a horizontal strip's scrollLeft: the vertical wheel turns sideways, toward the end in either text direction.
 * 0 leaves it alone: a sideways wheel scrolls the strip by itself, and with nothing hidden (`room` = scrollWidth - clientWidth) the notch switches tools.
 */
export function stripScroll(dx: number, dy: number, room: number, rtl: boolean): number {
  if (Math.abs(dy) <= Math.abs(dx) || room <= 1) return 0;
  // Right to left, scrollLeft runs from 0 down to negative values.
  return rtl ? -dy : dy;
}
