import { t } from "../../../i18n";
import type { PartId } from "../../../notch/row/parts";
import { CrestMenu, Row } from "./BarMenu";

/**
 * The right-click menu of a widget that has rows of its own (widgets.ts hasWidgetMenu): those rows, a line, then the Crest menu's. The
 * song title's row opens Now Playing, which its round version, whose whole face plays and pauses, has no other click for.
 */
export function WidgetMenu({ id, close, openTool }: { id: PartId; close: () => void; openTool: (tool: string) => void }) {
  return (
    <>
      {id === "title" && (
        <>
          <Row
            label={t("{name} öffnen", { name: t("Wiedergabe") })}
            onClick={() => {
              close();
              openTool("media");
            }}
          />
          <div className="h-px bg-separator my-1" />
        </>
      )}
      <CrestMenu close={close} />
    </>
  );
}
