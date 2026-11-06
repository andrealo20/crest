import { settings, updateSettings } from "../../settings/store";
import { Group, Row, Switch } from "../../ui/controls";
import { t } from "../../i18n";

/** Settings → AI: the pace line under the bars, and the notice when a limit resets. */
export function ForecastSettings() {
  const { forecast, notifyReset } = settings.use().aiUsage;
  const set = (patch: { forecast?: boolean; notifyReset?: boolean }) => updateSettings((cur) => ({ aiUsage: { ...cur.aiUsage, ...patch } }));
  return (
    <Group title={t("Kontingent-Prognose")}>
      <Row label={t("Prognose unter den Balken")} hint={t("Zeigt, wann das Limit im aktuellen Tempo erreicht wäre")}>
        <Switch label={t("Prognose unter den Balken")} checked={forecast} onChange={(v) => set({ forecast: v })} />
      </Row>
      <Row label={t("Hinweis, wenn ein Limit zurückgesetzt wird")} hint={t("Braucht den Teil AI-Nutzung, nicht in den Ruhezeiten")}>
        <Switch label={t("Hinweis, wenn ein Limit zurückgesetzt wird")} checked={notifyReset} onChange={(v) => set({ notifyReset: v })} />
      </Row>
    </Group>
  );
}
