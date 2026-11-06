import { Group, Row, Segmented, Switch } from "../../ui/controls";
import { t } from "../../i18n";
import { breaksActions, breaksConfig } from "./store";

const MICRO = [10, 15, 20, 30];
const LONG = [45, 60, 90, 120];
const LENGTH = [3, 5, 10, 15];

// A saved value outside the chips (typed into the file by hand) still shows as its own chip.
const withValue = (list: number[], v: number) => (list.includes(v) ? list : [...list, v].sort((a, b) => a - b));
const chips = (list: number[], v: number) => withValue(list, v).map((n) => ({ value: String(n), label: t("{n} Min.", { n }) }));

/** Settings → Timer: the break reminders. Off until switched on; the intervals count work at the computer, not the clock. */
export function BreaksSettings() {
  const c = breaksConfig.use();
  const set = breaksActions.setConfig;
  return (
    <Group id="settings-breaks" title={t("Pausen")}>
      <Row label={t("Pausen-Erinnerungen")} hint={t("Eine Karte in der geschlossenen Notch, still bei Präsentationen, Vollbild und Bitte nicht stören")}>
        <Switch label={t("Pausen-Erinnerungen")} checked={c.on} onChange={(on) => set({ on })} />
      </Row>
      <Row label={t("Kurze Pause alle")} hint={t("20 Sekunden in die Ferne schauen")}>
        <Segmented id="breaks-micro" size="sm" value={String(c.microEveryMin)} onChange={(v) => set({ microEveryMin: Number(v) })} options={chips(MICRO, c.microEveryMin)} />
      </Row>
      <Row label={t("Lange Pause alle")}>
        <Segmented id="breaks-long" size="sm" value={String(c.longEveryMin)} onChange={(v) => set({ longEveryMin: Number(v) })} options={chips(LONG, c.longEveryMin)} />
      </Row>
      <Row label={t("Dauer der langen Pause")}>
        <Segmented id="breaks-length" size="sm" value={String(c.longMin)} onChange={(v) => set({ longMin: Number(v) })} options={chips(LENGTH, c.longMin)} />
      </Row>
    </Group>
  );
}
