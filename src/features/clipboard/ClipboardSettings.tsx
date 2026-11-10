import { settings, updateSettings } from "../../settings/store";
import { isMac } from "../../platform/native";
import { Group, Row, Switch } from "../../ui/controls";
import { t } from "../../i18n";

/** Settings → Tools: the decode chips of the Clipboard tool, and whether a click pastes. */
export function ClipboardSettings() {
  const s = settings.use();
  return (
    <Group id="settings-clipboard" title={t("Zwischenablage")}>
      <Row
        label={t("Chips zum Dekodieren")}
        hint={t("Ein kleiner Chip an Einträgen, die ein JWT, Unix-Zeit, Base64, eine UUID, JSON, eine Farbe oder ein Link mit Tracking sind. Alles bleibt auf dem Rechner.")}
      >
        <Switch label={t("Chips zum Dekodieren")} checked={s.clipChips !== false} onChange={(clipChips) => updateSettings({ clipChips })} />
      </Row>
      <Row
        label={t("Direkt einfügen")}
        hint={
          isMac
            ? t("Ein Klick auf einen Eintrag kopiert ihn und fügt ihn in die App ein, die vor dem Öffnen der Notch vorne war. Dafür braucht Crest die Freigabe unter Datenschutz & Sicherheit → Bedienungshilfen.")
            : t("Ein Klick auf einen Eintrag kopiert ihn und fügt ihn in die App ein, die vor dem Öffnen der Notch vorne war, wie Win + V.")
        }
      >
        <Switch label={t("Direkt einfügen")} checked={s.clipPaste === true} onChange={(clipPaste) => updateSettings({ clipPaste })} />
      </Row>
    </Group>
  );
}
