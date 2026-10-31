import { t } from "../../i18n";
import type { ReadingKey } from "../../notch/row/parts";
import { settings, updateSettings } from "../../settings/store";
import { Group, Row, Segmented, Select, Switch } from "../../ui/controls";
import { COLOR_SCHEMES, schemeColor, type ColorScheme } from "./levels";
import { system } from "./store";

const schemeLabel: Record<ColorScheme, string> = { calm: "Ruhig", traffic: "Ampel", accent: "Akzent" };

const extras: { key: ReadingKey; label: string; hint: string }[] = [
  { key: "net", label: "Netzwerk", hint: "Download und Upload" },
  { key: "power", label: "Leistung", hint: "Ganzer PC; geschätzt, wenn kein Messgerät da ist" },
  { key: "battery", label: "Akku", hint: "Nur bei Laptops" },
  { key: "temp", label: "Temperatur", hint: "CPU, sonst GPU; erscheint, sobald ein Sensor antwortet" },
];

/** Hardware tool: colours, the GPU shown, and the opt-in readings of the closed row. */
export function SystemSettings() {
  const s = settings.use();
  const gpus = system.use().stats?.gpus ?? [];
  const set = (patch: Partial<typeof s.system>) => updateSettings((cur) => ({ system: { ...cur.system, ...patch } }));
  // One reading stays on, otherwise the part would be empty (as in Display, Content).
  const setReading = (key: ReadingKey, on: boolean) =>
    updateSettings((cur) => (on || Object.values(cur.closed.readings).filter(Boolean).length > 1 ? { closed: { ...cur.closed, readings: { ...cur.closed.readings, [key]: on } } } : {}));

  return (
    <Group title={t("Hardware")} id="settings-system">
      <Row label={t("Farben")} hint={t("Für die Werte im Tool und in der geschlossenen Notch")}>
        <Segmented
          id="system-colors"
          value={s.system.colors}
          onChange={(colors) => set({ colors })}
          options={COLOR_SCHEMES.map((c) => ({
            value: c,
            label: (
              <span className="flex items-center gap-1.5">
                <span className="flex gap-0.5">
                  {([0, 1, 2] as const).map((l) => (
                    <span key={l} className="size-1.5 rounded-full" style={{ background: schemeColor(c, l) }} />
                  ))}
                </span>
                {t(schemeLabel[c])}
              </span>
            ),
          }))}
        />
      </Row>
      {gpus.length > 1 && (
        <Row label="GPU" hint={t("Auch per Klick auf die GPU-Zeile im Tool")}>
          <Select value={s.system.gpu} onChange={(gpu) => set({ gpu })} options={[{ value: "", label: t("Automatisch") }, ...gpus.map((g) => ({ value: g.name, label: g.name }))]} />
        </Row>
      )}
      <Row label={t("In der geschlossenen Notch")} hint={t("Zusätzliche Werte im Teil „Auslastung“")} />
      {extras.map((e) => (
        <Row key={e.key} label={t(e.label)} hint={t(e.hint)}>
          <Switch label={t(e.label)} checked={s.closed.readings[e.key]} onChange={(on) => setReading(e.key, on)} />
        </Row>
      ))}
    </Group>
  );
}
