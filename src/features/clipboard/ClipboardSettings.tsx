import { settings, updateSettings } from "../../settings/store";
import { Group, Row, Switch } from "../../ui/controls";
import { t } from "../../i18n";

/** Settings → Tools: the decode chips of the Clipboard tool. */
export function ClipboardSettings() {
  const on = settings.use().clipChips !== false;
  return (
    <Group id="settings-clipboard" title={t("Zwischenablage")}>
      <Row
        label={t("Chips zum Dekodieren")}
        hint={t("Ein kleiner Chip an Einträgen, die ein JWT, Unix-Zeit, Base64, eine UUID, JSON, eine Farbe oder ein Link mit Tracking sind. Alles bleibt auf dem Rechner.")}
      >
        <Switch label={t("Chips zum Dekodieren")} checked={on} onChange={(clipChips) => updateSettings({ clipChips })} />
      </Row>
    </Group>
  );
}
