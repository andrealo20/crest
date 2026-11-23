import { t } from "../../../i18n";
import type { PartId } from "../../../notch/row/parts";
import { MAX_LAPS, idle } from "../../timer/stopwatch";
import { stopwatch, stopwatchActions, timerTab } from "../../timer/store";
import { nextTask } from "../../todos/model";
import { todoActions, todos } from "../../todos/store";
import { CrestMenu, Row } from "./BarMenu";

/**
 * The right-click menu of a widget that has rows of its own (widgets.ts hasWidgetMenu): those rows, a line, then the Crest menu's. The
 * song title's row opens Now Playing, which its round version, whose whole face plays and pauses, has no other click for; on the main
 * bar the clock's Time and weather and the date's week open Weather, the keyboard's way to what a click on their weather opens.
 */
export function WidgetMenu({ id, close, openTool }: { id: PartId; close: () => void; openTool: (tool: string) => void }) {
  const opens = id === "title" ? { tool: "media", name: t("Wiedergabe") } : id === "clock" || id === "date" ? { tool: "weather", name: t("Wetter") } : null;
  return (
    <>
      {opens && (
        <>
          <Row
            label={t("{name} öffnen", { name: opens.name })}
            onClick={() => {
              close();
              openTool(opens.tool);
            }}
          />
          <div className="h-px bg-separator my-1" />
        </>
      )}
      {id === "stopwatch" && <StopwatchRows close={close} openTool={openTool} />}
      {id === "todo" && <TodoRow close={close} />}
      <CrestMenu close={close} />
    </>
  );
}

/** Lap while it runs, Reset once it has counted, and Show laps, which opens the Timer's stopwatch over the widget. */
function StopwatchRows({ close, openTool }: { close: () => void; openTool: (tool: string) => void }) {
  const s = stopwatch.use();
  const run = (action: () => void) => () => {
    close();
    action();
  };
  return (
    <>
      <Row label={t("Runde")} disabled={s.startedAt === null || s.laps.length >= MAX_LAPS} onClick={run(stopwatchActions.lap)} />
      <Row label={t("Zurücksetzen")} disabled={idle(s)} onClick={run(stopwatchActions.reset)} />
      <Row
        label={t("Runden anzeigen")}
        onClick={run(() => {
          timerTab.set("stopwatch");
          openTool("timer");
        })}
      />
      <div className="h-px bg-separator my-1" />
    </>
  );
}

/** Done for the task the widget shows, the open project's next one. */
function TodoRow({ close }: { close: () => void }) {
  const { tasks, active } = todos.use();
  const next = nextTask(tasks, active);
  return (
    <>
      <Row
        label={t("Erledigt")}
        disabled={!next}
        onClick={() => {
          close();
          if (next) todoActions.done(next.id);
        }}
      />
      <div className="h-px bg-separator my-1" />
    </>
  );
}
