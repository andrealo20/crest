import { useEffect, useState } from "react";
import { t } from "../../i18n";
import { screenTime } from "../../platform/services";
import { settings } from "../../settings/store";
import { focusLog } from "../timer/store";
import { Button, Group, Row, Switch } from "../../ui/controls";
import { setScreenTime } from "./store";

/**
 * Settings, Tools: the switch that records Screen Time, off until turned on (the consent), and the button that deletes what it kept
 * and the Day timeline's focus rounds, which asks again first. Turning it off deletes nothing: the days stay until deleted here or
 * until they are 30 days old.
 */
export function ScreenTimeSettings() {
  const on = settings.use().screenTime.on;
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const id = window.setTimeout(() => setConfirm(false), 3000);
    return () => window.clearTimeout(id);
  }, [confirm]);
  const clear = () => {
    if (!confirm) return setConfirm(true);
    setConfirm(false);
    void screenTime.clear().catch(() => {});
    // The Day timeline's rounds are the same kind of record: what was done when.
    focusLog.set([]);
  };
  return (
    <Group id="settings-screentime" title={t("Bildschirmzeit")}>
      <Row
        icon="hourglass_top"
        label={t("Bildschirmzeit aufzeichnen")}
        hint={t("Zählt, wie lange jede App vorne ist, Stunde für Stunde und nur auf diesem Gerät. Fenstertitel und Webseiten liest Crest nicht, und drei Minuten ohne Tastatur und Maus zählen nicht. Die Daten bleiben 30 Tage.")}
      >
        <Switch label={t("Bildschirmzeit aufzeichnen")} checked={on} onChange={setScreenTime} />
      </Row>
      <Row label={t("Bildschirmzeit löschen")}>
        <Button onClick={clear}>{confirm ? t("Wirklich löschen?") : t("Löschen")}</Button>
      </Row>
    </Group>
  );
}
