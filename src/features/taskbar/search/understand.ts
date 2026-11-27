// Capisci: what Ask is told about Crest, and how its answer becomes one of the search's own actions. Only actions Crest has,
// with their limits, come out; anything else reads as not understood. Pure; the call itself is askIntent.ts.

import type { LauncherApp } from "../../launcher/apps.ts";
import { searchApps } from "../../launcher/apps.ts";
import type { PartId } from "../../../notch/row/parts.ts";
import type { AskProvider, AskProviderConfig } from "../../../settings/store.ts";
import { fold } from "../../settings/search.ts";
import type { SearchAction } from "./model.ts";
import { clampSetting, type SettingSpec } from "./settingsTable.ts";

/** What Ask may pick from: Crest's settings, themes, widgets, the tools that are on and the Settings' pages. No local data. */
export interface IntentCatalog {
  settings: readonly SettingSpec[];
  themes: readonly { id: string; name: string }[];
  widgets: readonly string[];
  tools: readonly string[];
  sections: readonly string[];
}

/** What is matched here and never sent: this PC's apps and every theme, the user's own included. */
export interface IntentLocal {
  apps: LauncherApp[];
  themes: readonly { id: string; name: string }[];
}

/** The tools that may be named to Ask: Crest's own, never a plugin's (its id names what the user installed). */
export const askableTools = (ids: readonly string[]): string[] => ids.filter((id) => !id.startsWith("plugin:"));

/** Ask can answer: a model, and a key or, for a server of the user's own, its address (ai.rs needs no key there). */
export const askReady = (provider: AskProvider, config: AskProviderConfig, hasKey: boolean): boolean =>
  config.model.trim() !== "" && (hasKey || (provider === "custom" && config.baseUrl.trim() !== ""));

function settingLine(spec: SettingSpec, themes: IntentCatalog["themes"]): string {
  if (spec.kind === "number") return `- ${spec.id}: number from ${spec.min} to ${spec.max} (${spec.unit})`;
  if (spec.kind === "toggle") return `- ${spec.id}: switch (true or false)`;
  const values = spec.id === "theme" ? themes.map((t) => t.name) : spec.options.map((o) => o.value);
  return `- ${spec.id}: one of ${values.join(", ")}`;
}

/** The system prompt: the shapes of the one JSON object to answer with, and what each may name. */
export function intentPrompt(c: IntentCatalog): string {
  return [
    "You turn one request typed in the search box of Crest's taskbar into one action Crest can do. The request may be in any language.",
    "Answer with exactly one JSON object and nothing else, in one of these shapes:",
    '{"do":"set","id":"<setting>","to":<value>}',
    '{"do":"nudge","id":"<number setting>","by":1} (or -1)',
    '{"do":"toggle","id":"<switch setting>"}',
    '{"do":"app","name":"<the app\'s name>"}',
    '{"do":"widget","id":"<widget>","add":true} (false takes it off the bar)',
    '{"do":"tool","tool":"<tool>"}',
    '{"do":"settings","section":"<page>"}',
    '{"do":"web","query":"<what to look up>"}',
    '{"do":"none"} when none of these fits.',
    "Settings:",
    ...c.settings.map((s) => settingLine(s, c.themes)),
    `Widgets: ${c.widgets.join(", ")}`,
    `Tools: ${c.tools.join(", ")}`,
    `Settings pages: ${c.sections.join(", ")}`,
    'Crest takes its colours from the theme: a colour ("make it pink") opens the page "themes".',
  ].join("\n");
}

/** The first JSON object in Ask's reply as an action Crest has, held to its limits, or null for anything else. */
export function parseIntent(reply: string, c: IntentCatalog, local: IntentLocal): SearchAction | null {
  const text = reply.replace(/```(?:json)?/gi, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const a = parsed as Record<string, unknown>;
  const spec = typeof a.id === "string" ? c.settings.find((s) => s.id === a.id) : undefined;
  switch (a.do) {
    case "set": {
      if (!spec) return null;
      if (spec.kind === "number") {
        // A blank string is no number: Number("") is 0, which would mute the PC or shrink the bar.
        const n = typeof a.to === "number" ? a.to : typeof a.to === "string" && a.to.trim() ? Number(a.to) : NaN;
        return Number.isFinite(n) ? { do: "set", id: spec.id, to: clampSetting(spec, n) } : null;
      }
      if (spec.kind === "toggle") return typeof a.to === "boolean" ? { do: "set", id: spec.id, to: a.to } : null;
      if (typeof a.to !== "string") return null;
      const to = a.to;
      if (spec.id === "theme") {
        const theme = local.themes.find((t) => t.id === to || fold(t.name) === fold(to));
        return theme ? { do: "set", id: "theme", to: theme.id } : null;
      }
      return spec.options.some((o) => o.value === to) ? { do: "set", id: spec.id, to } : null;
    }
    case "nudge":
      return spec?.kind === "number" && (a.by === 1 || a.by === -1) ? { do: "nudge", id: spec.id, by: a.by } : null;
    case "toggle":
      return spec?.kind === "toggle" ? { do: "toggle", id: spec.id } : null;
    case "app": {
      // The name is matched here, on this PC's list, which never goes to Ask. A blank one would match every app.
      const app = typeof a.name === "string" && a.name.trim() ? searchApps(local.apps, a.name.trim(), 1)[0] : undefined;
      return app ? { do: "app", id: app.id } : null;
    }
    case "widget":
      return typeof a.id === "string" && c.widgets.includes(a.id) && typeof a.add === "boolean" ? { do: "widget", id: a.id as PartId, add: a.add } : null;
    case "tool":
      return typeof a.tool === "string" && c.tools.includes(a.tool) ? { do: "tool", tool: a.tool } : null;
    case "settings":
      return typeof a.section === "string" && c.sections.includes(a.section) ? { do: "settings", section: a.section } : null;
    case "web":
      return typeof a.query === "string" && a.query.trim() ? { do: "web", query: a.query.trim() } : null;
    default:
      return null;
  }
}
