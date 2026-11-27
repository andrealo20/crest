// Capisci's call: the sentence goes to the provider set in Ask, with the catalog of what Crest can do (understand.ts), and the
// answer comes back as one of the search's actions. Only when the row is chosen; never more than the sentence and the catalog.

import { t, tBackend } from "../../../i18n";
import { PART_IDS } from "../../../notch/row/parts";
import { secrets } from "../../../platform/services";
import { settings } from "../../../settings/store";
import { providerInfo, streamChat } from "../../ask/providers";
import type { LauncherApp } from "../../launcher/apps";
import { allThemes } from "../../themes/store";
import { BUILT_IN_THEMES } from "../../themes/themes";
import type { SearchAction } from "./model";
import { SETTINGS } from "./settingsTable";
import { askReady, askableTools, intentPrompt, parseIntent, type IntentCatalog } from "./understand";

/** How long Ask may take before the row gives up. */
const ASK_LIMIT = 20_000;
/** SettingsView's pages, as its `section` ids. */
const SECTIONS = ["general", "display", "window", "tools", "timer", "ai", "accounts", "themes", "notices", "plugins", "taskbar", "taskbar-items", "taskbar-widgets", "taskbar-apps", "taskbar-look"];

/** Whether Capisci can ask: the provider chosen in Ask has a model and a key, or a server of the user's own. */
export async function askReadyNow(): Promise<boolean> {
  const { provider, configs } = settings.get().ask;
  const hasKey = await secrets.has(`ai.${provider}`).catch(() => false);
  return askReady(provider, configs[provider], hasKey);
}

const catalog = (): IntentCatalog => ({
  settings: SETTINGS,
  // Crest's own names only: the user's themes are matched here (parseIntent), plugins never named.
  themes: BUILT_IN_THEMES.map((th) => ({ id: th.id, name: th.name })),
  widgets: PART_IDS,
  tools: askableTools(settings.get().tools.filter((x) => x.enabled).map((x) => x.id)),
  sections: SECTIONS,
});

/** What Ask meant, as an action (null: not understood), or the error to show. Stops with `signal` or after ASK_LIMIT. */
export async function askIntent(text: string, apps: LauncherApp[], signal: AbortSignal): Promise<{ action: SearchAction | null } | { error: string }> {
  const { provider, configs } = settings.get().ask;
  const c = catalog();
  const stop = new AbortController();
  const late = setTimeout(() => stop.abort(), ASK_LIMIT);
  const passOn = () => stop.abort();
  signal.addEventListener("abort", passOn);
  let reply = "";
  try {
    await streamChat(provider, { ...configs[provider], effort: "off" }, [{ role: "user", content: text }], (d) => (reply += d), stop.signal, intentPrompt(c));
    if (stop.signal.aborted && !signal.aborted) return { error: t("Ask hat nicht rechtzeitig geantwortet") };
    return { action: parseIntent(reply, c, { apps, themes: allThemes().map((th) => ({ id: th.id, name: th.name })) }) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg === "no-key" ? t("Kein API-Schlüssel für {p}, in den Einstellungen eintragen.", { p: t(providerInfo[provider].label) }) : tBackend(msg) };
  } finally {
    clearTimeout(late);
    signal.removeEventListener("abort", passOn);
  }
}
