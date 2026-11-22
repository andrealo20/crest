import { t } from "../i18n";
import { barEdge, settings, updateSettings } from "../settings/store";
import { Row, Segmented } from "../ui/controls";
import { hasTaskbar, overTaskbar, type Edge } from "./edge";
import { monitor, monitorMetrics } from "./monitor";

/**
 * Settings rows: the screen edge the notch and the line hang from, and (with a taskbar on that edge) whether from the screen's edge or the taskbar's. The capsule floats freely, so it has neither.
 * While Crest's bar is on, its edge is the bar's: the row leaves it out and says so.
 */
export function EdgeSettings() {
  const s = settings.use();
  monitor.use();
  if (s.display.idleStyle === "capsule") return null;
  const { edge, anchor } = s.dock;
  const bar = barEdge(s);
  const m = monitorMetrics();
  const taskbar = hasTaskbar(edge, m.width, m.height, { x: m.workLeft, y: m.workTop, width: m.workWidth, height: m.workHeight });
  const setDock = (patch: Partial<typeof s.dock>) => updateSettings((cur) => ({ dock: { ...cur.dock, ...patch } }));
  return (
    <>
      <Row icon="border_outer"
        label={t("Bildschirmrand")}
        hint={
          <>
            {t("Geschlossen auch an einen anderen Rand ziehen")}
            {bar && (
              <span className="mt-1 block">
                {bar === "top" ? t("Oben steht die Crest-Taskleiste: Der obere Rand kommt zurück, wenn sie aus ist") : t("Unten steht die Crest-Taskleiste: Der untere Rand kommt zurück, wenn sie aus ist")}
              </span>
            )}
          </>
        }
      >
        <Segmented<Edge>
          id="dock-edge"
          label={t("Bildschirmrand")}
          size="sm"
          value={edge}
          // A new edge starts at its middle and with its own default anchor.
          onChange={(next) => updateSettings((cur) => ({ dock: { edge: next, anchor: "auto" }, display: { ...cur.display, offset: 0 } }))}
          options={[
            ...(bar === "top" ? [] : [{ value: "top" as const, label: t("Rand oben") }]),
            ...(bar === "bottom" ? [] : [{ value: "bottom" as const, label: t("Rand unten") }]),
            { value: "left", label: t("Rand links") },
            { value: "right", label: t("Rand rechts") },
          ]}
        />
      </Row>
      {taskbar && (
        <Row icon="anchor" label={t("Hängt an")} hint={t("Über der Taskleiste verdeckt die Notch einen Teil davon")}>
          <Segmented
            id="dock-anchor"
            label={t("Hängt an")}
            size="sm"
            value={overTaskbar(edge, anchor) ? "screen" : "taskbar"}
            onChange={(next) => setDock({ anchor: next })}
            options={[
              { value: "screen", label: t("Bildschirmkante") },
              { value: "taskbar", label: t("Taskleiste") },
            ]}
          />
        </Row>
      )}
    </>
  );
}
