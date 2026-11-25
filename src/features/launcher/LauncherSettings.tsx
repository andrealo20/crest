import { navigate } from "../../notch/nav";
import { settings, updateSettings } from "../../settings/store";
import { Button, Group, Row, Segmented, Switch } from "../../ui/controls";
import type { LauncherIconSize } from "./apps";
import { t } from "../../i18n";
import { slotStatus } from "./shortcuts";
import { hotkeysResting, shortcutResult } from "./store";
import { HOTKEY_HINT } from "./LauncherView";
import { FavoriteList } from "./FavoriteList";

/** Settings → Tools → Launcher: order of the pinned apps (= Alt number), removing, and the shortcuts. */
export function LauncherSettings() {
  const l = settings.use().launcher;
  const favorites = l.favorites ?? [];
  const status = slotStatus(favorites, l.hotkeys, shortcutResult.use());
  const resting = hotkeysResting.use();
  const taken = status.filter((s) => s.taken).map((s) => s.label);
  const set = (patch: Partial<typeof l>) => updateSettings((s) => ({ launcher: { ...s.launcher, ...patch } }));

  return (
    <Group title={t("Launcher")} id="settings-launcher">
      <Row icon="apps" label={t("Symbolgröße")}>
        <Segmented<LauncherIconSize>
          id="launcher-icon-size"
          label={t("Symbolgröße")}
          size="sm"
          value={l.iconSize}
          onChange={(iconSize) => set({ iconSize })}
          options={[
            { value: "small", label: t("Klein") },
            { value: "medium", label: t("Mittelgroß") },
            { value: "large", label: t("Groß") },
          ]}
        />
      </Row>
      <Row icon="label" label={t("Namen anzeigen")} hint={t("Ohne Namen passen mehr Apps in eine Reihe; der Name zeigt sich unter dem Zeiger")}>
        <Switch label={t("Namen anzeigen")} checked={l.names} onChange={(names) => set({ names })} />
      </Row>
      <Row icon="keyboard"
        label={t("Alt+1 bis Alt+6")}
        hint={
          taken.length
            ? t("Von einer anderen App belegt: {keys}. Diese App dort umstellen oder hier die Reihenfolge ändern.", { keys: taken.join(", ") })
            : resting
              ? t("Alt+1 bis Alt+6 ruhen, solange ein Spiel oder eine Vollbild-App läuft")
              : `${t("Startet die ersten sechs Apps aus jedem Programm.")} ${t(HOTKEY_HINT)}`
        }
      >
        <Switch label={t("Alt+1 bis Alt+6")} checked={l.hotkeys} onChange={(hotkeys) => set({ hotkeys })} />
      </Row>
      {favorites.length === 0 ? (
        <Row icon="keep" label={t("Keine Apps angeheftet")}>
          <Button onClick={() => navigate("launcher")}>{t("Apps hinzufügen")}</Button>
        </Row>
      ) : (
        <FavoriteList
          favorites={favorites}
          onChange={(next) => set({ favorites: next })}
          badge={(i) => status[i]?.label && <span className={`tabular text-caption ${status[i].taken ? "text-red line-through" : "text-label-3"}`}>{status[i].label}</span>}
        />
      )}
    </Group>
  );
}
